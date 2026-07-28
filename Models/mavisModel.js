const sessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  persona: { type: String, default: 'Mavis' },
  jobDescription: String,
  transcript: String,
  feedback: {
    strengths: [String],
    weaknesses: [String],
    score: Number,
  },
  startedAt: Date,
  endedAt: Date,
}, { timestamps: true });