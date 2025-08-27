import 'package:flutter/material.dart';

import '../models/transaction.dart' as models;
import '../services/api_service.dart';
import '../services/database_service.dart';

class TransactionProvider with ChangeNotifier {
  final DatabaseService _dbService = DatabaseService();
  final ApiService _apiService = ApiService.instance;

  List<models.Transaction> _transactions = [];
  List<models.Transaction> _unverifiedTransactions = [];
  models.TransactionStats? _currentMonthStats;
  List<Map<String, dynamic>> _categories = [];
  
  bool _isLoading = false;
  bool _isSyncing = false;
  String? _error;
  DateTime? _lastSyncTime;

  // Getters
  List<models.Transaction> get transactions => _transactions;
  List<models.Transaction> get unverifiedTransactions => _unverifiedTransactions;
  TransactionStats? get currentMonthStats => _currentMonthStats;
  List<Map<String, dynamic>> get categories => _categories;
  bool get isLoading => _isLoading;
  bool get isSyncing => _isSyncing;
  String? get error => _error;
  DateTime? get lastSyncTime => _lastSyncTime;

  int get totalTransactions => _transactions.length;
  int get unverifiedCount => _unverifiedTransactions.length;
  double get totalSpent => _transactions.fold(0.0, (sum, tx) => sum + tx.amount);

  // Set loading state
  void _setLoading(bool loading) {
    _isLoading = loading;
    notifyListeners();
  }

  // Set syncing state  
  void _setSyncing(bool syncing) {
    _isSyncing = syncing;
    notifyListeners();
  }

  // Set error
  void _setError(String? error) {
    _error = error;
    notifyListeners();
  }

  // Clear error
  void clearError() {
    _error = null;
    notifyListeners();
  }

  // Load transactions from local database
  Future<void> loadTransactionsFromDB({
    int? userId,
    String? startDate,
    String? endDate,
    String? category,
    String? source,
    int limit = 50,
  }) async {
    try {
      _setLoading(true);
      
      final transactions = await _dbService.getTransactions(
        userId: userId,
        startDate: startDate,
        endDate: endDate,
        category: category,
        source: source,
        limit: limit,
      );
      
      _transactions = transactions;
      
      // Load unverified transactions
      final unverified = await _dbService.getTransactions(
        userId: userId,
        limit: 20,
        orderBy: 'created_at DESC',
      );
      
      _unverifiedTransactions = unverified
          .where((tx) => tx.needsVerification)
          .toList();
      
      _setLoading(false);
    } catch (e) {
      _setError('Failed to load transactions: $e');
      _setLoading(false);
    }
  }

  // Sync transactions with server
  Future<void> syncTransactions(int userId, {bool force = false}) async {
    try {
      _setSyncing(true);
      _setError(null);

      // Check if we should sync (every 5 minutes unless forced)
      if (!force && _lastSyncTime != null) {
        final timeSinceLastSync = DateTime.now().difference(_lastSyncTime!);
        if (timeSinceLastSync.inMinutes < 5) {
          _setSyncing(false);
          return;
        }
      }

      // Upload unsynced local transactions
      await _uploadUnsyncedTransactions(userId);
      
      // Download transactions from server
      await _downloadTransactionsFromServer(userId);
      
      // Sync email transactions
      await _syncEmailTransactions(userId);
      
      _lastSyncTime = DateTime.now();
      await _dbService.updateSyncStatus('transactions', _lastSyncTime!);
      
      // Reload from database
      await loadTransactionsFromDB(userId: userId);
      
      _setSyncing(false);
    } catch (e) {
      _setError('Sync failed: $e');
      _setSyncing(false);
    }
  }

  // Upload unsynced transactions to server
  Future<void> _uploadUnsyncedTransactions(int userId) async {
    final unsyncedTransactions = await _dbService.getUnsyncedTransactions();
    
    for (final transaction in unsyncedTransactions) {
      try {
        final response = await _apiService.createTransaction(transaction);
        final serverTransaction = models.Transaction.fromJson(response['transaction']);
        
        // Mark as synced in local database
        await _dbService.markTransactionSynced(
          transaction.id!,
          serverTransaction.id!,
        );
      } catch (e) {
        print('Failed to sync transaction ${transaction.id}: $e');
      }
    }
  }

