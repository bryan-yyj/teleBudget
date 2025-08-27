const Database = require('../database/Database');
const OllamaService = require('./OllamaService');
const TelegramBot = require('./TelegramBot');
const Transaction = require('../models/Transaction');
const Receipt = require('../models/Receipt');

class ProcessingQueue {
  constructor() {
    this.isProcessing = false;
    this.processingInterval = null;
    this.maxConcurrent = 2;
    this.currentProcessing = 0;
    this.webSocketEmitter = null;
  }

  setWebSocketEmitter(emitter) {
    this.webSocketEmitter = emitter;
  }

  async initialize() {
    // Start processing queue every 10 seconds
    this.processingInterval = setInterval(() => {
      this.processQueue().catch(error => {
        console.error('Error processing queue:', error);
      });
    }, 10000);

    console.log('✅ Processing queue initialized');
  }

  async add(type, payload) {
    try {
      const result = await Database.run(
        `INSERT INTO processing_queue (type, payload) VALUES (?, ?)`,
        [type, JSON.stringify(payload)]
      );
      
      console.log(`Added ${type} job to queue:`, result.id);
      return result.id;
    } catch (error) {
      console.error('Error adding job to queue:', error);
      throw error;
    }
  }

  async processQueue() {
    if (this.currentProcessing >= this.maxConcurrent) {
      return;
    }

    try {
      // Get pending jobs
      const jobs = await Database.all(
        `SELECT * FROM processing_queue 
         WHERE status = 'pending' AND attempts < max_attempts 
         ORDER BY created_at ASC 
         LIMIT ?`,
        [this.maxConcurrent - this.currentProcessing]
      );

      if (jobs.length === 0) {
        return;
      }

      // Process jobs concurrently
      const promises = jobs.map(job => this.processJob(job));
      await Promise.all(promises);

    } catch (error) {
      console.error('Error in processQueue:', error);
    }
  }

  async processJob(job) {
    this.currentProcessing++;
    
    try {
      // Mark job as processing
      await Database.run(
        `UPDATE processing_queue 
         SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [job.id]
      );

      const payload = JSON.parse(job.payload);
      let result;

      switch (job.type) {
        case 'receipt':
          result = await this.processReceiptJob(payload);
          break;
        case 'email':
          result = await this.processEmailJob(payload);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }

      // Mark job as completed
      await Database.run(
        `UPDATE processing_queue 
         SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [job.id]
      );

      console.log(`✅ Completed ${job.type} job:`, job.id);

    } catch (error) {
      console.error(`❌ Error processing ${job.type} job:`, job.id, error);
      
      // Mark job as failed or retry
      const newStatus = job.attempts >= job.max_attempts ? 'failed' : 'pending';
      await Database.run(
        `UPDATE processing_queue 
         SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [newStatus, error.message, job.id]
      );
    } finally {
      this.currentProcessing--;
    }
  }

  async processReceiptJob(payload) {
    const { receiptId, transactionId, userId, chatId, imagePath } = payload;

    try {
      // Update receipt status
      await Receipt.updateProcessingStatus(receiptId, 'processing');

      // Notify WebSocket clients that processing started
      if (this.webSocketEmitter) {
        this.webSocketEmitter.notifyReceiptProcessingStarted(userId, receiptId, transactionId);
      }

      // Process with Ollama AI
      const aiResult = await OllamaService.processReceipt(imagePath);
      
      if (!aiResult || !aiResult.amount) {
        throw new Error('AI processing failed to extract transaction data');
      }

      // Update transaction with AI results
      const updatedTransaction = await Transaction.update(transactionId, {
        amount: parseFloat(aiResult.amount),
        description: aiResult.description || 'AI processed receipt',
        category: aiResult.category || 'Others',
        merchant: aiResult.merchant || 'Unknown',
        transactionDate: aiResult.date || new Date().toISOString(),
        confidenceScore: aiResult.confidence || 0.5,
        isVerified: aiResult.confidence > 0.8 ? 1 : 0
      });

      // Update receipt with AI results
      await Receipt.updateProcessingStatus(receiptId, 'processed', {
        confidence: aiResult.confidence,
        rawResponse: aiResult
      });

      // Notify WebSocket clients that processing completed
      if (this.webSocketEmitter) {
        this.webSocketEmitter.notifyReceiptProcessingCompleted(userId, receiptId, updatedTransaction);
        this.webSocketEmitter.notifyTransactionUpdated(userId, updatedTransaction);
      }

      // Notify user via Telegram
      if (chatId) {
        const receipt = await Receipt.findById(receiptId);
        await TelegramBot.notifyTransactionProcessed(chatId, updatedTransaction, receipt);
      }

      return { success: true, transaction: updatedTransaction };

    } catch (error) {
      // Update receipt status to failed
      await Receipt.updateProcessingStatus(receiptId, 'failed');
      
      // Notify WebSocket clients that processing failed
      if (this.webSocketEmitter) {
        this.webSocketEmitter.notifyReceiptProcessingFailed(userId, receiptId, error.message);
      }
      
      throw error;
    }
  }

  async processEmailJob(payload) {
    // This will be implemented when we add email processing
    const { emailId, userId, emailData } = payload;
    
    // For now, just mark as completed
    console.log('Email processing not yet implemented:', emailId);
    return { success: true };
  }

  async getQueueStatus() {
    try {
      const stats = await Database.get(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM processing_queue
      `);

      return {
        ...stats,
        currentProcessing: this.currentProcessing,
        maxConcurrent: this.maxConcurrent
      };
    } catch (error) {
      console.error('Error getting queue status:', error);
      throw error;
    }
  }

  async retryFailedJobs(limit = 10) {
    try {
      const result = await Database.run(
        `UPDATE processing_queue 
         SET status = 'pending', attempts = 0, error_message = NULL, updated_at = CURRENT_TIMESTAMP 
         WHERE status = 'failed' AND id IN (
           SELECT id FROM processing_queue WHERE status = 'failed' LIMIT ?
         )`,
        [limit]
      );

      console.log(`Retried ${result.changes} failed jobs`);
      return result.changes;
    } catch (error) {
      console.error('Error retrying failed jobs:', error);
      throw error;
    }
  }

  async clearCompletedJobs(olderThanDays = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await Database.run(
        `DELETE FROM processing_queue 
         WHERE status = 'completed' AND updated_at < ?`,
        [cutoffDate.toISOString()]
      );

      console.log(`Cleared ${result.changes} completed jobs older than ${olderThanDays} days`);
      return result.changes;
    } catch (error) {
      console.error('Error clearing completed jobs:', error);
      throw error;
    }
  }

  shutdown() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    console.log('Processing queue shut down');
  }
}

module.exports = new ProcessingQueue();