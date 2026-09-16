const { AccessToken, AgentDispatchClient, RoomServiceClient } = require('livekit-server-sdk');
const mongoose = require('mongoose');
const Interview = require('../Models/interviewModel');
const User = require('../Models/userModel');

// Small ownership helper, same pattern as canAccessUser
const canAccessInterview = (req, interview) => (
    ['admin', 'personnel'].includes(req.user?.role) || String(interview.user) === String(req.user?.user_id)
);

const normalizeTranscript = (transcript) => {
    if (!Array.isArray(transcript)) return [];

    const roleMap = {
        candidate: 'user',
        mavis: 'assistant',
        user: 'user',
        assistant: 'assistant',
    };

    return transcript.map((entry) => {
        const rawRole = String(entry?.role || entry?.speaker || '').toLowerCase();
        const timestamp = entry?.timestamp ? new Date(entry.timestamp) : new Date();

        return {
            role: roleMap[rawRole] || 'user',
            text: entry?.text || '',
            timestamp: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
        };
    });
};

const hasFeedbackPayload = (feedback) => (
    feedback
    && typeof feedback === 'object'
    && !Array.isArray(feedback)
    && Object.keys(feedback).length > 0
);

const buildFeedbackFromEvaluations = (answerEvaluations = []) => {
    const evaluations = Array.isArray(answerEvaluations) ? answerEvaluations : [];
    const dimensions = ['structure', 'specificity', 'relevance'];
    const dimensionLabels = {
        structure: 'Structure',
        specificity: 'Specificity',
        relevance: 'Relevance',
    };

    const dimensionScores = dimensions.reduce((scores, dimension) => {
        const numericScores = evaluations
            .map((evaluation) => Number(evaluation?.dimensionScores?.[dimension]))
            .filter((score) => Number.isFinite(score));

        scores[dimension] = numericScores.length
            ? Number((numericScores.reduce((sum, score) => sum + score, 0) / numericScores.length).toFixed(2))
            : 0;

        return scores;
    }, {});

    const overallScore = Number((((dimensionScores.structure + dimensionScores.specificity + dimensionScores.relevance) / 30) * 100).toFixed(2));
    const strengths = dimensions
        .filter((dimension) => dimensionScores[dimension] >= 7)
        .map((dimension) => `${dimensionLabels[dimension]} is a strength.`);
    const weaknesses = dimensions
        .filter((dimension) => dimensionScores[dimension] < 7)
        .map((dimension) => `${dimensionLabels[dimension]} needs improvement.`);

    const summary = evaluations.length
        ? `Based on ${evaluations.length} evaluated answer${evaluations.length === 1 ? '' : 's'}, the candidate scored ${overallScore}% overall. Structure averaged ${dimensionScores.structure}/10, specificity averaged ${dimensionScores.specificity}/10, and relevance averaged ${dimensionScores.relevance}/10.`
        : 'No answer evaluations were available, so final feedback could not be scored from interview answers.';

    return {
        strengths,
        weaknesses,
        dimensionScores,
        overallScore,
        summary,
        rubricVersion: 1,
    };
};

const requireLiveKitConfig = () => {
    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;

    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        throw new Error('Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET');
    }

    return { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET };
};

const createParticipantToken = async ({ roomName, userId, fullName }) => {
    const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: String(userId),
        name: fullName || 'Candidate',
        ttl: '1h',
    });

    token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    });

    return token.toJwt();
};

const createOrUpdateRoom = async ({ roomName, metadata }) => {
    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    const roomClient = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    try {
        await roomClient.createRoom({
            name: roomName,
            metadata,
            emptyTimeout: 10 * 60,
            departureTimeout: 5 * 60,
            maxParticipants: 2,
        });
    } catch (err) {
        if (err.status === 409 || err.message?.includes('already exists')) {
            await roomClient.updateRoomMetadata(roomName, metadata);
            return;
        }

        throw err;
    }
};

const dispatchAgentIfConfigured = async ({ roomName, metadata }) => {
    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_AGENT_NAME } = process.env;

    if (!LIVEKIT_AGENT_NAME) return null;

    const dispatchClient = new AgentDispatchClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    return dispatchClient.createDispatch(roomName, LIVEKIT_AGENT_NAME, { metadata });
};

// CREATE — start a new interview session
const startInterview = async (req, res) => {
    try {
        requireLiveKitConfig();

        const { jobTitle, jobDescription, persona } = req.body;
        const user = await User.findById(req.user.user_id).select('full_name cvText tokenUsage tokenLimit');
        if (!user) return res.status(404).json({ message: 'User not found' });

        if ((user.tokenUsage || 0) >= (user.tokenLimit || 0)) {
            return res.status(403).json({ error: 'Token limit reached' });
        }

        const interview = await Interview.create({
            user: req.user.user_id,
            jobTitle,
            jobDescription,
            persona: persona || 'Mavis',
            status: 'in_progress',
            startedAt: new Date(),
        });

        const roomName = `mavis-interview-${interview._id}`;
        const metadata = JSON.stringify({
            interviewId: String(interview._id),
            userId: String(req.user.user_id),
            jobTitle,
            jobDescription,
            cvText: user?.cvText || '',
        });

        await createOrUpdateRoom({ roomName, metadata });
        const agentDispatch = await dispatchAgentIfConfigured({ roomName, metadata });
        const token = await createParticipantToken({
            roomName,
            userId: req.user.user_id,
            fullName: user?.full_name,
        });

        res.status(201).json({
            interview,
            livekit: {
                url: process.env.LIVEKIT_URL,
                roomName,
                token,
                agentDispatched: Boolean(agentDispatch),
            },
        });
    } catch (err) {
        console.error('startInterview error:', err);
        console.error('LiveKit URL:', process.env.LIVEKIT_URL);
        console.error('LiveKit key:', process.env.LIVEKIT_API_KEY);
        console.error('LiveKit secret length:', process.env.LIVEKIT_API_SECRET?.length);
        res.status(500).json({ error: err.message });
    }
};

