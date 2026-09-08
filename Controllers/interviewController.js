const { AccessToken, AgentDispatchClient, RoomServiceClient } = require('livekit-server-sdk');
const mongoose = require('mongoose');
const Interview = require('../Models/interviewModel');
const User = require('../Models/userModel');

// Small ownership helper, same pattern as canAccessUser
const canAccessInterview = (req, interview) => (
    ['admin', 'personnel'].includes(req.user?.role) || String(interview.user) === String(req.user?.user_id)
);

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
        const user = await User.findById(req.user.user_id).select('full_name cvText');

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

        const { transcript, feedback } = req.body;

        interview.transcript = transcript;
        interview.feedback = feedback;
        interview.status = 'completed';
        interview.endedAt = new Date();

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

        return res.json({
            message: 'Answer evaluations saved successfully',
            appended: normalizedEvaluations.length,
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
    startInterview,
    getMyInterviews,
    getInterviewById,
    endInterview,
    updateAnswerEvaluations,
    deleteInterview,
};