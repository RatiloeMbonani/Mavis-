const express = require('express');
const {
  addNewUser,
  loginUser,
  getUsers,
  getUserWithID,
  updateUser,
  deleteUser,
  uploadCV,
  incrementTokenUsage,
  getUserQuota
} = require('../Controllers/userController.js');
const {
  protect,
  admin
} = require('../Middleware/authMiddleware');
const {authLimiter} = require('../Middleware/rateLimit.js')
const upload = require('../Middleware/upload');


const router = express.Router();

// Auth endpoints
router.post('/auth/register', addNewUser);
router.post('/auth/login', authLimiter, loginUser);


router.post('/users/me/cv', protect, upload.single('cv'), uploadCV);


router.get('/users', protect, admin, getUsers);
router.patch('/users/:userId/token-usage', incrementTokenUsage);
router.get('/users/:userId/quota', protect, getUserQuota);
router.get('/users/:userId', protect, getUserWithID);
router.put('/users/:userId', protect, updateUser);
router.delete('/users/:userId', protect, deleteUser);

module.exports = router;
