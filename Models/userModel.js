const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const tokenUsageDailySchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    promptTokens: {
      type: Number,
      default: 0,
      min: 0,
    },
    responseTokens: {
      type: Number,
      default: 0,
      min: 0,
    },
    thoughtsTokens: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    full_name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["user", "admin", "personnel"],
      default: "user",
    },
    password: {
      type: String,
      required: true,
      select: false, // Exclude password by default
    },
    profileAvatarUrl: {
      type: String,
      default: null,
    },
    profileAvatarFileName: {
      type: String,
      default: null,
    },
    cvUrl: {
      type: String,
      default: null,
    },
    cvFileName: {
      type: String,
      default: null,
    },
    tokenUsage: {
      type: Number,
      default: 0,
      min: 0,
    },
    tokenUsageDaily: {
      type: [tokenUsageDailySchema],
      default: [],
    },
    tokenLimit: {
      type: Number,
      default: 1000000,
      min: 0,
    },
    subscriptionTier: {
      type: String,
      enum: ["free", "paid"],
      default: "free",
    },
    cvText: {
      type: String,
      default: null,
    },
    coverLetterUrl: { type: String, default: null },
    coverLetterFileName: { type: String, default: null },
    coverLetterText: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: "users",
  },
);

// Hash password before saving
userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare passwords
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
