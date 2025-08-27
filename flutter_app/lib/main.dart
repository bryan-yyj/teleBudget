import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

void main() {
  runApp(const TeleBudgetApp());
}

class TeleBudgetApp extends StatelessWidget {
  const TeleBudgetApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TeleBudget',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        primaryColor: const Color(0xFF6366F1),
        scaffoldBackgroundColor: const Color(0xFF0F0F23),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF6366F1),
          secondary: Color(0xFF8B5CF6),
          surface: Color(0xFF1E1E2E),
          background: Color(0xFF0F0F23),
          onSurface: Color(0xFFE5E7EB),
          onBackground: Color(0xFFE5E7EB),
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1E1E2E),
          elevation: 0,
          centerTitle: true,
          titleTextStyle: TextStyle(
            color: Color(0xFFE5E7EB),
            fontSize: 24,
            fontWeight: FontWeight.w700,
          ),
        ),
        cardTheme: CardTheme(
          color: const Color(0xFF1E1E2E),
          elevation: 8,
          shadowColor: Colors.black.withOpacity(0.3),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        floatingActionButtonTheme: const FloatingActionButtonThemeData(
          backgroundColor: Color(0xFF6366F1),
          foregroundColor: Colors.white,
        ),
      ),
      home: const TransactionListScreen(),
    );
  }
}

class TransactionListScreen extends StatefulWidget {
  const TransactionListScreen({Key? key}) : super(key: key);

  @override
  State<TransactionListScreen> createState() => _TransactionListScreenState();
}

class _TransactionListScreenState extends State<TransactionListScreen> {
  List<Map<String, dynamic>> transactions = [];
  bool isLoading = true;
  String error = '';
  
  // Replace with your computer's IP address
  static const String baseUrl = 'http://YOUR_IP_HERE:3000';

  @override
  void initState() {
    super.initState();
    loadTransactions();
  }

