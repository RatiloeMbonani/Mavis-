const User = require('../Models/userModel');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PDFParse } = require('pdf-parse');
const { uploadToBlob } = require('../Config/azureBlob');

const canAccessUser = (req, userId) => (
  ['admin', 'personnel'].includes(req.user?.role) || String(req.user?.user_id) === String(userId)
);

const hasValidInternalApiKey = (req) => {
  const configuredKey = process.env.INTERNAL_API_KEY;
  const providedKey = req.get('x-internal-api-key');

  return configuredKey && providedKey === configuredKey;
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

    res.json({ message: 'User deleted successfully' });
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
  const totalTokens = Number(
    req.body?.totalTokens ?? Number(promptTokens) + Number(responseTokens) + Number(thoughtsTokens)
  );

  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    return res.status(400).json({ error: 'totalTokens must be a positive number' });
  }

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { $inc: { tokenUsage: totalTokens } },
      { new: true, runValidators: true }
    ).select('tokenUsage tokenLimit subscriptionTier');

    if (!user) return res.status(404).json({ message: 'User not found' });

    const percentUsed = user.tokenLimit > 0
      ? Math.min((user.tokenUsage / user.tokenLimit) * 100, 100)
      : 100;

    res.json({
      tokenUsage: user.tokenUsage,
      tokenLimit: user.tokenLimit,
      tier: user.subscriptionTier,
      percentUsed,
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

    const user = await User.findById(req.params.userId).select('tokenUsage tokenLimit subscriptionTier');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const percentUsed = user.tokenLimit > 0
      ? Math.min((user.tokenUsage / user.tokenLimit) * 100, 100)
      : 100;

    res.json({
      tokenUsage: user.tokenUsage,
      tokenLimit: user.tokenLimit,
      tier: user.subscriptionTier,
      percentUsed,
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
  uploadCV,
  incrementTokenUsage,
  getUserQuota
};
