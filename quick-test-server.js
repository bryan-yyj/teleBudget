const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error('Set TELEGRAM_BOT_TOKEN in .env first.');

console.log('🤖 Testing Telegram bot...');

try {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });
  
  console.log('✅ Bot initialized with polling');
  
  // Set up commands
  bot.setMyCommands([
    { command: 'start', description: 'Start using TeleBudget' },
    { command: 'help', description: 'Get help' }
  ]).then(() => {
    console.log('✅ Commands set successfully!');
  }).catch(err => {
    console.log('❌ Failed to set commands:', err.message);
  });
  
  // Handle messages
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    console.log(`📨 Received message: "${text}" from ${msg.from.first_name}`);
    
    if (text === '/start') {
      bot.sendMessage(chatId, '🎉 Welcome to TeleBudget! Your bot is working perfectly!');
    } else if (text === '/help') {
      bot.sendMessage(chatId, '📋 Available commands:\n/start - Welcome message\n/help - This help message');
    } else {
      bot.sendMessage(chatId, `✅ Bot received: "${text}"`);
    }
  });
  
  bot.on('polling_error', (error) => {
    console.log('❌ Polling error:', error.message);
  });
  
  console.log('🚀 Bot is running! Send /start to your bot in Telegram');
  console.log('Press Ctrl+C to stop');
  
} catch (error) {
  console.log('❌ Failed to start bot:', error.message);
}
