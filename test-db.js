// Quick database creation test
require('dotenv').config();
const Database = require('./src/database/Database');
const fs = require('fs');
const path = require('path');

console.log('🔍 Testing database creation...');
console.log('Current directory:', process.cwd());
console.log('Database path:', process.env.DATABASE_PATH || './data/telebudget.db');

Database.initialize()
  .then(() => {
    console.log('✅ Database created successfully!');
    
    // Check if file actually exists
    const dbPath = process.env.DATABASE_PATH || './data/telebudget.db';
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      console.log(`📊 Database file size: ${stats.size} bytes`);
      console.log(`📅 Created at: ${stats.birthtime}`);
    } else {
      console.log('❌ Database file not found after creation!');
    }
    
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Database creation failed:', error);
    process.exit(1);
  });