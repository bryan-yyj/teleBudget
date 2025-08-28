const Database = require('../database/Database');
const OllamaService = require('./OllamaService');
const ReceiptProcessor = require('./ReceiptProcessor');
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
    this.receiptProcessor = new ReceiptProcessor();
    this.telegramBot = null;
  }

  setWebSocketEmitter(emitter) {
    this.webSocketEmitter = emitter;
  }

  setTelegramBot(telegramBot) {
    this.telegramBot = telegramBot;
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
    const { receiptId, transactionId, userId, chatId, imagePath, userDescription } = payload;

    try {
      // Update receipt status
      await Receipt.updateProcessingStatus(receiptId, 'processing');

      // Notify WebSocket clients that processing started
      if (this.webSocketEmitter) {
        this.webSocketEmitter.notifyReceiptProcessingStarted(userId, receiptId, transactionId);
      }

      // Step 1: Process image with EasyOCR
      console.log('🔍 Processing receipt with EasyOCR...');
      const processedReceipt = await this.receiptProcessor.processReceiptImage(imagePath);

      if (processedReceipt.error) {
        throw new Error(`Receipt preprocessing failed: ${processedReceipt.error}`);
      }

      // Step 2: Create AI prompt from processed text
      const aiPrompt = this.receiptProcessor.createAIPrompt(processedReceipt);

      // Step 3: Process with Ollama AI using structured text instead of image
      console.log('🤖 Processing structured text with Ollama...');
      const aiResult = await OllamaService.processTextPrompt(aiPrompt);

      if (!aiResult || !aiResult.amount || aiResult.amount <= 0) {
        // If AI processing failed, notify user and delete the placeholder transaction
        await Transaction.delete(transactionId);
        await Receipt.updateProcessingStatus(receiptId, 'failed', {
          confidence: 0.1,
          rawResponse: aiResult,
          error: 'AI processing failed to extract valid transaction data'
        });

        // Notify user via Telegram about the failure
        if (chatId && this.telegramBot && this.telegramBot.bot) {
          await this.telegramBot.bot.sendMessage(chatId,
            '❌ Sorry, I couldn\'t extract transaction details from your receipt. Please try:\n\n' +
            '• Taking a clearer photo\n' +
            '• Using /add to enter the transaction manually\n' +
            '• Sending the receipt again'
          );
        }

        return { success: false, error: 'AI processing failed' };
      }

      // Delete the placeholder transaction - we'll create a new one through the confirmation flow
      await Transaction.delete(transactionId);

      // Update receipt status to processed
      await Receipt.updateProcessingStatus(receiptId, 'processed', {
        confidence: aiResult.confidence,
        rawResponse: aiResult
      });

      // Send AI results to user for confirmation (same as manual transaction flow)
      if (chatId && this.telegramBot && this.telegramBot.userSessions) {
        // Create a session for this receipt processing (similar to manual /add)
        // Use user description if provided, otherwise use AI description
        const finalDescription = userDescription || aiResult.description || null;

        const sessionData = {
          type: 'receipt_confirmation',
          receiptId: receiptId,
          aiResult: { ...aiResult, description: finalDescription }, // Override with user description
          step: 'confirm_details'
        };

        this.telegramBot.userSessions.set(chatId, sessionData);

        // Send confirmation message with AI extracted details
        const confirmationMessage = `📸 Receipt processed! Please confirm the details:\n\n` +
          `💰 Amount: $${aiResult.amount}\n` +
          `📝 Description: ${finalDescription || '(No description - add one when editing)'}${userDescription ? ' ✏️' : (finalDescription ? ' 🤖' : ' ✏️')}\n` +
          `🏪 Merchant: ${aiResult.merchant || 'Unknown'}\n` +
          `📂 Category: ${aiResult.category || 'Others'}\n` +
          (aiResult.date ? `📅 Date: ${aiResult.date}\n` : '') +
          `\n` +
          `${userDescription ? '✏️ Using your description' : (finalDescription ? '🤖 AI generated description' : '📝 No description found - you can add one by editing')}\n` +
          `Is this correct?`;

        const keyboard = {
          inline_keyboard: [
            [
              { text: '✅ Confirm', callback_data: 'receipt_confirm' },
              { text: '✏️ Edit', callback_data: 'receipt_edit' }
            ],
            [
              { text: '❌ Cancel', callback_data: 'receipt_cancel' }
            ]
          ]
        };

        if (this.telegramBot.bot) {
          await this.telegramBot.bot.sendMessage(chatId, confirmationMessage, {
            reply_markup: keyboard
          });
        }
      }

      return { success: true, aiResult: aiResult };

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