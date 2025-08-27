const Database = require('../database/Database');

class Receipt {
  static async findById(id) {
    try {
      const receipt = await Database.get(
        'SELECT * FROM receipts WHERE id = ?',
        [id]
      );
      return receipt;
    } catch (error) {
      console.error('Error finding receipt by ID:', error);
      throw error;
    }
  }

  static async findByTransactionId(transactionId) {
    try {
      const receipts = await Database.all(
        'SELECT * FROM receipts WHERE transaction_id = ?',
        [transactionId]
      );
      return receipts;
    } catch (error) {
      console.error('Error finding receipts by transaction ID:', error);
      throw error;
    }
  }

  static async create(receiptData) {
    try {
      const result = await Database.run(
        `INSERT INTO receipts 
         (transaction_id, image_path, ai_confidence, ai_raw_response, processing_status)
         VALUES (?, ?, ?, ?, ?)`,
        [
          receiptData.transactionId,
          receiptData.imagePath,
          receiptData.aiConfidence,
          JSON.stringify(receiptData.aiRawResponse),
          receiptData.processingStatus || 'pending'
        ]
      );
      
      return await this.findById(result.id);
    } catch (error) {
      console.error('Error creating receipt:', error);
      throw error;
    }
  }

  static async updateProcessingStatus(id, status, aiData = {}) {
    try {
      await Database.run(
        `UPDATE receipts 
         SET processing_status = ?, 
             ai_confidence = COALESCE(?, ai_confidence),
             ai_raw_response = COALESCE(?, ai_raw_response)
         WHERE id = ?`,
        [status, aiData.confidence, JSON.stringify(aiData.rawResponse), id]
      );
      
      return await this.findById(id);
    } catch (error) {
      console.error('Error updating receipt processing status:', error);
      throw error;
    }
  }

  static async getPendingProcessing(limit = 10) {
    try {
      const receipts = await Database.all(
        `SELECT r.*, t.user_id 
         FROM receipts r 
         JOIN transactions t ON r.transaction_id = t.id 
         WHERE r.processing_status = 'pending' 
         ORDER BY r.created_at ASC 
         LIMIT ?`,
        [limit]
      );
      return receipts;
    } catch (error) {
      console.error('Error getting pending receipts:', error);
      throw error;
    }
  }

  static async getFailedProcessing(limit = 10) {
    try {
      const receipts = await Database.all(
        `SELECT r.*, t.user_id 
         FROM receipts r 
         JOIN transactions t ON r.transaction_id = t.id 
         WHERE r.processing_status = 'failed' 
         ORDER BY r.created_at DESC 
         LIMIT ?`,
        [limit]
      );
      return receipts;
    } catch (error) {
      console.error('Error getting failed receipts:', error);
      throw error;
    }
  }

  static async delete(id) {
    try {
      const result = await Database.run(
        'DELETE FROM receipts WHERE id = ?',
        [id]
      );
      
      return result.changes > 0;
    } catch (error) {
      console.error('Error deleting receipt:', error);
      throw error;
    }
  }
}

module.exports = Receipt;