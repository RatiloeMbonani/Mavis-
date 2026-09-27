const fs = require('fs');
const path = require('path');
const multer = require('multer');

const avatarDirectory = path.join(__dirname, '..', 'uploads', 'profile-avatars');
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const allowedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

fs.mkdirSync(avatarDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarDirectory);
  },
  filename: (req, file, cb) => {
    const originalExtension = path.extname(file.originalname).toLowerCase();
    const extension = allowedExtensions.has(originalExtension)
      ? originalExtension
      : `.${file.mimetype.split('/')[1]}`;
    const userId = req.user?.user_id || req.user?.id || 'user';

    cb(null, `${userId}-avatar-${Date.now()}${extension}`);
  },
});

const avatarUpload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WEBP, and GIF images are allowed.'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

const uploadProfileAvatar = (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (!err) return next();

    return res.status(400).json({ error: err.message });
  });
};

module.exports = uploadProfileAvatar;