// GET ALL — a user's own interview history
const getMyInterviews = async (req, res) => {
    try {
        const interviews = await Interview.find({ user: req.user.user_id })
            .sort({ createdAt: -1 }); // most recent first

        res.json(interviews);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// GET ONE — full transcript + feedback for a single session
const getInterviewById = async (req, res) => {
    try {
        const interview = await Interview.findById(req.params.interviewId);
        if (!interview) return res.status(404).json({ message: 'Interview not found' });

        if (!canAccessInterview(req, interview)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        res.json(interview);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// UPDATE — end the interview, save transcript + feedback
const endInterview = async (req, res) => {
    try {
        const interview = await Interview.findById(req.params.interviewId);
        if (!interview) return res.status(404).json({ message: 'Interview not found' });

        if (!canAccessInterview(req, interview)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        const body = req.body || {};
        const { transcript, feedback } = body;
        const normalizedTranscript = normalizeTranscript(transcript);
        const bodyIncludedFeedback = Object.prototype.hasOwnProperty.call(body, 'feedback');

        interview.transcript = normalizedTranscript;
        interview.status = 'completed';
        interview.endedAt = new Date();
        interview.feedback = hasFeedbackPayload(feedback) ? feedback : buildFeedbackFromEvaluations(interview.answerEvaluations);

        console.log('endInterview:', {
            interviewId: String(interview._id),
            transcriptCount: normalizedTranscript.length,
            answerEvaluationCount: interview.answerEvaluations?.length || 0,
            bodyIncludedFeedback,
        });

        await interview.save();

        res.json(interview);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// INTERNAL UPDATE — append live answer evaluations without replacing interview data
const updateAnswerEvaluations = async (req, res) => {
    const configuredKey = process.env.INTERNAL_API_KEY;
    const providedKey = req.get('x-internal-api-key');

    if (!configuredKey || providedKey !== configuredKey) {
        return res.status(401).json({ error: 'Invalid internal API key' });
    }

    const { interviewId } = req.params;
    if (!mongoose.isValidObjectId(interviewId)) {
        return res.status(400).json({ error: 'Invalid interviewId' });
    }

    const { answerEvaluations } = req.body || {};
    if (!Array.isArray(answerEvaluations)) {
        return res.status(400).json({ error: 'answerEvaluations must be an array' });
    }

    const normalizedEvaluations = answerEvaluations.map((evaluation) => {
        if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) {
            return null;
        }

        const timestamp = new Date(evaluation.timestamp || Date.now());
        if (Number.isNaN(timestamp.getTime())) return null;

        return {
            questionText: evaluation.questionText,
            hasSituation: evaluation.hasSituation,
            hasAction: evaluation.hasAction,
            hasResult: evaluation.hasResult,
            dimensionScores: {
                structure: evaluation.structureScore,
                specificity: evaluation.specificityScore,
                relevance: evaluation.relevanceScore,
            },
            followUpNeeded: evaluation.followUpNeeded,
            notes: evaluation.notes,
            timestamp,
        };
    });

    if (normalizedEvaluations.some((evaluation) => evaluation === null)) {
        return res.status(400).json({ error: 'Each answer evaluation must be an object with a valid timestamp' });
    }

    try {
        const interview = await Interview.findByIdAndUpdate(
            interviewId,
            { $push: { answerEvaluations: { $each: normalizedEvaluations } } },
            { new: true, runValidators: true }
        );

        if (!interview) return res.status(404).json({ message: 'Interview not found' });

        let feedbackRebuilt = false;
        if (interview.status === 'completed') {
            interview.feedback = buildFeedbackFromEvaluations(interview.answerEvaluations);
            await interview.save();
            feedbackRebuilt = true;
        }

        console.log('updateAnswerEvaluations:', {
            interviewId: String(interview._id),
            appendedCount: normalizedEvaluations.length,
            totalAnswerEvaluationCount: interview.answerEvaluations?.length || 0,
            status: interview.status,
            feedbackRebuilt,
        });

        return res.json({
            message: 'Answer evaluations saved successfully',
            appended: normalizedEvaluations.length,
            totalAnswerEvaluations: interview.answerEvaluations?.length || 0,
            feedbackRebuilt,
            interviewId: interview._id,
        });
    } catch (err) {
        console.error('updateAnswerEvaluations error:', err);
        return res.status(500).json({ error: err.message });
    }
};

// DELETE — remove a session (e.g., user clears their history)
const deleteInterview = async (req, res) => {
    try {
        const interview = await Interview.findById(req.params.interviewId);
        if (!interview) return res.status(404).json({ message: 'Interview not found' });

        if (!canAccessInterview(req, interview)) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        await Interview.findByIdAndDelete(req.params.interviewId);

        res.json({ message: 'Interview deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    buildFeedbackFromEvaluations,
    startInterview,
    getMyInterviews,
    getInterviewById,
    endInterview,
    updateAnswerEvaluations,
    deleteInterview,
};
