import 'dart:async';
import 'dart:io';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';
import 'package:path_provider/path_provider.dart';

import '../models/transaction.dart' as models;

class DatabaseService {
  static Database? _database;
  static const String _databaseName = 'telebudget.db';
  static const int _databaseVersion = 1;

  // Singleton pattern
  static final DatabaseService _instance = DatabaseService._internal();
  factory DatabaseService() => _instance;
  DatabaseService._internal();

  Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  Future<Database> _initDatabase() async {
    Directory documentsDirectory = await getApplicationDocumentsDirectory();
    String path = join(documentsDirectory.path, _databaseName);
    
    return await openDatabase(
      path,
      version: _databaseVersion,
      onCreate: _onCreate,
      onUpgrade: _onUpgrade,
    );
  }

  Future<void> initDatabase() async {
    await database;
  }

  Future<void> _onCreate(Database db, int version) async {
    await _createTables(db);
  }

  Future<void> _onUpgrade(Database db, int oldVersion, int newVersion) async {
    // Handle database upgrades here
    if (oldVersion < newVersion) {
      // Add migration logic when needed
      await _createTables(db);
    }
  }

  Future<void> _createTables(Database db) async {
    // Transactions table
    await db.execute('''
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'SGD',
        description TEXT,
        category TEXT,
        merchant TEXT,
        transaction_date TEXT NOT NULL,
        source TEXT NOT NULL,
        source_reference TEXT,
        confidence_score REAL DEFAULT 1.0,
        is_verified INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        synced INTEGER DEFAULT 0,
        server_id INTEGER
      )
    ''');

    // Categories table
    await db.execute('''
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        is_system INTEGER DEFAULT 0,
        user_id INTEGER
      )
    ''');

    // Sync status table
    await db.execute('''
      CREATE TABLE IF NOT EXISTS sync_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        last_sync_at TEXT,
        sync_direction TEXT DEFAULT 'both'
      )
    ''');

    // User settings table
    await db.execute('''
      CREATE TABLE IF NOT EXISTS user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT
      )
    ''');

    // Create indexes
    await db.execute('CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions (user_id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (transaction_date)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_transactions_synced ON transactions (synced)');

    // Insert default categories
    await _insertDefaultCategories(db);
  }

  Future<void> _insertDefaultCategories(Database db) async {
    final categories = [
      {'name': 'Food & Dining', 'icon': '🍽️', 'color': '#FF6B6B', 'is_system': 1},
      {'name': 'Transportation', 'icon': '🚗', 'color': '#4ECDC4', 'is_system': 1},
      {'name': 'Shopping', 'icon': '🛍️', 'color': '#45B7D1', 'is_system': 1},
      {'name': 'Entertainment', 'icon': '🎬', 'color': '#FFA07A', 'is_system': 1},
      {'name': 'Bills & Utilities', 'icon': '💡', 'color': '#98D8C8', 'is_system': 1},
      {'name': 'Healthcare', 'icon': '⚕️', 'color': '#F7DC6F', 'is_system': 1},
      {'name': 'Education', 'icon': '📚', 'color': '#BB8FCE', 'is_system': 1},
      {'name': 'Others', 'icon': '📦', 'color': '#95A5A6', 'is_system': 1},
    ];

    for (final category in categories) {
      await db.insert(
        'categories',
        category,
        conflictAlgorithm: ConflictAlgorithm.ignore,
      );
    }
  }

  // Transaction CRUD operations
  Future<int> insertTransaction(models.Transaction transaction) async {
    final db = await database;
    final data = transaction.toDatabase();
    data.remove('id'); // Remove id for auto-increment
    
    return await db.insert('transactions', data);
  }

  Future<List<models.Transaction>> getTransactions({
    int? userId,
    String? startDate,
    String? endDate,
    String? category,
    String? source,
    bool? synced,
    int? limit,
    int? offset,
    String orderBy = 'transaction_date DESC',
  }) async {
    final db = await database;
    
    String query = 'SELECT * FROM transactions';
    List<dynamic> args = [];
    List<String> conditions = [];

    if (userId != null) {
      conditions.add('user_id = ?');
      args.add(userId);
    }

    if (startDate != null) {
      conditions.add('transaction_date >= ?');
      args.add(startDate);
    }

    if (endDate != null) {
      conditions.add('transaction_date <= ?');
      args.add(endDate);
    }

    if (category != null) {
      conditions.add('category = ?');
      args.add(category);
    }

    if (source != null) {
      conditions.add('source = ?');
      args.add(source);
    }

    if (synced != null) {
      conditions.add('synced = ?');
      args.add(synced ? 1 : 0);
    }

    if (conditions.isNotEmpty) {
      query += ' WHERE ${conditions.join(' AND ')}';
    }

    query += ' ORDER BY $orderBy';

    if (limit != null) {
      query += ' LIMIT $limit';
      if (offset != null) {
        query += ' OFFSET $offset';
      }
    }

    final List<Map<String, dynamic>> maps = await db.rawQuery(query, args);
    return List.generate(maps.length, (i) => models.Transaction.fromDatabase(maps[i]));
  }

