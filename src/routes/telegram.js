const express = require('express');
const crypto = require('crypto');
const TelegramBot = require('../services/TelegramBot');

const router = express.Router();

// Telegram webhook verification
function verifyTelegramWebhook(req, res, next) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Bot token not configured' });
  }

  // Verify the request is from Telegram
  const secretPath = crypto.createHmac('sha256', token).digest('hex');
  if (req.path !== `/telegram/${secretPath}` && req.path !== '/telegram') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  next();
}

// Telegram webhook endpoint
router.post('/telegram', verifyTelegramWebhook, async (req, res) => {
  try {
    const update = req.body;
    
    // Log the update for debugging (remove in production)
    console.log('Telegram update received:', JSON.stringify(update, null, 2));
    
    // Process the update asynchronously
    TelegramBot.processUpdate(update).catch(error => {
      console.error('Error processing Telegram update:', error);
    });
    
    // Respond quickly to Telegram
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Webhook setup endpoint (for development)
router.post('/telegram/setup-webhook', async (req, res) => {
  try {
    const success = await TelegramBot.setWebhook();
    res.json({ success, message: success ? 'Webhook set successfully' : 'Failed to set webhook' });
  } catch (error) {
    console.error('Error setting webhook:', error);
    res.status(500).json({ error: 'Failed to set webhook' });
  }
});

// Get webhook info (for debugging)
router.get('/telegram/webhook-info', async (req, res) => {
  try {
    if (!TelegramBot.bot) {
      return res.status(500).json({ error: 'Bot not initialized' });
    }
    
    const info = await TelegramBot.bot.getWebHookInfo();
    res.json(info);
  } catch (error) {
    console.error('Error getting webhook info:', error);
    res.status(500).json({ error: 'Failed to get webhook info' });
  }
});

module.exports = router;