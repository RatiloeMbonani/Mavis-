const jwt = require('jsonwebtoken');
require('dotenv').config();

const protect = (req, res, next) => {

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ message: 'Access token required' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });


    req.user = {
      id: decoded.userId || decoded.security_personnel_id,
      security_personnel_id: decoded.security_personnel_id,  
      user_id: decoded.user_id, 
      role: decoded.role
    };


    next();
  });
};

const authorizeUser = (req, res, next) => {
  if (req.user?.role !== 'user') return res.status(403).json({ message: 'Not authorized' });
  next();
};

const admin = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Not authorized' });
  next();
};

module.exports = { protect, authorizeUser, admin };
