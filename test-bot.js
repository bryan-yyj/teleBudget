require('dotenv').config();
const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

console.log('🤖 Testing Telegram bot token...');
console.log('Token configured:', BOT_TOKEN ? 'Yes' : 'No');

if (!BOT_TOKEN || BOT_TOKEN === 'your_telegram_bot_token_here') {
  console.log('❌ No valid token found in .env file');
  console.log('📝 Please update TELEGRAM_BOT_TOKEN in your .env file with your actual bot token from @BotFather');
  process.exit(1);
}

console.log('Token format:', BOT_TOKEN.includes(':') ? 'Valid format' : 'Invalid format');

// Debug token details
console.log('🔍 Token Debug Info:');
console.log('- Token length:', BOT_TOKEN.length);
console.log('- Starts with digits:', /^\d+:/.test(BOT_TOKEN));
console.log('- First 10 chars:', BOT_TOKEN.substring(0, 10) + '...');
console.log('- Last 10 chars:', '...' + BOT_TOKEN.substring(BOT_TOKEN.length - 10));
console.log('- Has whitespace:', /\s/.test(BOT_TOKEN));

// Test the bot token by calling getMe API
const url = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;
console.log('🌐 Making request to:', url.replace(BOT_TOKEN, '[TOKEN_HIDDEN]'));

https.get(url, (res) => {
  console.log('📡 Response status:', res.statusCode);
  console.log('📡 Response headers:', res.headers);

  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('📦 Raw response length:', data.length);
    console.log('📦 Raw response:', data);

    try {
      const response = JSON.parse(data);

      if (response.ok) {
        console.log('✅ Bot token is VALID!');
        console.log('Bot info:', {
          id: response.result.id,
          username: response.result.username,
          first_name: response.result.first_name
        });
      } else {
        console.log('❌ Bot token is INVALID!');
        console.log('Error code:', response.error_code);
        console.log('Error description:', response.description);

        // Common error explanations
        if (response.error_code === 401) {
          console.log('💡 This means the token is completely wrong or the bot was deleted');
          console.log('💡 Try creating a new bot with @BotFather');
        }
      }
    } catch (error) {
      console.log('❌ Failed to parse response:', error.message);
      console.log('Raw response:', data);
    }
  });
}).on('error', (error) => {
  console.log('❌ Network error:', error.message);
});