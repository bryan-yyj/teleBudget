const Database = require('../database/Database');

class User {
  static async findByTelegramId(telegramId) {
    try {
      const user = await Database.get(
        'SELECT * FROM users WHERE telegram_id = ?',
        [telegramId]
      );
      return user;
    } catch (error) {
      console.error('Error finding user by telegram ID:', error);
      throw error;
    }
  }

  static async findById(id) {
    try {
      const user = await Database.get(
        'SELECT * FROM users WHERE id = ?',
        [id]
      );
      return user;
    } catch (error) {
      console.error('Error finding user by ID:', error);
      throw error;
    }
  }

  static async create(userData) {
    try {
      const result = await Database.run(
        `INSERT INTO users (telegram_id, username, first_name, last_name)
         VALUES (?, ?, ?, ?)`,
        [
          userData.telegramId,
          userData.username,
          userData.firstName,
          userData.lastName
        ]
      );
      
      return await this.findById(result.id);
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  static async updateUserInfo(userId, userInfo) {
    try {
      await Database.run(
        `UPDATE users 
         SET username = ?, first_name = ?, last_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [userInfo.username, userInfo.firstName, userInfo.lastName, userId]
      );
      
      return await this.findById(userId);
    } catch (error) {
      console.error('Error updating user info:', error);
      throw error;
    }
  }

  static async getAllUsers() {
    try {
      const users = await Database.all('SELECT * FROM users ORDER BY created_at DESC');
      return users;
    } catch (error) {
      console.error('Error getting all users:', error);
      throw error;
    }
  }
}

module.exports = User;