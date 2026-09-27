const User = require('../Models/userModel');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs/promises');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const { uploadToBlob } = require('../Config/azureBlob');

const avatarDirectory = path.join(__dirname, '..', 'uploads', 'profile-avatars');
const DEFAULT_TOKEN_USAGE_HISTORY_DAYS = 30;
const MAX_TOKEN_USAGE_HISTORY_DAYS = 365;

const getRequestUserId = (req) => (
  req.user?.user_id || req.user?.id || req.user?.security_personnel_id
);

const canAccessUser = (req, userId) => (
  ['admin', 'personnel'].includes(req.user?.role) || String(getRequestUserId(req)) === String(userId)
);

const hasValidInternalApiKey = (req) => {
  const configuredKey = process.env.INTERNAL_API_KEY;
  const providedKey = req.get('x-internal-api-key');

  return configuredKey && providedKey === configuredKey;
};

const getDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

const parseHistoryDays = (value) => {
  const days = Number(value);

  if (!Number.isInteger(days) || days <= 0) {
    return DEFAULT_TOKEN_USAGE_HISTORY_DAYS;
  }

  return Math.min(days, MAX_TOKEN_USAGE_HISTORY_DAYS);
};

const normalizeTokenCount = (value) => {
  const tokenCount = Number(value ?? 0);

  return Number.isFinite(tokenCount) && tokenCount >= 0 ? tokenCount : null;
};

const buildDailyTokenUsageSeries = (tokenUsageDaily = [], days = DEFAULT_TOKEN_USAGE_HISTORY_DAYS) => {
  const usageByDate = new Map(
    tokenUsageDaily.map((entry) => [
      entry.date,
      {
        date: entry.date,
        promptTokens: entry.promptTokens || 0,
        responseTokens: entry.responseTokens || 0,
        thoughtsTokens: entry.thoughtsTokens || 0,
        totalTokens: entry.totalTokens || 0,
      },
    ])
  );

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (days - 1 - index));

    const dateKey = getDateKey(date);
    return usageByDate.get(dateKey) || {
      date: dateKey,
      promptTokens: 0,
      responseTokens: 0,
      thoughtsTokens: 0,
      totalTokens: 0,
    };
  });
};

const incrementUserTokenUsage = async (userId, usageDate, usageDelta) => {
  const incrementFields = {
    tokenUsage: usageDelta.totalTokens,
    'tokenUsageDaily.$.promptTokens': usageDelta.promptTokens,
    'tokenUsageDaily.$.responseTokens': usageDelta.responseTokens,
    'tokenUsageDaily.$.thoughtsTokens': usageDelta.thoughtsTokens,
    'tokenUsageDaily.$.totalTokens': usageDelta.totalTokens,
  };

  const existingDailyBucket = await User.findOneAndUpdate(
    { _id: userId, 'tokenUsageDaily.date': usageDate },
    { $inc: incrementFields },
    { new: true, runValidators: true }
  ).select('tokenUsage tokenLimit subscriptionTier tokenUsageDaily');

  if (existingDailyBucket) return existingDailyBucket;

  const createdDailyBucket = await User.findOneAndUpdate(
    { _id: userId, 'tokenUsageDaily.date': { $ne: usageDate } },
    {
      $inc: { tokenUsage: usageDelta.totalTokens },
      $push: {
        tokenUsageDaily: {
          date: usageDate,
          promptTokens: usageDelta.promptTokens,
          responseTokens: usageDelta.responseTokens,
          thoughtsTokens: usageDelta.thoughtsTokens,
          totalTokens: usageDelta.totalTokens,
        },
      },
    },
    { new: true, runValidators: true }
  ).select('tokenUsage tokenLimit subscriptionTier tokenUsageDaily');

  if (createdDailyBucket) return createdDailyBucket;

  return User.findOneAndUpdate(
    { _id: userId, 'tokenUsageDaily.date': usageDate },
    { $inc: incrementFields },
    { new: true, runValidators: true }
  ).select('tokenUsage tokenLimit subscriptionTier tokenUsageDaily');
};

const getAvatarPathFromUrl = (avatarUrl) => {
  const publicPrefix = '/uploads/profile-avatars/';

  if (!avatarUrl || !avatarUrl.startsWith(publicPrefix)) return null;

  return path.join(avatarDirectory, path.basename(avatarUrl));
};

const deleteFileIfExists = async (filePath) => {
  if (!filePath) return;

  try {
    await fs.unlink(filePath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to delete file:', err.message);
    }
  }
};

// CREATE (Register)
const addNewUser = async (req, res) => {
  try {
    const { email, password, ...rest } = req.body;
    console.log("reached request body")

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'Email already in use' });
    console.log("reached database")

    const user = await User.create({ email, password, ...rest });

    const userSafe = user.toObject();
    delete userSafe.password;

    res.status(201).json(userSafe);
  } catch (err) {
  console.error("addNewUser error:", err);
  res.status(500).json({ error: err.message });
}
};

