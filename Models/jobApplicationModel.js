const mongoose = require("mongoose");

const JOB_APPLICATION_STATUSES = [
  "saved",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "closed",
];

const jobApplicationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    company: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: JOB_APPLICATION_STATUSES,
      default: "saved",
    },
    location: {
      type: String,
      trim: true,
    },
    jobUrl: {
      type: String,
      trim: true,
    },
    dateApplied: Date,
    nextStepDate: Date,
    stage: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    jobDescription: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

jobApplicationSchema.index({ userId: 1, updatedAt: -1 });

module.exports = {
  JOB_APPLICATION_STATUSES,
  JobApplication:
    mongoose.models.JobApplication ||
    mongoose.model("JobApplication", jobApplicationSchema),
};
