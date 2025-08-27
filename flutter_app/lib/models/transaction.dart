import 'package:flutter/material.dart';

class Transaction {
  final int? id;
  final int userId;
  final double amount;
  final String currency;
  final String description;
  final String category;
  final String? merchant;
  final DateTime transactionDate;
  final String source;
  final String? sourceReference;
  final double confidenceScore;
  final bool isVerified;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final String? categoryIcon;

  Transaction({
    this.id,
    required this.userId,
    required this.amount,
    this.currency = 'SGD',
    required this.description,
    this.category = 'Others',
    this.merchant,
    required this.transactionDate,
    required this.source,
    this.sourceReference,
    this.confidenceScore = 1.0,
    this.isVerified = true,
    required this.createdAt,
    this.updatedAt,
    this.categoryIcon,
  });

  factory Transaction.fromJson(Map<String, dynamic> json) {
    return Transaction(
      id: json['id'],
      userId: json['user_id'],
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] ?? 'SGD',
      description: json['description'] ?? '',
      category: json['category'] ?? 'Others',
      merchant: json['merchant'],
      transactionDate: DateTime.parse(json['transaction_date']),
      source: json['source'] ?? '',
      sourceReference: json['source_reference'],
      confidenceScore: (json['confidence_score'] as num?)?.toDouble() ?? 1.0,
      isVerified: json['is_verified'] == 1,
      createdAt: DateTime.parse(json['created_at']),
      updatedAt: json['updated_at'] != null ? DateTime.parse(json['updated_at']) : null,
      categoryIcon: json['category_icon'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'user_id': userId,
      'amount': amount,
      'currency': currency,
      'description': description,
      'category': category,
      'merchant': merchant,
      'transaction_date': transactionDate.toIso8601String(),
      'source': source,
      'source_reference': sourceReference,
      'confidence_score': confidenceScore,
      'is_verified': isVerified ? 1 : 0,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt?.toIso8601String(),
    };
  }

  Map<String, dynamic> toDatabase() {
    return {
      'id': id,
      'user_id': userId,
      'amount': amount,
      'currency': currency,
      'description': description,
      'category': category,
      'merchant': merchant,
      'transaction_date': transactionDate.toIso8601String(),
      'source': source,
      'source_reference': sourceReference,
      'confidence_score': confidenceScore,
      'is_verified': isVerified ? 1 : 0,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt?.toIso8601String(),
    };
  }

  factory Transaction.fromDatabase(Map<String, dynamic> map) {
    return Transaction(
      id: map['id'],
      userId: map['user_id'],
      amount: (map['amount'] as num).toDouble(),
      currency: map['currency'] ?? 'SGD',
      description: map['description'] ?? '',
      category: map['category'] ?? 'Others',
      merchant: map['merchant'],
      transactionDate: DateTime.parse(map['transaction_date']),
      source: map['source'] ?? '',
      sourceReference: map['source_reference'],
      confidenceScore: (map['confidence_score'] as num?)?.toDouble() ?? 1.0,
      isVerified: (map['is_verified'] ?? 1) == 1,
      createdAt: DateTime.parse(map['created_at']),
      updatedAt: map['updated_at'] != null ? DateTime.parse(map['updated_at']) : null,
    );
  }

  Transaction copyWith({
    int? id,
    int? userId,
    double? amount,
    String? currency,
    String? description,
    String? category,
    String? merchant,
    DateTime? transactionDate,
    String? source,
    String? sourceReference,
    double? confidenceScore,
    bool? isVerified,
    DateTime? createdAt,
    DateTime? updatedAt,
    String? categoryIcon,
  }) {
    return Transaction(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      amount: amount ?? this.amount,
      currency: currency ?? this.currency,
      description: description ?? this.description,
      category: category ?? this.category,
      merchant: merchant ?? this.merchant,
      transactionDate: transactionDate ?? this.transactionDate,
      source: source ?? this.source,
      sourceReference: sourceReference ?? this.sourceReference,
      confidenceScore: confidenceScore ?? this.confidenceScore,
      isVerified: isVerified ?? this.isVerified,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      categoryIcon: categoryIcon ?? this.categoryIcon,
    );
  }

