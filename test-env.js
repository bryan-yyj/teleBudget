require('dotenv').config();

console.log('🔍 Environment Variables Test:');
console.log('TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN);
console.log('OLLAMA_BASE_URL:', process.env.OLLAMA_BASE_URL);
console.log('DATABASE_PATH:', process.env.DATABASE_PATH);

// Test if the token format looks correct
const token = process.env.TELEGRAM_BOT_TOKEN;
if (token) {
  const parts = token.split(':');
  console.log('Token format check:');
  console.log('- Bot ID:', parts[0]);
  console.log('- Token length:', parts[1] ? parts[1].length : 'missing');
  console.log('- Format valid:', parts.length === 2 && parts[0].match(/^\d+$/) && parts[1].length > 30);
} else {
  console.log('❌ No token found in environment');
}