  // Download transactions from server
  Future<void> _downloadTransactionsFromServer(int userId) async {
    try {
      final response = await _apiService.getTransactions(userId, limit: 100);
      final serverTransactions = (response['transactions'] as List)
          .map((json) => models.Transaction.fromJson(json))
          .toList();

      // Save to local database
      for (final transaction in serverTransactions) {
        final existingTransaction = await _dbService.getTransaction(transaction.id!);
        if (existingTransaction == null) {
          await _dbService.insertTransaction(transaction.copyWith(
            id: null, // Let local database assign ID
          ));
        }
      }
    } catch (e) {
      print('Failed to download transactions: $e');
    }
  }

  // Sync email transactions
  Future<void> _syncEmailTransactions(int userId) async {
    try {
      await _apiService.syncEmails(userId);
    } catch (e) {
      print('Failed to sync emails: $e');
    }
  }

  // Add new transaction
  Future<bool> addTransaction(models.Transaction transaction) async {
    try {
      _setLoading(true);
      
      // Save to local database first
      final localId = await _dbService.insertTransaction(transaction);
      
      // Try to sync to server
      try {
        final response = await _apiService.createTransaction(transaction);
        final serverTransaction = models.Transaction.fromJson(response['transaction']);
        
        // Mark as synced
        await _dbService.markTransactionSynced(localId, serverTransaction.id!);
      } catch (e) {
        // Server sync failed, but local save succeeded
        print('Failed to sync new transaction to server: $e');
      }
      
      // Reload transactions
      await loadTransactionsFromDB(userId: transaction.userId);
      
      _setLoading(false);
      return true;
    } catch (e) {
      _setError('Failed to add transaction: $e');
      _setLoading(false);
      return false;
    }
  }

  // Update transaction
  Future<bool> updateTransaction(int id, Map<String, dynamic> updates) async {
    try {
      _setLoading(true);
      
      // Update in local database
      await _dbService.updateTransaction(id, updates);
      
      // Try to sync to server
      try {
        await _apiService.updateTransaction(id, updates);
      } catch (e) {
        print('Failed to sync transaction update to server: $e');
      }
      
      // Update local list
      final index = _transactions.indexWhere((tx) => tx.id == id);
      if (index != -1) {
        final updatedTransaction = _transactions[index].copyWith(
          amount: updates['amount'] ?? _transactions[index].amount,
          description: updates['description'] ?? _transactions[index].description,
          category: updates['category'] ?? _transactions[index].category,
          merchant: updates['merchant'] ?? _transactions[index].merchant,
          isVerified: updates['is_verified'] == 1 ? true : _transactions[index].isVerified,
          updatedAt: DateTime.now(),
        );
        _transactions[index] = updatedTransaction;
        
        // Remove from unverified list if verified
        if (updatedTransaction.isVerified) {
          _unverifiedTransactions.removeWhere((tx) => tx.id == id);
        }
        
        notifyListeners();
      }
      
      _setLoading(false);
      return true;
    } catch (e) {
      _setError('Failed to update transaction: $e');
      _setLoading(false);
      return false;
    }
  }

  // Delete transaction
  Future<bool> deleteTransaction(int id) async {
    try {
      _setLoading(true);
      
      // Delete from local database
      await _dbService.deleteTransaction(id);
      
      // Try to sync to server
      try {
        await _apiService.deleteTransaction(id);
      } catch (e) {
        print('Failed to sync transaction deletion to server: $e');
      }
      
      // Remove from local lists
      _transactions.removeWhere((tx) => tx.id == id);
      _unverifiedTransactions.removeWhere((tx) => tx.id == id);
      
      _setLoading(false);
      notifyListeners();
      return true;
    } catch (e) {
      _setError('Failed to delete transaction: $e');
      _setLoading(false);
      return false;
    }
  }

  // Verify transaction
  Future<bool> verifyTransaction(int id, {bool verified = true}) async {
    try {
      await updateTransaction(id, {
        'is_verified': verified ? 1 : 0,
        'confidence_score': verified ? 1.0 : 0.5,
      });
      
      // Try to sync verification to server
      try {
        await _apiService.verifyTransaction(id, verified: verified);
      } catch (e) {
        print('Failed to sync verification to server: $e');
      }
      
      return true;
    } catch (e) {
      _setError('Failed to verify transaction: $e');
      return false;
    }
  }