  Future<void> loadTransactions() async {
    setState(() {
      isLoading = true;
      error = '';
    });

    try {
      // Test with mock data first
      await Future.delayed(const Duration(seconds: 1));
      
      // Uncomment this when backend is ready:
      /*
      final response = await http.get(
        Uri.parse('$baseUrl/api/transactions/user/1'),
        headers: {'Content-Type': 'application/json'},
      );
      
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        setState(() {
          transactions = List<Map<String, dynamic>>.from(data['transactions'] ?? []);
          isLoading = false;
        });
      } else {
        throw Exception('Failed to load transactions');
      }
      */
      
      // Mock data for now
      setState(() {
        transactions = [
          {
            'id': 1,
            'amount': 15.50,
            'description': 'Coffee at Starbucks',
            'category': 'Food & Dining',
            'transactionDate': DateTime.now().subtract(const Duration(hours: 2)).toIso8601String(),
            'merchant': 'Starbucks',
            'source': 'manual'
          },
          {
            'id': 2,
            'amount': 45.00,
            'description': 'Grocery shopping',
            'category': 'Food & Dining',
            'transactionDate': DateTime.now().subtract(const Duration(days: 1)).toIso8601String(),
            'merchant': 'FairPrice',
            'source': 'receipt'
          },
          {
            'id': 3,
            'amount': 8.50,
            'description': 'Bus fare',
            'category': 'Transportation',
            'transactionDate': DateTime.now().subtract(const Duration(days: 2)).toIso8601String(),
            'merchant': 'SBS Transit',
            'source': 'telegram'
          },
        ];
        isLoading = false;
      });
      
    } catch (e) {
      setState(() {
        error = 'Failed to load transactions: $e';
        isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final totalAmount = transactions.fold<double>(0, (sum, tx) => sum + (tx['amount'] as num).toDouble());
    
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          // Modern App Bar with gradient
          SliverAppBar(
            expandedHeight: 200,
            floating: false,
            pinned: true,
            flexibleSpace: FlexibleSpaceBar(
              title: const Text('TeleBudget'),
              background: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Color(0xFF6366F1),
                      Color(0xFF8B5CF6),
                      Color(0xFFEC4899),
                    ],
                  ),
                ),
                child: Container(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.transparent,
                        Colors.black.withOpacity(0.3),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            actions: [
              Container(
                margin: const EdgeInsets.only(right: 16),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: IconButton(
                  icon: const Icon(Icons.refresh),
                  onPressed: loadTransactions,
                ),
              ),
            ],
          ),
          
          // Stats Cards
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Row(
                children: [
                  Expanded(
                    child: _buildStatCard(
                      'Total Spent',
                      '\$${totalAmount.toStringAsFixed(2)}',
                      Icons.trending_down,
                      const Color(0xFFEF4444),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: _buildStatCard(
                      'Transactions',
                      '${transactions.length}',
                      Icons.receipt_long,
                      const Color(0xFF6366F1),
                    ),
                  ),
                ],
              ),
            ),
          ),
          
          // Connection Status
          SliverToBoxAdapter(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFF1E1E2E),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: const Color(0xFF6366F1).withOpacity(0.3),
                  width: 1,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.wifi,
                        color: error.isEmpty ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                        size: 20,
                      ),
                      const SizedBox(width: 8),
                      const Text(
                        'Connection Status',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 16,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Backend: $baseUrl',
                    style: TextStyle(
                      color: const Color(0xFFE5E7EB).withOpacity(0.8),
                      fontSize: 14,
                    ),
                  ),
                  if (error.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEF4444).withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: const Color(0xFFEF4444).withOpacity(0.3),
                        ),
                      ),
                      child: Text(
                        'Error: $error',
                        style: const TextStyle(color: Color(0xFFEF4444)),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          
          // Transactions List
          isLoading
              ? const SliverFillRemaining(
                  child: Center(
                    child: CircularProgressIndicator(
                      color: Color(0xFF6366F1),
                    ),
                  ),
                )
              : transactions.isEmpty
                  ? SliverFillRemaining(
                      child: Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(24),
                              decoration: BoxDecoration(
                                color: const Color(0xFF1E1E2E),
                                borderRadius: BorderRadius.circular(50),
                              ),
                              child: const Icon(
                                Icons.receipt_long,
                                size: 48,
                                color: Color(0xFF6B7280),
                              ),
                            ),
                            const SizedBox(height: 24),
                            const Text(
                              'No transactions yet',
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Send a receipt to your Telegram bot to get started!',
                              style: TextStyle(
                                color: const Color(0xFFE5E7EB).withOpacity(0.7),
                              ),
                            ),
                          ],
                        ),
                      ),
                    )
                  : SliverPadding(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (context, index) {
                            final transaction = transactions[index];
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: TransactionCard(transaction: transaction),
                            );
                          },
                          childCount: transactions.length,
                        ),
                      ),
                    ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text('Add transaction feature coming soon!'),
              backgroundColor: const Color(0xFF1E1E2E),
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          );
        },
        icon: const Icon(Icons.add),
        label: const Text('Add Transaction'),
      ),
    );
  }
  
  Widget _buildStatCard(String title, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E2E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: color.withOpacity(0.3),
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: color.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const Spacer(),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            value,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            title,
            style: TextStyle(
              color: const Color(0xFFE5E7EB).withOpacity(0.7),
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }
}

class TransactionCard extends StatelessWidget {
  final Map<String, dynamic> transaction;
  
  const TransactionCard({Key? key, required this.transaction}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final amount = (transaction['amount'] as num).toDouble();
    final description = transaction['description'] as String;
    final category = transaction['category'] as String;
    final merchant = transaction['merchant'] as String? ?? '';
    final source = transaction['source'] as String;
    
    DateTime date;
    try {
      date = DateTime.parse(transaction['transactionDate'] as String);
    } catch (e) {
      date = DateTime.now();
    }

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: _getCategoryColor(category),
          child: Text(
            _getCategoryIcon(category),
            style: const TextStyle(fontSize: 20),
          ),
        ),
        title: Text(
          description,
          style: const TextStyle(fontWeight: FontWeight.w500),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (merchant.isNotEmpty) Text(merchant),
            Text('$category • ${DateFormat('MMM dd, HH:mm').format(date)}'),
          ],
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '-\$${amount.toStringAsFixed(2)}',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 16,
                color: Colors.red,
              ),
            ),
            Text(
              source.toUpperCase(),
              style: TextStyle(
                fontSize: 12,
                color: Colors.grey[600],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Color _getCategoryColor(String category) {
    switch (category.toLowerCase()) {
      case 'food & dining':
        return Colors.orange[100]!;
      case 'transportation':
        return Colors.blue[100]!;
      case 'shopping':
        return Colors.purple[100]!;
      default:
        return Colors.grey[100]!;
    }
  }

  String _getCategoryIcon(String category) {
    switch (category.toLowerCase()) {
      case 'food & dining':
        return '🍽️';
      case 'transportation':
        return '🚗';
      case 'shopping':
        return '🛍️';
      default:
        return '📦';
    }
  }
}