const express = require("express");
const {
  getJobApplications,
  createJobApplication,
  updateJobApplication,
  deleteJobApplication,
} = require("../Controllers/jobApplicationController");
const { protect } = require("../Middleware/authMiddleware");

const router = express.Router();

router.get("/job-applications", protect, getJobApplications);
router.post("/job-applications", protect, createJobApplication);
router.patch("/job-applications/:id", protect, updateJobApplication);
router.delete("/job-applications/:id", protect, deleteJobApplication);

module.exports = router;
