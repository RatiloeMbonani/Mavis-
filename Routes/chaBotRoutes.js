const express = require('express');
const router = express.Router();
const { handleMarketingChatStream } = require('../Controllers/chatBot');

router.post('/chat', handleMarketingChatStream);

module.exports = router;
