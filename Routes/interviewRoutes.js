const Interview = require('../models/interviewModel');

const canAccessInterview = (req, interview) => (
  req.user?.role === 'user' || String(interview.user) === String(req.user?.user_id)
);

// CREATE — start a new interview session
const startInterview = async (req, res) => {
  try {
    const { jobTitle, jobDescription, persona } = req.body;

    const interview = await Interview.create({
      user: req.user.user_id,
      jobTitle,
      jobDescription,
      persona: persona || 'Mavis',
      status: 'in_progress',
      startedAt: new Date(),
    });

    res.status(201).json(interview);
  } catch (err) {
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
// (this is what your WebSocket/Gemini relay will call once the session ends)
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
  deleteInterview,
};