const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

class Database {
  constructor() {
    this.db = null;
    this.dbPath = process.env.DATABASE_PATH || './data/telebudget.db';
  }

  initialize() {
    return new Promise((resolve, reject) => {
      // Ensure the data directory exists
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        console.log(`Creating directory: ${dbDir}`);
        fs.mkdirSync(dbDir, { recursive: true });
      }

      console.log(`Database path: ${this.dbPath}`);
      
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          reject(err);
          return;
        }
        
        console.log('📦 Connected to SQLite database');
        this.createTables()
          .then(() => {
            console.log('✅ Database tables initialized');
            resolve();
          })
          .catch(reject);
      });
    });
  }

  createTables() {
    const schemas = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Transactions table
      `CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'SGD',
        description TEXT,
        category TEXT,
        merchant TEXT,
        transaction_date DATETIME NOT NULL,
        source TEXT NOT NULL, -- 'telegram', 'email', 'manual'
        source_reference TEXT, -- message_id, email_id, etc.
        confidence_score REAL DEFAULT 1.0,
        is_verified BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      // Receipts table
      `CREATE TABLE IF NOT EXISTS receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        ai_confidence REAL,
        ai_raw_response TEXT,
        processing_status TEXT DEFAULT 'pending', -- pending, processed, failed
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (transaction_id) REFERENCES transactions (id)
      )`,


      // Categories table
      `CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        is_system BOOLEAN DEFAULT 0,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )`,

      // Processing queue table
      `CREATE TABLE IF NOT EXISTS processing_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, -- 'receipt', 'email'
        status TEXT DEFAULT 'pending', -- pending, processing, completed, failed
        payload TEXT NOT NULL, -- JSON data
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // App settings table
      `CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id)',
      'CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (transaction_date)',
      'CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions (source)',
      'CREATE INDEX IF NOT EXISTS idx_receipts_transaction_id ON receipts (transaction_id)',
      'CREATE INDEX IF NOT EXISTS idx_processing_queue_status ON processing_queue (status)'
    ];

    return new Promise((resolve, reject) => {
      let completed = 0;
      const total = schemas.length + indexes.length;

      const checkCompletion = () => {
        completed++;
        if (completed === total) resolve();
      };

      schemas.forEach(schema => {
        this.db.run(schema, (err) => {
          if (err) {
            console.error('Error creating table:', err);
            reject(err);
            return;
          }
          checkCompletion();
        });
      });

      indexes.forEach(index => {
        this.db.run(index, (err) => {
          if (err) {
            console.error('Error creating index:', err);
            reject(err);
            return;
          }
          checkCompletion();
        });
      });
    });
  }

  // Insert default categories
  insertDefaultCategories() {
    const defaultCategories = [
      { name: 'Food & Dining', icon: '🍽️', color: '#FF6B6B' },
      { name: 'Transportation', icon: '🚗', color: '#4ECDC4' },
      { name: 'Shopping', icon: '🛍️', color: '#45B7D1' },
      { name: 'Entertainment', icon: '🎬', color: '#FFA07A' },
      { name: 'Bills & Utilities', icon: '💡', color: '#98D8C8' },
      { name: 'Healthcare', icon: '⚕️', color: '#F7DC6F' },
      { name: 'Education', icon: '📚', color: '#BB8FCE' },
      { name: 'Others', icon: '📦', color: '#95A5A6' }
    ];

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO categories (name, icon, color, is_system)
      VALUES (?, ?, ?, 1)
    `);

    defaultCategories.forEach(category => {
      stmt.run(category.name, category.icon, category.color);
    });

    stmt.finalize();
  }

  getDb() {
    return this.db;
  }

  close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('Error closing database:', err);
          } else {
            console.log('📦 Database connection closed');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // Helper method for running queries with promises
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  // Helper method for getting single row
  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  // Helper method for getting multiple rows
  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
}

module.exports = new Database();