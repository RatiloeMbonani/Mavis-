const express = require('express');
const { uploadDocument, deleteDocument } = require('../Controllers/documentController');
const { protect } = require('../Middleware/authMiddleware');
const upload = require('../Middleware/upload'); 

const router = express.Router();

router.post('/documents', protect, upload.single('file'), uploadDocument);
router.delete('/documents/:documentId', protect, deleteDocument);

module.exports = router;