require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

console.log('🔍 Debugging bot token...');
console.log('Raw token from env:', JSON.stringify(process.env.TELEGRAM_BOT_TOKEN));
console.log('Token length:', process.env.TELEGRAM_BOT_TOKEN?.length);

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token === 'your_telegram_bot_token_from_botfather') {
  console.log('❌ Token not set or still default value');
  process.exit(1);
}

console.log('✅ Token loaded from .env file');

// Test 1: Simple API call without polling
console.log('\n📡 Test 1: Simple API call...');
const testBot = new TelegramBot(token);

testBot.getMe()
  .then(result => {
    console.log('✅ getMe() success:', result.username);
    
    // Test 2: Try setting commands
    console.log('\n📋 Test 2: Setting commands...');
    return testBot.setMyCommands([
      { command: 'start', description: 'Start using TeleBudget' },
      { command: 'help', description: 'Get help' }
    ]);
  })
  .then(() => {
    console.log('✅ Commands set successfully!');
    
    // Test 3: Try with polling
    console.log('\n🔄 Test 3: Testing with polling...');
    const pollingBot = new TelegramBot(token, { polling: true });
    
    pollingBot.on('polling_error', (error) => {
      console.log('❌ Polling error:', error.message);
      pollingBot.stopPolling();
    });
    
    setTimeout(() => {
      console.log('✅ Polling test completed');
      pollingBot.stopPolling();
      process.exit(0);
    }, 3000);
    
  })
  .catch(error => {
    console.log('❌ Error:', error.message);
    console.log('Full error:', error);
  });