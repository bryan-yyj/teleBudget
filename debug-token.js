require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;

console.log('=== TOKEN DEBUG ===');
console.log('Token exists:', !!token);
console.log('Token length:', token ? token.length : 0);
console.log('Token starts with number:', token ? /^\d/.test(token) : false);
console.log('Token contains colon:', token ? token.includes(':') : false);
console.log('First 10 chars:', token ? token.substring(0, 10) + '...' : 'none');
console.log('Last 10 chars:', token ? '...' + token.substring(token.length - 10) : 'none');

// Check for invisible characters
if (token) {
  const hasInvisibleChars = /[\x00-\x1F\x7F-\x9F]/.test(token);
  console.log('Has invisible chars:', hasInvisibleChars);
  
  // Show actual bytes for first few characters
  console.log('First 5 char codes:', token.substring(0, 5).split('').map(c => c.charCodeAt(0)));
}