
const multer = require('multer');

const storage = multer.memoryStorage(); // <-- file lands in req.file.buffer, not saved to disk

const fileFilter = (req, file, cb) => {
 const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
 if (allowedTypes.includes(file.mimetype)) {
   cb(null, true);
 } else {
   cb(new Error('Invalid file type. Only PDF and Word documents are allowed.'));
 }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = upload;