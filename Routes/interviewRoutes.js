const express = require('express');
const {
  startInterview,
  getMyInterviews,
  getInterviewById,
  endInterview,
  deleteInterview,
} = require('../controllers/interviewController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.post('/interviews', protect, startInterview);
router.get('/interviews', protect, getMyInterviews);
router.get('/interviews/:interviewId', protect, getInterviewById);
router.put('/interviews/:interviewId/end', protect, endInterview);
router.delete('/interviews/:interviewId', protect, deleteInterview);

module.exports = router;