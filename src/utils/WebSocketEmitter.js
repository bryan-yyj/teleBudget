class WebSocketEmitter {
  constructor(io) {
    this.io = io;
  }

  // Emit to specific user
  emitToUser(userId, event, data) {
    if (!this.io) return;
    
    this.io.to(`user_${userId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  // Emit to all connected clients
  emitToAll(event, data) {
    if (!this.io) return;
    
    this.io.emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
  }

  // Transaction events
  notifyTransactionCreated(userId, transaction) {
    this.emitToUser(userId, 'transaction_created', {
      transaction,
      message: 'New transaction created'
    });
  }

  notifyTransactionUpdated(userId, transaction) {
    this.emitToUser(userId, 'transaction_updated', {
      transaction,
      message: 'Transaction updated'
    });
  }

  notifyTransactionDeleted(userId, transactionId) {
    this.emitToUser(userId, 'transaction_deleted', {
      transactionId,
      message: 'Transaction deleted'
    });
  }

  notifyTransactionVerified(userId, transaction) {
    this.emitToUser(userId, 'transaction_verified', {
      transaction,
      message: 'Transaction verified'
    });
  }

  // Sync events
  notifySyncStarted(userId, syncType = 'general') {
    this.emitToUser(userId, 'sync_started', {
      syncType,
      message: 'Synchronization started'
    });
  }

  notifySyncCompleted(userId, syncType = 'general', itemsCount = 0) {
    this.emitToUser(userId, 'sync_completed', {
      syncType,
      itemsCount,
      message: `Synchronization completed - ${itemsCount} items processed`
    });
  }

  notifySyncFailed(userId, syncType = 'general', error = 'Unknown error') {
    this.emitToUser(userId, 'sync_failed', {
      syncType,
      error,
      message: 'Synchronization failed'
    });
  }

  // Receipt processing events
  notifyReceiptProcessingStarted(userId, receiptId, transactionId) {
    this.emitToUser(userId, 'receipt_processing_started', {
      receiptId,
      transactionId,
      message: 'Receipt processing started'
    });
  }

  notifyReceiptProcessingCompleted(userId, receiptId, transaction) {
    this.emitToUser(userId, 'receipt_processing_completed', {
      receiptId,
      transaction,
      amount: transaction.amount,
      description: transaction.description,
      message: 'Receipt processed successfully'
    });
  }

  notifyReceiptProcessingFailed(userId, receiptId, error = 'Processing failed') {
    this.emitToUser(userId, 'receipt_processing_failed', {
      receiptId,
      error,
      message: 'Receipt processing failed'
    });
  }

  // Email sync events
  notifyEmailSyncCompleted(userId, emailCount, transactionCount) {
    this.emitToUser(userId, 'email_sync_completed', {
      emailCount,
      transactionCount,
      message: `Email sync completed - ${transactionCount} transactions found from ${emailCount} emails`
    });
  }

  // General system events
  notifySystemStatus(status, message) {
    this.emitToAll('system_status', {
      status,
      message
    });
  }

  // Connection status
  notifyUserConnected(userId) {
    console.log(`User ${userId} connected to WebSocket`);
  }

  notifyUserDisconnected(userId) {
    console.log(`User ${userId} disconnected from WebSocket`);
  }
}

module.exports = WebSocketEmitter;