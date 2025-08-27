const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Receipt = require('../models/Receipt');
const ProcessingQueue = require('../services/ProcessingQueue');

class TelegramBotService {
  constructor() {
    this.bot = null;
    this.webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    this.botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (this.botToken && this.botToken !== 'your_telegram_bot_token_from_botfather') {
      try {
        this.bot = new TelegramBot(this.botToken);
        // Setup commands asynchronously to avoid blocking startup
        this.setupCommands().catch(err => {
          console.error('❌ Failed to set up bot commands:', err.message);
        });
        console.log('✅ Telegram bot initialized');
      } catch (error) {
        console.error('❌ Failed to initialize Telegram bot:', error.message);
        console.log('💡 Please check your TELEGRAM_BOT_TOKEN in .env file');
      }
    } else {
      console.log('⚠️  Telegram bot token not configured. Bot features disabled.');
      console.log('💡 Set TELEGRAM_BOT_TOKEN in .env to enable Telegram bot');
    }
  }

  async setupCommands() {
    try {
      // Set bot commands
      await this.bot.setMyCommands([
        { command: 'start', description: 'Start using TeleBudget' },
        { command: 'help', description: 'Get help and usage instructions' },
        { command: 'stats', description: 'View your spending statistics' },
        { command: 'recent', description: 'View recent transactions' },
        { command: 'categories', description: 'Manage transaction categories' }
      ]);
      console.log('✅ Telegram bot commands set up');
    } catch (error) {
      console.error('❌ Failed to set up bot commands:', error.message);
      console.log('💡 This usually means your bot token is invalid');
    }
  }

  async setWebhook() {
    if (!this.bot || !this.webhookUrl) {
      console.error('Bot token or webhook URL not configured');
      return false;
    }

    try {
      await this.bot.setWebHook(`${this.webhookUrl}/telegram`);
      console.log('✅ Telegram webhook set successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to set Telegram webhook:', error);
      return false;
    }
  }

