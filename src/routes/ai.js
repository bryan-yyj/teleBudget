const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const OllamaService = require('../services/OllamaService');
const ProcessingQueue = require('../services/ProcessingQueue');
const Transaction = require('../models/Transaction');
const Receipt = require('../models/Receipt');
const User = require('../models/User');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'receipt-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Process receipt endpoint
router.post('/process-receipt', upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create pending transaction
    const transaction = await Transaction.create({
      userId: userId,
      amount: 0,
      description: 'Processing receipt...',
      category: 'Others',
      merchant: 'Unknown',
      transactionDate: new Date().toISOString(),
      source: 'manual',
      sourceReference: `upload-${Date.now()}`,
      confidenceScore: 0,
      isVerified: 0
    });

    // Create receipt record
    const receipt = await Receipt.create({
      transactionId: transaction.id,
      imagePath: req.file.path,
      processingStatus: 'pending'
    });

    // Add to processing queue
    const jobId = await ProcessingQueue.add('receipt', {
      receiptId: receipt.id,
      transactionId: transaction.id,
      userId: userId,
      imagePath: req.file.path
    });

    res.json({
      success: true,
      transactionId: transaction.id,
      receiptId: receipt.id,
      jobId: jobId,
      message: 'Receipt queued for processing'
    });

  } catch (error) {
    console.error('Error processing receipt:', error);
    
    // Clean up uploaded file if there was an error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: 'Failed to process receipt' });
  }
});

// Get processing status
router.get('/processing-status/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const receipts = await Receipt.findByTransactionId(transactionId);
    
    res.json({
      transaction,
      receipts,
      status: receipts.length > 0 ? receipts[0].processing_status : 'unknown'
    });

  } catch (error) {
    console.error('Error getting processing status:', error);
    res.status(500).json({ error: 'Failed to get processing status' });
  }
});

// Ollama status endpoint
router.get('/ollama-status', async (req, res) => {
  try {
    const status = await OllamaService.checkOllamaStatus();
    res.json(status);
  } catch (error) {
    console.error('Error checking Ollama status:', error);
    res.status(500).json({ error: 'Failed to check Ollama status' });
  }
});

// Pull Ollama model
router.post('/ollama-pull-model', async (req, res) => {
  try {
    const { modelName } = req.body;
    const result = await OllamaService.pullModel(modelName);
    res.json(result);
  } catch (error) {
    console.error('Error pulling model:', error);
    res.status(500).json({ error: 'Failed to pull model' });
  }
});

// Test Ollama model
router.post('/test-model', async (req, res) => {
  try {
    const result = await OllamaService.testModelWithSample();
    res.json(result);
  } catch (error) {
    console.error('Error testing model:', error);
    res.status(500).json({ error: 'Failed to test model' });
  }
});

// Get processing queue status
router.get('/queue-status', async (req, res) => {
  try {
    const status = await ProcessingQueue.getQueueStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

// Retry failed jobs
router.post('/retry-failed', async (req, res) => {
  try {
    const { limit = 10 } = req.body;
    const retriedCount = await ProcessingQueue.retryFailedJobs(limit);
    res.json({ 
      success: true, 
      retriedCount,
      message: `Retried ${retriedCount} failed jobs`
    });
  } catch (error) {
    console.error('Error retrying failed jobs:', error);
    res.status(500).json({ error: 'Failed to retry failed jobs' });
  }
});

// Manual receipt processing (for testing)
router.post('/process-manual', async (req, res) => {
  try {
    const { imagePath } = req.body;
    
    if (!imagePath || !fs.existsSync(imagePath)) {
      return res.status(400).json({ error: 'Invalid image path' });
    }

    const result = await OllamaService.processReceipt(imagePath);
    res.json(result);

  } catch (error) {
    console.error('Error in manual processing:', error);
    res.status(500).json({ error: 'Failed to process receipt manually' });
  }
});

module.exports = router;