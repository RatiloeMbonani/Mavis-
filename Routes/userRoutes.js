const express = require('express');
const {
  addNewUser,
  loginUser,
  getUsers,
  getUserWithID,
  updateUser,
  deleteUser,
} = require('../controllers/userController.js');
const { 
  protect, 
  admin 
} = require('../Middleware/authMiddleware');

const router = express.Router();

// Auth endpoints
router.post('/auth/register', addNewUser);
router.post('/auth/login', loginUser);



router.get('/users', protect, admin, getUsers);
router.get('/users/:userId', protect, getUserWithID);
router.put('/users/:userId', protect, updateUser);
router.delete('/users/:userId', protect, deleteUser);

module.exports = router;