  // Bulk verify transactions
  Future<bool> bulkVerifyTransactions(List<int> transactionIds, {bool verified = true}) async {
    try {
      _setLoading(true);
      
      // Update locally
      for (final id in transactionIds) {
        await _dbService.updateTransaction(id, {
          'is_verified': verified ? 1 : 0,
          'confidence_score': verified ? 1.0 : 0.5,
        });
        
        // Update local lists
        final index = _transactions.indexWhere((tx) => tx.id == id);
        if (index != -1) {
          _transactions[index] = _transactions[index].copyWith(
            isVerified: verified,
            confidenceScore: verified ? 1.0 : 0.5,
          );
        }
      }
      
      // Remove from unverified list if verified
      if (verified) {
        _unverifiedTransactions.removeWhere((tx) => 
            transactionIds.contains(tx.id));
      }
      
      // Try to sync to server
      try {
        await _apiService.bulkVerifyTransactions(transactionIds, verified: verified);
      } catch (e) {
        print('Failed to sync bulk verification to server: $e');
      }
      
      _setLoading(false);
      notifyListeners();
      return true;
    } catch (e) {
      _setError('Failed to bulk verify transactions: $e');
      _setLoading(false);
      return false;
    }
  }

  // Load monthly statistics
  Future<void> loadMonthlyStats(int userId, int year, int month) async {
    try {
      // Try to get from server first
      try {
        _currentMonthStats = await _apiService.getMonthlyStats(userId, year, month);
      } catch (e) {
        // Fall back to local database
        final stats = await _dbService.getTransactionStats(
          userId: userId,
          startDate: DateTime(year, month, 1).toIso8601String(),
          endDate: DateTime(year, month + 1, 0, 23, 59, 59).toIso8601String(),
        );
        
        final categoryStats = await _dbService.getCategoryStats(
          userId: userId,
          startDate: DateTime(year, month, 1).toIso8601String(),
          endDate: DateTime(year, month + 1, 0, 23, 59, 59).toIso8601String(),
        );
        
        _currentMonthStats = TransactionStats(
          transactionCount: stats['transaction_count'] ?? 0,
          totalAmount: (stats['total_amount'] as num?)?.toDouble() ?? 0.0,
          averageAmount: (stats['average_amount'] as num?)?.toDouble() ?? 0.0,
          minAmount: (stats['min_amount'] as num?)?.toDouble() ?? 0.0,
          maxAmount: (stats['max_amount'] as num?)?.toDouble() ?? 0.0,
          categories: categoryStats.map((e) => CategoryStat(
            category: e['category'] ?? '',
            count: e['count'] ?? 0,
            total: (e['total'] as num?)?.toDouble() ?? 0.0,
            average: (e['average'] as num?)?.toDouble() ?? 0.0,
          )).toList(),
        );
      }
      
      notifyListeners();
    } catch (e) {
      _setError('Failed to load statistics: $e');
    }
  }

  // Load categories
  Future<void> loadCategories() async {
    try {
      // Try to get from server first
      try {
        _categories = await _apiService.getCategories();
      } catch (e) {
        // Fall back to local database
        _categories = await _dbService.getCategories();
      }
      
      notifyListeners();
    } catch (e) {
      _setError('Failed to load categories: $e');
    }
  }

  // Filter transactions
  List<models.Transaction> filterTransactions({
    String? category,
    String? source,
    DateTime? startDate,
    DateTime? endDate,
  }) {
    return _transactions.where((transaction) {
      if (category != null && transaction.category != category) return false;
      if (source != null && transaction.source != source) return false;
      if (startDate != null && transaction.transactionDate.isBefore(startDate)) return false;
      if (endDate != null && transaction.transactionDate.isAfter(endDate)) return false;
      return true;
    }).toList();
  }

  // Search transactions
  List<models.Transaction> searchTransactions(String query) {
    final lowerQuery = query.toLowerCase();
    return _transactions.where((transaction) {
      return transaction.description.toLowerCase().contains(lowerQuery) ||
             (transaction.merchant?.toLowerCase().contains(lowerQuery) ?? false) ||
             transaction.category.toLowerCase().contains(lowerQuery);
    }).toList();
  }

  // Get transactions by date range
  List<models.Transaction> getTransactionsByDateRange(DateTime start, DateTime end) {
    return _transactions.where((transaction) {
      return transaction.transactionDate.isAfter(start.subtract(const Duration(days: 1))) &&
             transaction.transactionDate.isBefore(end.add(const Duration(days: 1)));
    }).toList();
  }
}