  Future<models.Transaction?> getTransaction(int id) async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      'transactions',
      where: 'id = ?',
      whereArgs: [id],
      limit: 1,
    );

    if (maps.isNotEmpty) {
      return models.Transaction.fromDatabase(maps.first);
    }
    return null;
  }

  Future<int> updateTransaction(int id, Map<String, dynamic> updates) async {
    final db = await database;
    updates['updated_at'] = DateTime.now().toIso8601String();
    
    return await db.update(
      'transactions',
      updates,
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<int> deleteTransaction(int id) async {
    final db = await database;
    return await db.delete(
      'transactions',
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  // Sync operations
  Future<void> markTransactionSynced(int localId, int serverId) async {
    final db = await database;
    await db.update(
      'transactions',
      {
        'synced': 1,
        'server_id': serverId,
        'updated_at': DateTime.now().toIso8601String(),
      },
      where: 'id = ?',
      whereArgs: [localId],
    );
  }

  Future<List<Transaction>> getUnsyncedTransactions() async {
    return await getTransactions(synced: false);
  }

  Future<void> updateSyncStatus(String tableName, DateTime lastSyncAt) async {
    final db = await database;
    await db.insert(
      'sync_status',
      {
        'table_name': tableName,
        'last_sync_at': lastSyncAt.toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<DateTime?> getLastSyncTime(String tableName) async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      'sync_status',
      where: 'table_name = ?',
      whereArgs: [tableName],
      limit: 1,
    );

    if (maps.isNotEmpty && maps.first['last_sync_at'] != null) {
      return DateTime.parse(maps.first['last_sync_at']);
    }
    return null;
  }

  // Statistics and analytics
  Future<Map<String, dynamic>> getTransactionStats({
    int? userId,
    String? startDate,
    String? endDate,
  }) async {
    final db = await database;
    
    String query = '''
      SELECT 
        COUNT(*) as transaction_count,
        SUM(amount) as total_amount,
        AVG(amount) as average_amount,
        MIN(amount) as min_amount,
        MAX(amount) as max_amount
      FROM transactions
    ''';
    
    List<dynamic> args = [];
    List<String> conditions = [];

    if (userId != null) {
      conditions.add('user_id = ?');
      args.add(userId);
    }

    if (startDate != null) {
      conditions.add('transaction_date >= ?');
      args.add(startDate);
    }

    if (endDate != null) {
      conditions.add('transaction_date <= ?');
      args.add(endDate);
    }

    if (conditions.isNotEmpty) {
      query += ' WHERE ${conditions.join(' AND ')}';
    }

    final List<Map<String, dynamic>> result = await db.rawQuery(query, args);
    return result.isNotEmpty ? result.first : {};
  }

  Future<List<Map<String, dynamic>>> getCategoryStats({
    int? userId,
    String? startDate,
    String? endDate,
  }) async {
    final db = await database;
    
    String query = '''
      SELECT 
        category,
        COUNT(*) as count,
        SUM(amount) as total,
        AVG(amount) as average
      FROM transactions
    ''';
    
    List<dynamic> args = [];
    List<String> conditions = [];

    if (userId != null) {
      conditions.add('user_id = ?');
      args.add(userId);
    }

    if (startDate != null) {
      conditions.add('transaction_date >= ?');
      args.add(startDate);
    }

    if (endDate != null) {
      conditions.add('transaction_date <= ?');
      args.add(endDate);
    }

    if (conditions.isNotEmpty) {
      query += ' WHERE ${conditions.join(' AND ')}';
    }

    query += ' GROUP BY category ORDER BY total DESC';

    return await db.rawQuery(query, args);
  }

  // Categories
  Future<List<Map<String, dynamic>>> getCategories() async {
    final db = await database;
    return await db.query('categories', orderBy: 'name');
  }

  // User settings
  Future<void> setSetting(String key, String value) async {
    final db = await database;
    await db.insert(
      'user_settings',
      {'key': key, 'value': value},
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<String?> getSetting(String key) async {
    final db = await database;
    final List<Map<String, dynamic>> maps = await db.query(
      'user_settings',
      where: 'key = ?',
      whereArgs: [key],
      limit: 1,
    );

    if (maps.isNotEmpty) {
      return maps.first['value'];
    }
    return null;
  }

  // Database maintenance
  Future<void> clearAllData() async {
    final db = await database;
    await db.execute('DELETE FROM transactions');
    await db.execute('DELETE FROM sync_status');
    await db.execute('DELETE FROM user_settings');
    // Keep categories as they are system data
  }

  Future<void> vacuum() async {
    final db = await database;
    await db.execute('VACUUM');
  }

  Future<void> close() async {
    final db = await database;
    await db.close();
    _database = null;
  }
}