// LOGIN
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;


    const user = await User.findOne({ email }).select('+password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { user_id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET ALL - only the admin is authorize to perform this query 
const getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET ONE
const getUserWithID = async (req, res) => {
  try {
    if (!canAccessUser(req, req.params.userId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const user = await User.findById(req.params.userId).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UPDATE
const updateUser = async (req, res) => {
  try {
    if (!canAccessUser(req, req.params.userId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // if password is being changed here too, hash it — don't allow raw overwrite
    if (req.body.password) {
      req.body.password = await bcrypt.hash(req.body.password, 10);
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      req.body,
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) return res.status(404).json({ message: 'User not found' });

    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE
const deleteUser = async (req, res) => {
  try {
    if (!canAccessUser(req, req.params.userId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const deleted = await User.findByIdAndDelete(req.params.userId);
    if (!deleted) return res.status(404).json({ message: 'User not found' });

    await deleteFileIfExists(getAvatarPathFromUrl(deleted.profileAvatarUrl));

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteMyAccount = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'Access token required' });

    const deleted = await User.findByIdAndDelete(userId);

    if (!deleted) return res.status(404).json({ message: 'User not found' });

    await deleteFileIfExists(getAvatarPathFromUrl(deleted.profileAvatarUrl));

    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const uploadProfileAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const userId = getRequestUserId(req);
    if (!userId) {
      await deleteFileIfExists(req.file.path);
      return res.status(401).json({ message: 'Access token required' });
    }

    const avatarUrl = `/uploads/profile-avatars/${req.file.filename}`;
    const currentUser = await User.findById(userId).select('profileAvatarUrl');

    if (!currentUser) {
      await deleteFileIfExists(req.file.path);
      return res.status(404).json({ message: 'User not found' });
    }

    const previousAvatarPath = getAvatarPathFromUrl(currentUser.profileAvatarUrl);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        profileAvatarUrl: avatarUrl,
        profileAvatarFileName: req.file.originalname,
      },
      { new: true, runValidators: true }
    ).select('-password');

    await deleteFileIfExists(previousAvatarPath);

    res.json({ message: 'Profile avatar uploaded successfully', user: updatedUser });
  } catch (err) {
    if (req.file?.path) {
      await deleteFileIfExists(req.file.path);
    }

    res.status(500).json({ error: err.message });
  }
};

const deleteProfileAvatar = async (req, res) => {
  try {
    const userId = getRequestUserId(req);
    if (!userId) return res.status(401).json({ message: 'Access token required' });

    const currentUser = await User.findById(userId).select('profileAvatarUrl');
    if (!currentUser) return res.status(404).json({ message: 'User not found' });

    const avatarPath = getAvatarPathFromUrl(currentUser.profileAvatarUrl);
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        profileAvatarUrl: null,
        profileAvatarFileName: null,
      },
      { new: true, runValidators: true }
    ).select('-password');

    await deleteFileIfExists(avatarPath);

    res.json({ message: 'Profile avatar deleted successfully', user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
//upload cv 
const uploadCV = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Extract text from the PDF buffer BEFORE uploading (we already have it in memory)
    let extractedText = '';
    try {
      const parser = new PDFParse({ data: req.file.buffer });
      try {
        const parsed = await parser.getText();
        extractedText = parsed.text.trim();
      } finally {
        await parser.destroy();
      }
    } catch (parseErr) {
      console.error('PDF parsing failed:', parseErr.message);
    }

    const blobUrl = await uploadToBlob(req.file.buffer, req.file.originalname, req.user.user_id);

    const user = await User.findByIdAndUpdate(
      req.user.user_id,
      {
        cvUrl: blobUrl,
        cvFileName: req.file.originalname,
        cvText: extractedText,
      },
      { returnDocument: 'after' }
    ).select('-password -cvText');

    res.json({ message: 'CV uploaded successfully', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const incrementTokenUsage = async (req, res) => {
  if (!hasValidInternalApiKey(req)) {
    return res.status(401).json({ error: 'Invalid internal API key' });
  }

  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ error: 'Invalid userId' });
  }

  const {
    promptTokens = 0,
    responseTokens = 0,
    thoughtsTokens = 0,
  } = req.body || {};
  const promptTokenCount = normalizeTokenCount(promptTokens);
  const responseTokenCount = normalizeTokenCount(responseTokens);
  const thoughtsTokenCount = normalizeTokenCount(thoughtsTokens);

  if (
    promptTokenCount === null
    || responseTokenCount === null
    || thoughtsTokenCount === null
  ) {
    return res.status(400).json({ error: 'Token counts must be non-negative numbers' });
  }

  const totalTokens = Number(
    req.body?.totalTokens ?? promptTokenCount + responseTokenCount + thoughtsTokenCount
  );

  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    return res.status(400).json({ error: 'totalTokens must be a positive number' });
  }

  try {
    const usageDate = getDateKey();
    const user = await incrementUserTokenUsage(
      userId,
      usageDate,
      {
        promptTokens: promptTokenCount,
        responseTokens: responseTokenCount,
        thoughtsTokens: thoughtsTokenCount,
        totalTokens,
      }
    );

    if (!user) return res.status(404).json({ message: 'User not found' });

    const percentUsed = user.tokenLimit > 0
      ? Math.min((user.tokenUsage / user.tokenLimit) * 100, 100)
      : 100;

    res.json({
      tokenUsage: user.tokenUsage,
      tokenLimit: user.tokenLimit,
      tier: user.subscriptionTier,
      percentUsed,
      dailyTokenUsage: buildDailyTokenUsageSeries(user.tokenUsageDaily),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getUserQuota = async (req, res) => {
  try {
    if (!canAccessUser(req, req.params.userId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const historyDays = parseHistoryDays(req.query.days);
    const user = await User.findById(req.params.userId).select('tokenUsage tokenLimit subscriptionTier tokenUsageDaily');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const percentUsed = user.tokenLimit > 0
      ? Math.min((user.tokenUsage / user.tokenLimit) * 100, 100)
      : 100;

    res.json({
      tokenUsage: user.tokenUsage,
      tokenLimit: user.tokenLimit,
      tier: user.subscriptionTier,
      percentUsed,
      dailyTokenUsage: buildDailyTokenUsageSeries(user.tokenUsageDaily, historyDays),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  addNewUser,
  loginUser,
  getUsers,
  getUserWithID,
  updateUser,
  deleteUser,
  deleteMyAccount,
  uploadProfileAvatar,
  deleteProfileAvatar,
  uploadCV,
  incrementTokenUsage,
  getUserQuota
};