  async processUpdate(update) {
    try {
      if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      }
    } catch (error) {
      console.error('Error processing Telegram update:', error);
    }
  }

  async handleMessage(message) {
    const chatId = message.chat.id;
    const userId = message.from.id.toString();
    const text = message.text;

    // Ensure user exists in database
    let user = await User.findByTelegramId(userId);
    if (!user) {
      user = await User.create({ 
        telegramId: userId,
        username: message.from.username || null,
        firstName: message.from.first_name || null,
        lastName: message.from.last_name || null
      });
    }

    // Handle different message types
    if (text) {
      await this.handleTextMessage(message, user);
    } else if (message.photo) {
      await this.handlePhotoMessage(message, user);
    } else if (message.document && this.isImageDocument(message.document)) {
      await this.handleDocumentMessage(message, user);
    }
  }

  async handleTextMessage(message, user) {
    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text.startsWith('/start')) {
      await this.sendWelcomeMessage(chatId);
    } else if (text.startsWith('/help')) {
      await this.sendHelpMessage(chatId);
    } else if (text.startsWith('/stats')) {
      await this.sendStatsMessage(chatId, user);
    } else if (text.startsWith('/recent')) {
      await this.sendRecentTransactions(chatId, user);
    } else if (text.startsWith('/categories')) {
      await this.sendCategoriesMessage(chatId, user);
    } else {
      // Check if it looks like a manual transaction entry
      const transactionMatch = text.match(/^(\d+(?:\.\d{2})?)\s+(.+)$/);
      if (transactionMatch) {
        await this.handleManualTransaction(chatId, user, transactionMatch[1], transactionMatch[2]);
      } else {
        await this.sendUnknownCommandMessage(chatId);
      }
    }
  }

  async handlePhotoMessage(message, user) {
    const chatId = message.chat.id;
    
    try {
      await this.bot.sendMessage(chatId, '📸 Processing your receipt... This may take a moment.');
      
      // Get the highest resolution photo
      const photo = message.photo[message.photo.length - 1];
      const fileId = photo.file_id;
      
      // Download the image
      const imagePath = await this.downloadImage(fileId, 'photo');
      
      // Create a pending transaction
      const transaction = await Transaction.create({
        userId: user.id,
        amount: 0, // Will be updated after AI processing
        description: 'Processing receipt...',
        category: 'Others',
        merchant: 'Unknown',
        transactionDate: new Date().toISOString(),
        source: 'telegram',
        sourceReference: message.message_id.toString(),
        confidenceScore: 0,
        isVerified: 0
      });

      // Create receipt record
      const receipt = await Receipt.create({
        transactionId: transaction.id,
        imagePath: imagePath,
        processingStatus: 'pending'
      });

      // Add to processing queue
      await ProcessingQueue.add('receipt', {
        receiptId: receipt.id,
        transactionId: transaction.id,
        userId: user.id,
        chatId: chatId,
        imagePath: imagePath
      });

      await this.bot.sendMessage(chatId, '⏳ Your receipt has been queued for processing. You\'ll be notified when it\'s ready!');
      
    } catch (error) {
      console.error('Error handling photo message:', error);
      await this.bot.sendMessage(chatId, '❌ Sorry, there was an error processing your receipt. Please try again.');
    }
  }

  async handleDocumentMessage(message, user) {
    if (!this.isImageDocument(message.document)) {
      await this.bot.sendMessage(message.chat.id, '❌ Please send only image files (JPG, PNG, etc.)');
      return;
    }
    
    // Handle document images similar to photos
    await this.handlePhotoMessage({
      ...message,
      photo: [{ file_id: message.document.file_id }]
    }, user);
  }

  async downloadImage(fileId, prefix = 'image') {
    try {
      const file = await this.bot.getFile(fileId);
      const filePath = file.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
      
      // Generate unique filename
      const extension = path.extname(filePath) || '.jpg';
      const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}${extension}`;
      const localPath = path.join('uploads', filename);
      
      // Ensure uploads directory exists
      if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads', { recursive: true });
      }
      
      // Download the file
      const response = await fetch(fileUrl);
      const buffer = await response.buffer();
      fs.writeFileSync(localPath, buffer);
      
      return localPath;
    } catch (error) {
      console.error('Error downloading image:', error);
      throw error;
    }
  }

  async handleManualTransaction(chatId, user, amount, description) {
    try {
      const transaction = await Transaction.create({
        userId: user.id,
        amount: parseFloat(amount),
        description: description,
        category: 'Others',
        merchant: 'Manual Entry',
        transactionDate: new Date().toISOString(),
        source: 'telegram',
        sourceReference: 'manual',
        confidenceScore: 1.0,
        isVerified: 1
      });

      await this.bot.sendMessage(chatId, 
        `✅ Transaction recorded!\n\n` +
        `💰 Amount: SGD ${amount}\n` +
        `📝 Description: ${description}\n` +
        `📅 Date: ${new Date().toLocaleDateString()}\n\n` +
        `Use /recent to view your recent transactions.`
      );
    } catch (error) {
      console.error('Error creating manual transaction:', error);
      await this.bot.sendMessage(chatId, '❌ Error recording transaction. Please try again.');
    }
  }

  async sendWelcomeMessage(chatId) {
    const message = `
🎯 Welcome to TeleBudget!

Your AI-powered budget tracking assistant. I can help you:

📸 Process receipt photos automatically using AI
💰 Record manual transactions
📊 View spending statistics
🏷️ Categorize your expenses automatically

To get started:
1. Send me a receipt photo and I'll extract the transaction details
2. Or type: \`15.50 Coffee at Starbucks\` for manual entry

Type /help for more commands!
    `;
    
    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  async sendHelpMessage(chatId) {
    const message = `
🆘 TeleBudget Help

**Available Commands:**
/start - Start using TeleBudget
/help - Show this help message
/stats - View your spending statistics
/recent - View recent transactions
/categories - View available categories

**How to use:**
📸 **Receipt scanning:** Just send me a photo of your receipt
💬 **Manual entry:** Type \`amount description\` (e.g., \`12.50 Lunch\`)

**Tips:**
• For best results, ensure receipts are clear and well-lit
• Include GST/tax information when visible
• Manual transactions are immediately verified
• AI will automatically categorize your expenses
• Receipt processing may take 10-30 seconds
    `;
    
    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }


  async sendStatsMessage(chatId, user) {
    try {
      const currentDate = new Date();
      const stats = await Transaction.getMonthlyStats(
        user.id, 
        currentDate.getFullYear(), 
        currentDate.getMonth() + 1
      );

      if (!stats.transaction_count) {
        await this.bot.sendMessage(chatId, '📊 No transactions found for this month. Start by sending a receipt or adding a manual transaction!');
        return;
      }

      let message = `📊 **This Month's Statistics**\n\n`;
      message += `💸 **Total Spent:** SGD ${stats.total_amount.toFixed(2)}\n`;
      message += `📝 **Transactions:** ${stats.transaction_count}\n`;
      message += `📈 **Average:** SGD ${stats.average_amount.toFixed(2)}\n\n`;

      if (stats.categories.length > 0) {
        message += `**Top Categories:**\n`;
        stats.categories.slice(0, 5).forEach((cat, index) => {
          message += `${index + 1}. ${cat.category}: SGD ${cat.total.toFixed(2)}\n`;
        });
      }

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error sending stats:', error);
      await this.bot.sendMessage(chatId, '❌ Error fetching statistics. Please try again.');
    }
  }

  async sendRecentTransactions(chatId, user) {
    try {
      const transactions = await Transaction.findByUser(user.id, { limit: 10 });
      
      if (transactions.length === 0) {
        await this.bot.sendMessage(chatId, '📝 No transactions found. Send me a receipt to get started!');
        return;
      }

      let message = `💰 **Recent Transactions**\n\n`;
      
      transactions.forEach((tx, index) => {
        const date = new Date(tx.transaction_date).toLocaleDateString();
        const verified = tx.is_verified ? '✅' : '⏳';
        message += `${index + 1}. ${verified} SGD ${tx.amount.toFixed(2)} - ${tx.description}\n`;
        message += `   📅 ${date} | 🏷️ ${tx.category}\n\n`;
      });

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error sending recent transactions:', error);
      await this.bot.sendMessage(chatId, '❌ Error fetching transactions. Please try again.');
    }
  }

  async sendCategoriesMessage(chatId, user) {
    const message = `
🏷️ **Transaction Categories**

Available categories:
• 🍽️ Food & Dining
• 🚗 Transportation  
• 🛍️ Shopping
• 🎬 Entertainment
• 💡 Bills & Utilities
• ⚕️ Healthcare
• 📚 Education
• 📦 Others

Categories are automatically assigned during receipt processing, but you can always update them manually in the mobile app.
    `;
    
    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  async sendUnknownCommandMessage(chatId) {
    await this.bot.sendMessage(chatId, 
      '❓ I didn\'t understand that command. Type /help to see available commands, or send a receipt photo to get started!'
    );
  }

  async notifyTransactionProcessed(chatId, transaction, receipt) {
    try {
      const confidence = receipt.ai_confidence || 0;
      const status = confidence > 0.8 ? '✅' : '⚠️';
      const confidenceText = confidence > 0.8 ? 'High confidence' : 'Please verify';
      
      const message = `
${status} **Receipt Processed**

💰 Amount: SGD ${transaction.amount.toFixed(2)}
📝 Description: ${transaction.description}
🏪 Merchant: ${transaction.merchant}
🏷️ Category: ${transaction.category}
📅 Date: ${new Date(transaction.transaction_date).toLocaleDateString()}

🔍 ${confidenceText} (${(confidence * 100).toFixed(0)}%)

${confidence < 0.8 ? 'You can review and edit this transaction in the mobile app.' : ''}
      `;
      
      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('Error sending processing notification:', error);
    }
  }

  isImageDocument(document) {
    const imageTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/gif', 'image/webp'];
    return imageTypes.includes(document.mime_type);
  }

  async handleCallbackQuery(callbackQuery) {
    // Handle inline keyboard callbacks if needed
    await this.bot.answerCallbackQuery(callbackQuery.id);
  }
}

module.exports = new TelegramBotService();