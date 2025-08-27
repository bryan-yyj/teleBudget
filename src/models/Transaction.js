const Database = require('../database/Database');
const moment = require('moment-timezone');

class Transaction {
  static async findById(id) {
    try {
      const transaction = await Database.get(
        `SELECT t.*, c.name as category_name, c.icon as category_icon 
         FROM transactions t 
         LEFT JOIN categories c ON t.category = c.name 
         WHERE t.id = ?`,
        [id]
      );
      return transaction;
    } catch (error) {
      console.error('Error finding transaction by ID:', error);
      throw error;
    }
  }

  static async findByUser(userId, options = {}) {
    try {
      let sql = `
        SELECT t.*, c.name as category_name, c.icon as category_icon 
        FROM transactions t 
        LEFT JOIN categories c ON t.category = c.name 
        WHERE t.user_id = ?
      `;
      const params = [userId];

      if (options.startDate) {
        sql += ' AND t.transaction_date >= ?';
        params.push(options.startDate);
      }

      if (options.endDate) {
        sql += ' AND t.transaction_date <= ?';
        params.push(options.endDate);
      }

      if (options.category) {
        sql += ' AND t.category = ?';
        params.push(options.category);
      }

      if (options.source) {
        sql += ' AND t.source = ?';
        params.push(options.source);
      }

      sql += ' ORDER BY t.transaction_date DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      const transactions = await Database.all(sql, params);
      return transactions;
    } catch (error) {
      console.error('Error finding transactions by user:', error);
      throw error;
    }
  }

  static async create(transactionData) {
    try {
      const result = await Database.run(
        `INSERT INTO transactions 
         (user_id, amount, currency, description, category, merchant, transaction_date, 
          source, source_reference, confidence_score, is_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transactionData.userId,
          transactionData.amount,
          transactionData.currency || 'SGD',
          transactionData.description,
          transactionData.category,
          transactionData.merchant,
          transactionData.transactionDate,
          transactionData.source,
          transactionData.sourceReference,
          transactionData.confidenceScore || 1.0,
          transactionData.isVerified || 0
        ]
      );
      
      return await this.findById(result.id);
    } catch (error) {
      console.error('Error creating transaction:', error);
      throw error;
    }
  }

  static async update(id, updateData) {
    try {
      const fields = [];
      const values = [];

      Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(updateData[key]);
        }
      });

      if (fields.length === 0) {
        throw new Error('No fields to update');
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);

      await Database.run(
        `UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`,
        values
      );
      
      return await this.findById(id);
    } catch (error) {
      console.error('Error updating transaction:', error);
      throw error;
    }
  }

  static async delete(id) {
    try {
      const result = await Database.run(
        'DELETE FROM transactions WHERE id = ?',
        [id]
      );
      
      return result.changes > 0;
    } catch (error) {
      console.error('Error deleting transaction:', error);
      throw error;
    }
  }

  static async findDuplicate(userId, amount, transactionDate, source, tolerance = 300000) {
    try {
      const dateStart = moment(transactionDate).subtract(tolerance, 'milliseconds').toISOString();
      const dateEnd = moment(transactionDate).add(tolerance, 'milliseconds').toISOString();
      
      const duplicate = await Database.get(
        `SELECT * FROM transactions 
         WHERE user_id = ? 
         AND ABS(amount - ?) < 0.01 
         AND transaction_date BETWEEN ? AND ?
         AND source != ?
         ORDER BY ABS(julianday(transaction_date) - julianday(?))
         LIMIT 1`,
        [userId, amount, dateStart, dateEnd, source, transactionDate]
      );
      
      return duplicate;
    } catch (error) {
      console.error('Error finding duplicate transaction:', error);
      throw error;
    }
  }

  static async getMonthlyStats(userId, year, month) {
    try {
      const startDate = moment.tz([year, month - 1, 1], 'Asia/Singapore').toISOString();
      const endDate = moment.tz([year, month - 1, 1], 'Asia/Singapore').endOf('month').toISOString();
      
      const stats = await Database.get(
        `SELECT 
          COUNT(*) as transaction_count,
          SUM(amount) as total_amount,
          AVG(amount) as average_amount,
          MIN(amount) as min_amount,
          MAX(amount) as max_amount
         FROM transactions 
         WHERE user_id = ? 
         AND transaction_date BETWEEN ? AND ?`,
        [userId, startDate, endDate]
      );

      const categoryStats = await Database.all(
        `SELECT 
          category,
          COUNT(*) as count,
          SUM(amount) as total,
          AVG(amount) as average
         FROM transactions 
         WHERE user_id = ? 
         AND transaction_date BETWEEN ? AND ?
         GROUP BY category
         ORDER BY total DESC`,
        [userId, startDate, endDate]
      );

      return {
        ...stats,
        categories: categoryStats
      };
    } catch (error) {
      console.error('Error getting monthly stats:', error);
      throw error;
    }
  }

  static async getRecentUnverified(userId, limit = 10) {
    try {
      const transactions = await Database.all(
        `SELECT t.*, c.name as category_name, c.icon as category_icon 
         FROM transactions t 
         LEFT JOIN categories c ON t.category = c.name 
         WHERE t.user_id = ? AND t.is_verified = 0 AND t.confidence_score < 0.9
         ORDER BY t.created_at DESC
         LIMIT ?`,
        [userId, limit]
      );
      return transactions;
    } catch (error) {
      console.error('Error getting unverified transactions:', error);
      throw error;
    }
  }
}

module.exports = Transaction;