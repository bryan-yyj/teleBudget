import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

class WebSocketProvider with ChangeNotifier {
  IO.Socket? _socket;
  bool _isConnected = false;
  String? _error;
  int? _userId;

  // Getters
  bool get isConnected => _isConnected;
  String? get error => _error;

  // Connect to WebSocket server
  void connect({int? userId}) {
    if (_socket != null && _socket!.connected) {
      return; // Already connected
    }

    _userId = userId;
    _error = null;

    try {
      _socket = IO.io('http://localhost:3001', <String, dynamic>{
        'transports': ['websocket'],
        'autoConnect': false,
      });

      _socket!.onConnect((_) {
        print('Connected to WebSocket server');
        _isConnected = true;
        _error = null;
        
        // Join user room if userId is provided
        if (_userId != null) {
          _socket!.emit('join_user', _userId);
        }
        
        notifyListeners();
      });

      _socket!.onDisconnect((_) {
        print('Disconnected from WebSocket server');
        _isConnected = false;
        notifyListeners();
      });

      _socket!.onError((error) {
        print('WebSocket error: $error');
        _error = error.toString();
        _isConnected = false;
        notifyListeners();
      });

      // Listen for transaction events
      _socket!.on('transaction_created', (data) {
        print('New transaction created: $data');
        _onTransactionCreated(data);
      });

      _socket!.on('transaction_updated', (data) {
        print('Transaction updated: $data');
        _onTransactionUpdated(data);
      });

      _socket!.on('transaction_deleted', (data) {
        print('Transaction deleted: $data');
        _onTransactionDeleted(data);
      });

      _socket!.on('transaction_verified', (data) {
        print('Transaction verified: $data');
        _onTransactionVerified(data);
      });

      // Listen for sync events
      _socket!.on('sync_started', (data) {
        print('Sync started: $data');
        _onSyncStarted(data);
      });

      _socket!.on('sync_completed', (data) {
        print('Sync completed: $data');
        _onSyncCompleted(data);
      });

      _socket!.on('sync_failed', (data) {
        print('Sync failed: $data');
        _onSyncFailed(data);
      });

      // Listen for processing events
      _socket!.on('receipt_processing_started', (data) {
        print('Receipt processing started: $data');
        _onReceiptProcessingStarted(data);
      });

      _socket!.on('receipt_processing_completed', (data) {
        print('Receipt processing completed: $data');
        _onReceiptProcessingCompleted(data);
      });

      _socket!.on('receipt_processing_failed', (data) {
        print('Receipt processing failed: $data');
        _onReceiptProcessingFailed(data);
      });

      _socket!.connect();
    } catch (e) {
      _error = 'Failed to connect: $e';
      _isConnected = false;
      notifyListeners();
    }
  }

  // Disconnect from WebSocket server
  void disconnect() {
    if (_socket != null) {
      _socket!.disconnect();
      _socket = null;
      _isConnected = false;
      notifyListeners();
    }
  }

  // Join user room (for targeted notifications)
  void joinUserRoom(int userId) {
    if (_socket != null && _socket!.connected) {
      _userId = userId;
      _socket!.emit('join_user', userId);
    }
  }

  // Event handlers
  void _onTransactionCreated(dynamic data) {
    // Notify listeners about new transaction
    notifyListeners();
    _showNotification('New transaction added', 'A new transaction has been created');
  }

  void _onTransactionUpdated(dynamic data) {
    // Notify listeners about transaction update
    notifyListeners();
    _showNotification('Transaction updated', 'A transaction has been updated');
  }

  void _onTransactionDeleted(dynamic data) {
    // Notify listeners about transaction deletion
    notifyListeners();
    _showNotification('Transaction deleted', 'A transaction has been deleted');
  }

  void _onTransactionVerified(dynamic data) {
    // Notify listeners about transaction verification
    notifyListeners();
    _showNotification('Transaction verified', 'A transaction has been verified');
  }

  void _onSyncStarted(dynamic data) {
    // Notify listeners about sync start
    notifyListeners();
  }

  void _onSyncCompleted(dynamic data) {
    // Notify listeners about sync completion
    notifyListeners();
    final itemsCount = data['itemsCount'] ?? 0;
    _showNotification('Sync completed', '$itemsCount items synchronized');
  }

  void _onSyncFailed(dynamic data) {
    // Notify listeners about sync failure
    notifyListeners();
    final error = data['error'] ?? 'Unknown error';
    _showNotification('Sync failed', error);
  }

  void _onReceiptProcessingStarted(dynamic data) {
    // Notify listeners about receipt processing start
    notifyListeners();
    _showNotification('Processing receipt', 'Your receipt is being processed...');
  }

  void _onReceiptProcessingCompleted(dynamic data) {
    // Notify listeners about receipt processing completion
    notifyListeners();
    final amount = data['amount'] ?? '0.00';
    final description = data['description'] ?? 'Unknown transaction';
    _showNotification('Receipt processed', 'SGD $amount - $description');
  }

  void _onReceiptProcessingFailed(dynamic data) {
    // Notify listeners about receipt processing failure
    notifyListeners();
    final error = data['error'] ?? 'Processing failed';
    _showNotification('Receipt processing failed', error);
  }

  // Show in-app notification (you can customize this based on your notification system)
  void _showNotification(String title, String body) {
    // This is a placeholder for showing notifications
    // In a real app, you would integrate with your notification system
    print('Notification: $title - $body');
  }

  // Emit events to server
  void emitEvent(String event, dynamic data) {
    if (_socket != null && _socket!.connected) {
      _socket!.emit(event, data);
    }
  }

  // Request real-time updates for specific transaction
  void subscribeToTransaction(int transactionId) {
    if (_socket != null && _socket!.connected) {
      _socket!.emit('subscribe_transaction', {'transactionId': transactionId});
    }
  }

  // Stop receiving updates for specific transaction
  void unsubscribeFromTransaction(int transactionId) {
    if (_socket != null && _socket!.connected) {
      _socket!.emit('unsubscribe_transaction', {'transactionId': transactionId});
    }
  }

  // Request manual sync
  void requestSync(int userId) {
    if (_socket != null && _socket!.connected) {
      _socket!.emit('request_sync', {'userId': userId});
    }
  }

  // Clear error
  void clearError() {
    _error = null;
    notifyListeners();
  }

  @override
  void dispose() {
    disconnect();
    super.dispose();
  }
}