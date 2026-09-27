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
    cvTextSnapshot: String,
    persona: {
      type: String,
      default: "Mavis",
    },
    status: {
      type: String,
      enum: ["in_progress", "completed", "abandoned", "cancelled", "interrupted"],
      default: "in_progress",
    },
    jobDescriptionEmbedding: {
      type: [Number],
      default: [],
    },
    transcript: [
      {
        role: { type: String, enum: ["User", "Mavis"] },
        text: String,
        timestamp: Date,
      },
    ],
  
    answerEvaluations: [
      {
        questionText: String,
        hasSituation: Boolean,
        hasAction: Boolean,
        hasResult: Boolean,
        dimensionScores: {
          structure: Number,
          specificity: Number,
          relevance: Number,
        },
        followUpNeeded: Boolean,
        notes: String,
        timestamp: Date,
      },
    ],
    feedback: {
      strengths: [String],
      weaknesses: [String],
      dimensionScores: {
        structure: Number,
        specificity: Number,
        relevance: Number,
      },
      overallScore: { type: Number, min: 0, max: 100 },
      summary: String,
      rubricVersion: { type: Number, default: 1 },
    },
    durationSeconds: Number,
    tokensUsed: Number,
    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.models.Interview || mongoose.model("Interview", interviewSchema);
