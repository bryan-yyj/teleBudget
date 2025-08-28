const https = require('https');

// Your bot token from .env
const BOT_TOKEN = '8493139780:AAFIKXgSz52zkIIsE_hkllTO1RBmkBvt5k4';

console.log('🤖 Testing Telegram bot token...');
console.log('Token:', BOT_TOKEN);

// Test the bot token by calling getMe API
const url = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;

https.get(url, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
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
        console.log('Error:', response.description);
      }
    } catch (error) {
      console.log('❌ Failed to parse response:', error.message);
      console.log('Raw response:', data);
    }
  });
}).on('error', (error) => {
  console.log('❌ Network error:', error.message);
});