  String get formattedAmount => '${currency} ${amount.toStringAsFixed(2)}';
  
  String get sourceIcon {
    switch (source) {
      case 'telegram':
        return '📸';
      case 'email':
        return '📧';
      case 'manual':
        return '✏️';
      default:
        return '📝';
    }
  }

  Color get confidenceColor {
    if (confidenceScore >= 0.8) return Colors.green;
    if (confidenceScore >= 0.5) return Colors.orange;
    return Colors.red;
  }

  String get confidenceText {
    if (confidenceScore >= 0.8) return 'High confidence';
    if (confidenceScore >= 0.5) return 'Medium confidence';
    return 'Low confidence - please verify';
  }

  bool get needsVerification => !isVerified || confidenceScore < 0.8;
}

class TransactionStats {
  final int transactionCount;
  final double totalAmount;
  final double averageAmount;
  final double minAmount;
  final double maxAmount;
  final List<CategoryStat> categories;

  TransactionStats({
    required this.transactionCount,
    required this.totalAmount,
    required this.averageAmount,
    required this.minAmount,
    required this.maxAmount,
    required this.categories,
  });

  factory TransactionStats.fromJson(Map<String, dynamic> json) {
    return TransactionStats(
      transactionCount: json['transaction_count'] ?? 0,
      totalAmount: (json['total_amount'] as num?)?.toDouble() ?? 0.0,
      averageAmount: (json['average_amount'] as num?)?.toDouble() ?? 0.0,
      minAmount: (json['min_amount'] as num?)?.toDouble() ?? 0.0,
      maxAmount: (json['max_amount'] as num?)?.toDouble() ?? 0.0,
      categories: (json['categories'] as List?)
          ?.map((e) => CategoryStat.fromJson(e))
          .toList() ?? [],
    );
  }
}

class CategoryStat {
  final String category;
  final int count;
  final double total;
  final double average;

  CategoryStat({
    required this.category,
    required this.count,
    required this.total,
    required this.average,
  });

  factory CategoryStat.fromJson(Map<String, dynamic> json) {
    return CategoryStat(
      category: json['category'] ?? '',
      count: json['count'] ?? 0,
      total: (json['total'] as num?)?.toDouble() ?? 0.0,
      average: (json['average'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

enum TransactionSource {
  telegram,
  email,
  manual,
  unknown,
}

enum TransactionCategory {
  foodDining('Food & Dining', '🍽️', Color(0xFFFF6B6B)),
  transportation('Transportation', '🚗', Color(0xFF4ECDC4)),
  shopping('Shopping', '🛍️', Color(0xFF45B7D1)),
  entertainment('Entertainment', '🎬', Color(0xFFFFA07A)),
  billsUtilities('Bills & Utilities', '💡', Color(0xFF98D8C8)),
  healthcare('Healthcare', '⚕️', Color(0xFFF7DC6F)),
  education('Education', '📚', Color(0xFFBB8FCE)),
  others('Others', '📦', Color(0xFF95A5A6));

  const TransactionCategory(this.displayName, this.icon, this.color);
  
  final String displayName;
  final String icon;
  final Color color;

  static TransactionCategory fromString(String category) {
    switch (category.toLowerCase().replaceAll(' ', '').replaceAll('&', '')) {
      case 'fooddining':
        return TransactionCategory.foodDining;
      case 'transportation':
        return TransactionCategory.transportation;
      case 'shopping':
        return TransactionCategory.shopping;
      case 'entertainment':
        return TransactionCategory.entertainment;
      case 'billsutilities':
        return TransactionCategory.billsUtilities;
      case 'healthcare':
        return TransactionCategory.healthcare;
      case 'education':
        return TransactionCategory.education;
      default:
        return TransactionCategory.others;
    }
  }
}