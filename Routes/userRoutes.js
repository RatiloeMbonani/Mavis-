const express = require('express');
const {
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
} = require('../Controllers/userController.js');
const {
  protect,
  admin
} = require('../Middleware/authMiddleware');
const {authLimiter} = require('../Middleware/rateLimit.js')
const upload = require('../Middleware/upload');
const avatarUpload = require('../Middleware/avatarUpload');


const router = express.Router();

// Auth endpoints
router.post('/auth/register', addNewUser);
router.post('/auth/login', authLimiter, loginUser);


router.post('/users/me/cv', protect, upload.single('cv'), uploadCV);
router.post('/users/me/avatar', protect, avatarUpload, uploadProfileAvatar);
router.patch('/users/me/avatar', protect, avatarUpload, uploadProfileAvatar);
router.delete('/users/me/avatar', protect, deleteProfileAvatar);
router.delete('/users/me', protect, deleteMyAccount);


router.get('/users', protect, admin, getUsers);
router.patch('/users/:userId/token-usage', incrementTokenUsage);
router.get('/users/:userId/quota', protect, getUserQuota);
router.get('/users/:userId', protect, getUserWithID);
router.put('/users/:userId', protect, updateUser);
router.delete('/users/:userId', protect, deleteUser);

module.exports = router;
