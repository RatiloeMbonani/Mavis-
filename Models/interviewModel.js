const mongoose = require("mongoose");

const interviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    jobTitle: String,         
    jobDescription: String,    
    persona: {
      type: String,
      default: "Mavis",
    },
    status: {
      type: String,
      enum: ["in_progress", "completed", "abandoned"],
      default: "in_progress",
    },
    transcript: String,        // full text transcript from Gemini Live
    feedback: {
      strengths: [String],
      weaknesses: [String],
      score: { type: Number, min: 0, max: 100 },
      summary: String,
    },
    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.models.Interview || mongoose.model("Interview", interviewSchema);