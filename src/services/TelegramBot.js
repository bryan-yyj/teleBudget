const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Receipt = require('../models/Receipt');
// ProcessingQueue will be injected to avoid circular dependency

class TelegramBotService {
  constructor() {
    this.bot = null;
    this.webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
    // Temporarily hardcode the token since .env has caching issues
    this.botToken = '8493139780:AAFIKXgSz52zkIIsE_hkllTO1RBmkBvt5k4';
    this.processingQueue = null;
    
    // Session management for multi-step conversations
    this.userSessions = new Map(); // chatId -> session data
    
    if (this.botToken && this.botToken !== 'your_telegram_bot_token_from_botfather') {
      try {
        this.bot = new TelegramBot(this.botToken, { polling: true });
        
        // Setup message handlers
        this.setupMessageHandlers();
        
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
        { command: 'add', description: 'Add a new transaction (interactive)' },
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

  setupMessageHandlers() {
    if (!this.bot) return;

    // Handle all messages
    this.bot.on('message', (msg) => {
      console.log(`📨 Received message from ${msg.from.first_name}: "${msg.text || '[photo/file]'}"`);
      this.handleMessage(msg).catch(err => {
        console.error('❌ Error handling message:', err.message);
      });
    });

    // Handle callback queries (button presses)
    this.bot.on('callback_query', (query) => {
      console.log(`🔘 Button pressed by ${query.from.first_name}: "${query.data}"`);
      this.handleCallbackQuery(query).catch(err => {
        console.error('❌ Error handling callback query:', err.message);
      });
    });

    // Handle polling errors
    this.bot.on('polling_error', (error) => {
      console.error('❌ Telegram polling error:', error.message);
    });

    console.log('✅ Telegram message handlers set up');
  }

  setProcessingQueue(processingQueue) {
    this.processingQueue = processingQueue;
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

    // Check if user is in a session (multi-step transaction)
    if (this.userSessions.has(chatId)) {
      await this.handleSessionMessage(message, user);
      return;
    }

    if (text.startsWith('/start')) {
      await this.sendWelcomeMessage(chatId);
    } else if (text.startsWith('/add') || text.startsWith('/transaction')) {
      await this.startInteractiveTransaction(chatId, user);
    } else if (text.startsWith('/help')) {
      await this.sendHelpMessage(chatId);
    } else if (text.startsWith('/stats')) {
      await this.sendStatsMessage(chatId, user);
    } else if (text.startsWith('/recent')) {
      await this.sendRecentTransactions(chatId, user);
    } else if (text.startsWith('/categories')) {
      await this.sendCategoriesMessage(chatId, user);
    } else {
      // Check if it looks like a manual transaction entry - support multiple formats
      let amount, description;
      
      // Format 1: "$10 on macdonalds" or "$10.50 at starbucks"
      const dollarMatch = text.match(/^\$(\d+(?:\.\d{2})?)\s+(on|at|for)\s+(.+)$/i);
      if (dollarMatch) {
        amount = dollarMatch[1];
        description = dollarMatch[3];
      } else {
        // Format 2: "weekly gym $5" or "coffee $3.50"
        const descriptionFirstMatch = text.match(/^(.+)\s+\$(\d+(?:\.\d{2})?)$/i);
        if (descriptionFirstMatch) {
          amount = descriptionFirstMatch[2];
          description = descriptionFirstMatch[1];
        } else {
          // Format 3: "$5 weekly gym" or "$3.50 coffee"
          const dollarFirstMatch = text.match(/^\$(\d+(?:\.\d{2})?)\s+(.+)$/i);
          if (dollarFirstMatch) {
            amount = dollarFirstMatch[1];
            description = dollarFirstMatch[2];
          } else {
            // Format 4: "10.50 coffee" or "15 lunch" (no dollar sign)
            const simpleMatch = text.match(/^(\d+(?:\.\d{2})?)\s+(.+)$/);
            if (simpleMatch) {
              amount = simpleMatch[1];
              description = simpleMatch[2];
            } else {
              // Format 5: "spent $10 on coffee" or "paid 15.50 for lunch"
              const spentMatch = text.match(/^(spent|paid)\s+\$?(\d+(?:\.\d{2})?)\s+(on|for|at)\s+(.+)$/i);
              if (spentMatch) {
                amount = spentMatch[2];
                description = spentMatch[4];
              }
            }
          }
        }
      }
      
      if (amount && description) {
        await this.handleManualTransaction(chatId, user, amount, description);
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
        transaction_date: new Date().toISOString(),
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
      if (this.processingQueue) {
        await this.processingQueue.add('receipt', {
          receiptId: receipt.id,
          transactionId: transaction.id,
          userId: user.id,
          chatId: chatId,
          imagePath: imagePath
        });
      } else {
        console.error('ProcessingQueue not available - receipt will not be processed');
        await this.bot.sendMessage(chatId, '❌ Processing service unavailable. Please try again later.');
        return;
      }

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
      // Ensure uploads directory exists
      if (!fs.existsSync('uploads')) {
        fs.mkdirSync('uploads', { recursive: true });
      }
      
      // Generate unique filename
      const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.jpg`;
      const localPath = path.join('uploads', filename);
      
      // Use the bot's built-in download method
      await this.bot.downloadFile(fileId, 'uploads');
      
      // The bot downloads with the original filename, so we need to rename it
      const file = await this.bot.getFile(fileId);
      const originalPath = path.join('uploads', path.basename(file.file_path));
      
      // Rename to our generated filename
      if (fs.existsSync(originalPath)) {
        fs.renameSync(originalPath, localPath);
      }
      
      return localPath;
    } catch (error) {
      console.error('Error downloading image:', error);
      throw error;
    }
  }

  async handleManualTransaction(chatId, user, amount, description) {
    try {
      // Use AI to categorize and enhance the description
      const enhancedData = await this.enhanceManualTransaction(description, amount);
      
      const transaction = await Transaction.create({
        userId: user.id,
        amount: parseFloat(amount),
        description: enhancedData.description,
        category: enhancedData.category,
        merchant: enhancedData.merchant,
        transaction_date: new Date().toISOString(),
        source: 'telegram',
        sourceReference: 'manual',
        confidenceScore: enhancedData.confidence,
        isVerified: 1
      });

      await this.bot.sendMessage(chatId, 
        `✅ Transaction recorded!\n\n` +
        `💰 Amount: SGD ${amount}\n` +
        `📝 Description: ${enhancedData.description}\n` +
        `🏷️ Category: ${enhancedData.category}\n` +
        `🏪 Merchant: ${enhancedData.merchant}\n` +
        `📅 Date: ${new Date().toLocaleDateString()}\n\n` +
        `Use /recent to view your recent transactions.`
      );
    } catch (error) {
      console.error('Error creating manual transaction:', error);
      await this.bot.sendMessage(chatId, '❌ Error recording transaction. Please try again.');
    }
  }

  async enhanceManualTransaction(description, amount) {
    try {
      // Import OllamaService here to avoid circular dependency
      const OllamaService = require('./OllamaService');
      
      const prompt = `Analyze this manual transaction and enhance it. Return a JSON response:
      
      Transaction: "${description}" for SGD ${amount}
      
      {
        "description": "enhanced description (e.g., 'McDonald's meal' instead of just 'macs')",
        "category": "category from: Food & Dining, Transportation, Shopping, Entertainment, Bills & Utilities, Healthcare, Education, Others",
        "merchant": "likely merchant name (e.g., 'McDonald's' for 'macs')",
        "payment_method": "most likely payment method: Cash, PayLah!, GrabPay, Credit Card, etc.",
        "confidence": "confidence score 0.0-1.0"
      }
      
      Guidelines:
      - "macs" = McDonald's → Food & Dining, likely PayLah!/Credit Card
      - "starbucks", "coffee" → Food & Dining, likely Credit Card
      - "grab", "taxi" → Transportation, likely GrabPay/Cash
      - "gym" → Healthcare, likely GIRO/Credit Card
      - Expand abbreviations to full names
      - Suggest realistic payment methods
      
      Return only valid JSON.`;

      const response = await OllamaService.processTextPrompt(prompt);
      
      if (response && response.description) {
        return {
          description: response.description,
          category: response.category || 'Others',
          merchant: response.merchant || 'Manual Entry',
          payment_method: response.payment_method || null,
          confidence: response.confidence || 0.8
        };
      }
    } catch (error) {
      console.error('Error enhancing manual transaction:', error);
    }
    
    // Fallback to basic categorization
    return this.basicCategorization(description);
  }

  basicCategorization(description) {
    const desc = description.toLowerCase();
    
    // Food & Dining
    if (desc.includes('macs') || desc.includes('mcdonald') || 
        desc.includes('coffee') || desc.includes('starbucks') || 
        desc.includes('food') || desc.includes('lunch') || 
        desc.includes('dinner') || desc.includes('breakfast') ||
        desc.includes('restaurant') || desc.includes('cafe')) {
      return {
        description: desc.includes('macs') ? 'McDonald\'s meal' : description,
        category: 'Food & Dining',
        merchant: desc.includes('macs') ? 'McDonald\'s' : 
                 desc.includes('starbucks') ? 'Starbucks' : 'Restaurant',
        confidence: 0.7
      };
    }
    
    // Transportation
    if (desc.includes('grab') || desc.includes('taxi') || 
        desc.includes('bus') || desc.includes('mrt') || 
        desc.includes('transport')) {
      return {
        description: description,
        category: 'Transportation',
        merchant: desc.includes('grab') ? 'Grab' : 'Transport',
        confidence: 0.7
      };
    }
    
    // Shopping
    if (desc.includes('shopping') || desc.includes('mall') || 
        desc.includes('store') || desc.includes('buy')) {
      return {
        description: description,
        category: 'Shopping',
        merchant: 'Retail Store',
        confidence: 0.6
      };
    }
    
    // Default
    return {
      description: description,
      category: 'Others',
      merchant: 'Manual Entry',
      confidence: 0.5
    };
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
1. 📸 Send me a photo (receipt, payment confirmation, transfer) and I'll extract the details
2. 💬 Type /add for interactive transaction entry with payment method selection
3. ⚡ Or quick entry: \`$15.50 on coffee\` or \`25 groceries\`

Type /help for more commands!
    `;
    
    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  async sendHelpMessage(chatId) {
    const message = `
🆘 TeleBudget Help

**Available Commands:**
/start - Start using TeleBudget
/add - Interactive transaction entry (recommended!)
/help - Show this help message
/stats - View your spending statistics
/recent - View recent transactions
/categories - View available categories

**How to use:**
📸 **Receipt scanning:** Send me a photo of your receipt or payment confirmation
💬 **Interactive entry:** Use /add for step-by-step transaction entry with:
   • Smart payment method suggestions based on your habits
   • AI-powered categorization and merchant detection
   • Personalized experience that learns from your patterns
⚡ **Quick entry:** Type transactions in any of these formats:
   • \`$10 on coffee\` or \`$15.50 at Starbucks\`
   • \`12.50 lunch\` or \`25 groceries\`
   • \`spent $10 on coffee\` or \`paid 15.50 for lunch\`

**Tips:**
• For best results, ensure photos are clear and well-lit
• I can process receipts, payment confirmations, and bank transfers
• Manual transactions are immediately verified
• AI will automatically categorize your expenses and detect transaction types
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

  // Interactive transaction entry system
  async startInteractiveTransaction(chatId, user) {
    this.userSessions.set(chatId, {
      step: 'amount',
      userId: user.id,
      data: {}
    });

    await this.bot.sendMessage(chatId, 
      '💰 Let\'s add a new transaction!\n\n' +
      'Please enter the amount (e.g., 15.50 or $15.50):'
    );
  }

  async handleSessionMessage(message, user) {
    const chatId = message.chat.id;
    const text = message.text.trim();
    const session = this.userSessions.get(chatId);

    if (!session) return;

    try {
      switch (session.step) {
        case 'amount':
          await this.handleAmountInput(chatId, text, session);
          break;
        case 'description':
          await this.handleDescriptionInput(chatId, text, session, user);
          break;
        case 'custom_payment':
          await this.completeTransaction(chatId, session, text);
          break;
        default:
          this.userSessions.delete(chatId);
          await this.sendUnknownCommandMessage(chatId);
      }
    } catch (error) {
      console.error('Error handling session message:', error);
      this.userSessions.delete(chatId);
      await this.bot.sendMessage(chatId, '❌ Something went wrong. Please try again.');
    }
  }

  async handleAmountInput(chatId, text, session) {
    // Parse amount from various formats
    const amountMatch = text.match(/\$?(\d+(?:\.\d{1,2})?)/);
    
    if (!amountMatch) {
      await this.bot.sendMessage(chatId, 
        '❌ Please enter a valid amount (e.g., 15.50 or $15.50):'
      );
      return;
    }

    const amount = parseFloat(amountMatch[1]);
    if (amount <= 0) {
      await this.bot.sendMessage(chatId, 
        '❌ Amount must be greater than 0. Please try again:'
      );
      return;
    }

    session.data.amount = amount;
    session.step = 'description';

    await this.bot.sendMessage(chatId, 
      `✅ Amount: SGD ${amount.toFixed(2)}\n\n` +
      '📝 Now, what was this transaction for? (e.g., coffee, lunch, grab ride):'
    );
  }

  async handleDescriptionInput(chatId, text, session, user) {
    session.data.description = text;

    // Use AI to enhance and categorize
    const enhancedData = await this.enhanceManualTransaction(text, session.data.amount);
    session.data.enhancedData = enhancedData;

    // Get user's payment method preferences
    const paymentMethods = await this.getUserPaymentMethods(user.id);

    await this.showPaymentMethodSelection(chatId, session, paymentMethods);
  }

  async getUserPaymentMethods(userId) {
    try {
      // Get user's most used payment methods from transaction history
      const Database = require('../database/Database');
      
      const recentMethods = await Database.all(`
        SELECT payment_method, COUNT(*) as usage_count
        FROM transactions 
        WHERE user_id = ? AND payment_method IS NOT NULL
        GROUP BY payment_method 
        ORDER BY usage_count DESC, MAX(created_at) DESC
        LIMIT 6
      `, [userId]);

      // Default payment methods if user has no history
      const defaultMethods = [
        { payment_method: 'Cash', usage_count: 0 },
        { payment_method: 'PayLah!', usage_count: 0 },
        { payment_method: 'GrabPay', usage_count: 0 },
        { payment_method: 'Credit Card', usage_count: 0 },
        { payment_method: 'Debit Card', usage_count: 0 },
        { payment_method: 'PayNow', usage_count: 0 }
      ];

      // Merge user methods with defaults, prioritizing user's habits
      const allMethods = [...recentMethods];
      defaultMethods.forEach(defaultMethod => {
        if (!allMethods.find(m => m.payment_method === defaultMethod.payment_method)) {
          allMethods.push(defaultMethod);
        }
      });

      return allMethods.slice(0, 6); // Limit to 6 options
    } catch (error) {
      console.error('Error getting user payment methods:', error);
      return [
        { payment_method: 'Cash', usage_count: 0 },
        { payment_method: 'PayLah!', usage_count: 0 },
        { payment_method: 'Credit Card', usage_count: 0 }
      ];
    }
  }

  async showPaymentMethodSelection(chatId, session, paymentMethods) {
    const { amount, description, enhancedData } = session.data;

    // Create inline keyboard with payment methods
    const keyboard = {
      inline_keyboard: []
    };

    // Add payment method buttons (2 per row)
    for (let i = 0; i < paymentMethods.length; i += 2) {
      const row = [];
      
      const method1 = paymentMethods[i];
      const emoji1 = this.getPaymentMethodEmoji(method1.payment_method);
      const label1 = method1.usage_count > 0 ? 
        `${emoji1} ${method1.payment_method} (${method1.usage_count})` : 
        `${emoji1} ${method1.payment_method}`;
      
      row.push({
        text: label1,
        callback_data: `payment:${method1.payment_method}`
      });

      if (i + 1 < paymentMethods.length) {
        const method2 = paymentMethods[i + 1];
        const emoji2 = this.getPaymentMethodEmoji(method2.payment_method);
        const label2 = method2.usage_count > 0 ? 
          `${emoji2} ${method2.payment_method} (${method2.usage_count})` : 
          `${emoji2} ${method2.payment_method}`;
        
        row.push({
          text: label2,
          callback_data: `payment:${method2.payment_method}`
        });
      }

      keyboard.inline_keyboard.push(row);
    }

    // Add "Other" option
    keyboard.inline_keyboard.push([{
      text: '💳 Other payment method',
      callback_data: 'payment:other'
    }]);

    const message = 
      `📋 **Transaction Summary**\n\n` +
      `💰 Amount: SGD ${amount.toFixed(2)}\n` +
      `📝 Description: ${enhancedData.description}\n` +
      `🏷️ Category: ${enhancedData.category}\n` +
      `🏪 Merchant: ${enhancedData.merchant}\n\n` +
      `💳 How did you pay for this?`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  getPaymentMethodEmoji(method) {
    const emojiMap = {
      'Cash': '💵',
      'PayLah!': '📱',
      'GrabPay': '🚗',
      'Credit Card': '💳',
      'Debit Card': '💳',
      'PayNow': '📲',
      'Bank Transfer': '🏦',
      'NETS': '💳',
      'Apple Pay': '📱',
      'Google Pay': '📱'
    };
    return emojiMap[method] || '💳';
  }

  async handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const session = this.userSessions.get(chatId);

    try {
      await this.bot.answerCallbackQuery(callbackQuery.id);

      if (data.startsWith('payment:')) {
        const paymentMethod = data.replace('payment:', '');
        
        if (paymentMethod === 'other') {
          // Ask user to type custom payment method
          session.step = 'custom_payment';
          await this.bot.editMessageText(
            '💳 Please type your payment method (e.g., "OCBC Credit Card", "Shopee Pay"):',
            {
              chat_id: chatId,
              message_id: callbackQuery.message.message_id
            }
          );
        } else {
          await this.completeTransaction(chatId, session, paymentMethod);
        }
      }
    } catch (error) {
      console.error('Error handling callback query:', error);
      await this.bot.sendMessage(chatId, '❌ Something went wrong. Please try again.');
    }
  }

  async completeTransaction(chatId, session, paymentMethod) {
    try {
      const { amount, description, enhancedData } = session.data;

      // Create the transaction
      const transaction = await Transaction.create({
        userId: session.userId,
        amount: amount,
        description: enhancedData.description,
        category: enhancedData.category,
        merchant: enhancedData.merchant,
        transaction_date: new Date().toISOString(),
        payment_method: paymentMethod,
        source: 'telegram',
        sourceReference: 'interactive',
        confidenceScore: enhancedData.confidence,
        isVerified: 1
      });

      // Clear session
      this.userSessions.delete(chatId);

      // Send confirmation
      const emoji = this.getPaymentMethodEmoji(paymentMethod);
      await this.bot.sendMessage(chatId, 
        `✅ **Transaction Recorded!**\n\n` +
        `💰 Amount: SGD ${amount.toFixed(2)}\n` +
        `📝 Description: ${enhancedData.description}\n` +
        `🏷️ Category: ${enhancedData.category}\n` +
        `🏪 Merchant: ${enhancedData.merchant}\n` +
        `${emoji} Payment: ${paymentMethod}\n` +
        `📅 Date: ${new Date().toLocaleDateString()}\n\n` +
        `Use /recent to view your transactions or /add to add another!`,
        { parse_mode: 'Markdown' }
      );

      // Learn from this transaction for future suggestions
      await this.updateUserPreferences(session.userId, enhancedData.category, paymentMethod);

    } catch (error) {
      console.error('Error completing transaction:', error);
      this.userSessions.delete(chatId);
      await this.bot.sendMessage(chatId, '❌ Error saving transaction. Please try again.');
    }
  }

  async updateUserPreferences(userId, category, paymentMethod) {
    try {
      // This could be expanded to store user preferences in a separate table
      // For now, the payment method history is tracked in transactions
      console.log(`Learning: User ${userId} used ${paymentMethod} for ${category}`);
    } catch (error) {
      console.error('Error updating user preferences:', error);
    }
  }
}

module.exports = new TelegramBotService();