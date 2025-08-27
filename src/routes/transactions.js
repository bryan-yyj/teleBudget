const express = require('express');
const Transaction = require('../models/Transaction');
const Receipt = require('../models/Receipt');
const User = require('../models/User');
const Database = require('../database/Database');

const router = express.Router();

// Get transactions for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      startDate,
      endDate,
      category,
      source,
      limit = 50,
      page = 1,
      unverified = false
    } = req.query;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const options = {
      limit: parseInt(limit),
      offset: (parseInt(page) - 1) * parseInt(limit)
    };

    if (startDate) options.startDate = startDate;
    if (endDate) options.endDate = endDate;
    if (category) options.category = category;
    if (source) options.source = source;

    let transactions;
    if (unverified === 'true') {
      transactions = await Transaction.getRecentUnverified(userId, parseInt(limit));
    } else {
      transactions = await Transaction.findByUser(userId, options);
    }

    // Get total count for pagination
    let totalQuery = 'SELECT COUNT(*) as count FROM transactions WHERE user_id = ?';
    const countParams = [userId];
    
    if (startDate) {
      totalQuery += ' AND transaction_date >= ?';
      countParams.push(startDate);
    }
    if (endDate) {
      totalQuery += ' AND transaction_date <= ?';
      countParams.push(endDate);
    }
    if (category) {
      totalQuery += ' AND category = ?';
      countParams.push(category);
    }
    if (source) {
      totalQuery += ' AND source = ?';
      countParams.push(source);
    }
    if (unverified === 'true') {
      totalQuery += ' AND is_verified = 0 AND confidence_score < 0.9';
    }

    const countResult = await Database.get(totalQuery, countParams);
    const total = countResult.count;

    res.json({
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error getting transactions:', error);
    res.status(500).json({ error: 'Failed to get transactions' });
  }
});

// Get single transaction
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Get associated receipts
    const receipts = await Receipt.findByTransactionId(id);

    res.json({
      ...transaction,
      receipts
    });

  } catch (error) {
    console.error('Error getting transaction:', error);
    res.status(500).json({ error: 'Failed to get transaction' });
  }
});

// Create new transaction
router.post('/', async (req, res) => {
  try {
    const {
      userId,
      amount,
      currency = 'SGD',
      description,
      category = 'Others',
      merchant,
      transactionDate,
      source = 'manual'
    } = req.body;

    // Validate required fields
    if (!userId || !amount || !description) {
      return res.status(400).json({ 
        error: 'User ID, amount, and description are required' 
      });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check for potential duplicate
    const duplicate = await Transaction.findDuplicate(
      userId,
      amount,
      transactionDate || new Date().toISOString(),
      source
    );

    let warning = null;
    if (duplicate) {
      warning = `Similar transaction found: ${duplicate.description} (${duplicate.amount}) on ${new Date(duplicate.transaction_date).toLocaleDateString()}`;
    }

    const transaction = await Transaction.create({
      userId,
      amount: parseFloat(amount),
      currency,
      description,
      category,
      merchant,
      transactionDate: transactionDate || new Date().toISOString(),
      source,
      sourceReference: `manual-${Date.now()}`,
      confidenceScore: 1.0,
      isVerified: 1
    });

    // Emit real-time update via WebSocket
    req.io?.to(`user_${userId}`).emit('transaction_created', transaction);

    res.json({
      success: true,
      transaction,
      warning
    });

  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

// Update transaction
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated directly
    delete updates.id;
    delete updates.created_at;
    delete updates.user_id;

    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const updatedTransaction = await Transaction.update(id, updates);

    // Emit real-time update via WebSocket
    req.io?.to(`user_${transaction.user_id}`).emit('transaction_updated', updatedTransaction);

    res.json({
      success: true,
      transaction: updatedTransaction
    });

  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction' });
  }
});

// Delete transaction
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Delete associated receipts first
    const receipts = await Receipt.findByTransactionId(id);
    for (const receipt of receipts) {
      await Receipt.delete(receipt.id);
      
      // Clean up image file if it exists
      const fs = require('fs');
      if (receipt.image_path && fs.existsSync(receipt.image_path)) {
        fs.unlinkSync(receipt.image_path);
      }
    }

    const deleted = await Transaction.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Emit real-time update via WebSocket
    req.io?.to(`user_${transaction.user_id}`).emit('transaction_deleted', { id });

    res.json({
      success: true,
      message: 'Transaction deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
});

// Get monthly statistics
router.get('/stats/:userId/:year/:month', async (req, res) => {
  try {
    const { userId, year, month } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const stats = await Transaction.getMonthlyStats(
      userId,
      parseInt(year),
      parseInt(month)
    );

    res.json(stats);

  } catch (error) {
    console.error('Error getting monthly stats:', error);
    res.status(500).json({ error: 'Failed to get monthly statistics' });
  }
});

// Verify transaction
router.post('/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const { verified = true } = req.body;
    
    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const updatedTransaction = await Transaction.update(id, {
      isVerified: verified ? 1 : 0,
      confidenceScore: verified ? 1.0 : transaction.confidence_score
    });

    // Emit real-time update via WebSocket
    req.io?.to(`user_${transaction.user_id}`).emit('transaction_verified', updatedTransaction);

    res.json({
      success: true,
      transaction: updatedTransaction,
      message: verified ? 'Transaction verified' : 'Transaction marked as unverified'
    });

  } catch (error) {
    console.error('Error verifying transaction:', error);
    res.status(500).json({ error: 'Failed to verify transaction' });
  }
});

// Bulk verify transactions
router.post('/bulk-verify', async (req, res) => {
  try {
    const { transactionIds, verified = true } = req.body;
    
    if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
      return res.status(400).json({ error: 'Transaction IDs array is required' });
    }

    const results = [];
    
    for (const id of transactionIds) {
      try {
        const transaction = await Transaction.findById(id);
        if (transaction) {
          const updatedTransaction = await Transaction.update(id, {
            isVerified: verified ? 1 : 0,
            confidenceScore: verified ? 1.0 : transaction.confidence_score
          });
          
          results.push({ id, success: true, transaction: updatedTransaction });
          
          // Emit real-time update
          req.io?.to(`user_${transaction.user_id}`).emit('transaction_verified', updatedTransaction);
        } else {
          results.push({ id, success: false, error: 'Transaction not found' });
        }
      } catch (error) {
        results.push({ id, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    
    res.json({
      success: true,
      processed: results.length,
      successful: successCount,
      failed: results.length - successCount,
      results
    });

  } catch (error) {
    console.error('Error bulk verifying transactions:', error);
    res.status(500).json({ error: 'Failed to bulk verify transactions' });
  }
});

// Get categories
router.get('/categories/list', async (req, res) => {
  try {
    const categories = await Database.all('SELECT * FROM categories ORDER BY name');
    res.json(categories);
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

module.exports = router;