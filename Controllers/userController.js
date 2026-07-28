const User = require('../models/userModel');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const canAccessUser = (req, userId) => (
  req.user?.role === 'personnel' || String(req.user?.user_id) === String(userId)
);

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
    res.status(500).json({ error: err.message });
    console.log("the error is not in the controller")
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
      { user_id: user._id, role: user.role },   // <-- real role from DB, not hardcoded
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

module.exports = {
  addNewUser,
  loginUser,
  getUsers,
  getUserWithID,
  updateUser,
  deleteUser
};