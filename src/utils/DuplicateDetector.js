const Transaction = require('../models/Transaction');
const moment = require('moment-timezone');

class DuplicateDetector {
  constructor() {
    // Tolerance settings for duplicate detection
    this.tolerances = {
      amount: 0.01, // SGD 0.01 difference allowed
      time: 5 * 60 * 1000, // 5 minutes in milliseconds
      description: 0.8, // 80% similarity threshold
      merchant: 0.8, // 80% similarity threshold
    };
  }

  // Main duplicate detection function
  async findDuplicates(transaction, userId, options = {}) {
    const tolerance = { ...this.tolerances, ...options };
    
    try {
      // Get recent transactions for comparison
      const recentTransactions = await this.getRecentTransactions(
        userId,
        transaction.transactionDate,
        tolerance.time
      );

      if (recentTransactions.length === 0) {
        return { isDuplicate: false, duplicates: [], confidence: 0 };
      }

      const duplicates = [];

      for (const existing of recentTransactions) {
        const similarity = this.calculateSimilarity(transaction, existing, tolerance);
        
        if (similarity.isDuplicate) {
          duplicates.push({
            transaction: existing,
            confidence: similarity.confidence,
            reasons: similarity.reasons,
            score: similarity.score
          });
        }
      }

      // Sort by confidence (highest first)
      duplicates.sort((a, b) => b.confidence - a.confidence);

      return {
        isDuplicate: duplicates.length > 0,
        duplicates: duplicates,
        confidence: duplicates.length > 0 ? duplicates[0].confidence : 0,
        bestMatch: duplicates.length > 0 ? duplicates[0] : null
      };

    } catch (error) {
      console.error('Error in duplicate detection:', error);
      return { isDuplicate: false, duplicates: [], confidence: 0, error: error.message };
    }
  }

  // Get recent transactions for comparison
  async getRecentTransactions(userId, transactionDate, timeWindow) {
    const startTime = moment(transactionDate).subtract(timeWindow, 'milliseconds');
    const endTime = moment(transactionDate).add(timeWindow, 'milliseconds');

    // In a real implementation, this would query the database
    // For now, we'll simulate with a direct database query
    try {
      const Database = require('../database/Database');
      const transactions = await Database.all(`
        SELECT * FROM transactions 
        WHERE user_id = ? 
        AND transaction_date BETWEEN ? AND ?
        ORDER BY transaction_date DESC
      `, [userId, startTime.toISOString(), endTime.toISOString()]);

      return transactions.map(tx => Transaction.fromDatabase ? Transaction.fromDatabase(tx) : tx);
    } catch (error) {
      console.error('Error fetching recent transactions:', error);
      return [];
    }
  }

  // Calculate similarity between two transactions
  calculateSimilarity(transaction1, transaction2, tolerance) {
    const similarities = {
      amount: this.compareAmounts(transaction1.amount, transaction2.amount, tolerance.amount),
      time: this.compareTimes(transaction1.transactionDate, transaction2.transactionDate, tolerance.time),
      description: this.compareStrings(transaction1.description, transaction2.description, tolerance.description),
      merchant: this.compareStrings(transaction1.merchant || '', transaction2.merchant || '', tolerance.merchant),
      source: this.compareSources(transaction1.source, transaction2.source),
      category: transaction1.category === transaction2.category ? 1.0 : 0.0
    };

    // Calculate weights for each factor
    const weights = {
      amount: 0.3,
      time: 0.2,
      description: 0.2,
      merchant: 0.15,
      source: 0.1,
      category: 0.05
    };

    // Calculate weighted score
    let totalScore = 0;
    let maxPossibleScore = 0;
    const reasons = [];

    Object.keys(similarities).forEach(key => {
      const score = similarities[key] * weights[key];
      totalScore += score;
      maxPossibleScore += weights[key];

      if (similarities[key] > 0.7) {
        reasons.push(`${key}_match`);
      }
    });

    const confidence = totalScore / maxPossibleScore;

    // Determine if it's a duplicate based on multiple factors
    const isDuplicate = this.isDuplicateByRules(similarities, confidence);

    return {
      isDuplicate,
      confidence,
      score: totalScore,
      reasons,
      details: similarities
    };
  }

  // Compare amounts with tolerance
  compareAmounts(amount1, amount2, tolerance) {
    const diff = Math.abs(amount1 - amount2);
    if (diff <= tolerance) return 1.0;
    if (diff <= tolerance * 5) return 0.8;
    if (diff <= tolerance * 10) return 0.5;
    return 0.0;
  }

  // Compare timestamps with tolerance
  compareTimes(date1, date2, toleranceMs) {
    const diff = Math.abs(new Date(date1) - new Date(date2));
    if (diff <= toleranceMs) return 1.0;
    if (diff <= toleranceMs * 2) return 0.8;
    if (diff <= toleranceMs * 5) return 0.5;
    return 0.0;
  }

  // Compare strings using various similarity measures
  compareStrings(str1, str2, threshold) {
    if (!str1 || !str2) return 0.0;
    
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    if (s1 === s2) return 1.0;
    
    // Calculate Levenshtein distance
    const levenshtein = this.calculateLevenshteinDistance(s1, s2);
    const maxLength = Math.max(s1.length, s2.length);
    const similarity = 1 - (levenshtein / maxLength);
    
    return similarity >= threshold ? similarity : 0.0;
  }

  // Compare transaction sources
  compareSources(source1, source2) {
    if (source1 === source2) return 0.0; // Same source = not likely duplicate
    
    // Different sources (e.g., 'telegram' vs 'email') are more likely to be duplicates
    // of the same real-world transaction captured in different ways
    if ((source1 === 'telegram' && source2 === 'email') ||
        (source1 === 'email' && source2 === 'telegram')) {
      return 1.0;
    }
    
    return 0.5; // Other combinations get moderate score
  }

  // Calculate Levenshtein distance between two strings
  calculateLevenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  // Rules-based duplicate detection
  isDuplicateByRules(similarities, confidence) {
    // High confidence threshold
    if (confidence >= 0.85) return true;
    
    // Exact amount and close time
    if (similarities.amount === 1.0 && similarities.time >= 0.8) return true;
    
    // Same amount, similar description, different sources
    if (similarities.amount === 1.0 && 
        similarities.description >= 0.7 && 
        similarities.source >= 0.5) return true;
    
    // Very similar description and merchant with close amount
    if (similarities.description >= 0.9 && 
        similarities.merchant >= 0.9 && 
        similarities.amount >= 0.8) return true;
    
    return false;
  }

  // Enhanced duplicate detection for specific scenarios
  async detectEmailReceiptDuplicates(transaction, userId) {
    // Special logic for detecting duplicates between email transactions and receipt transactions
    const timeWindow = 24 * 60 * 60 * 1000; // 24 hours
    
    const recentTransactions = await this.getRecentTransactions(
      userId,
      transaction.transactionDate,
      timeWindow
    );

    const potentialDuplicates = recentTransactions.filter(existing => {
      // Look for transactions with different sources
      if (existing.source === transaction.source) return false;
      
      // Check if amounts match exactly or very closely
      const amountDiff = Math.abs(existing.amount - transaction.amount);
      if (amountDiff > 0.01) return false;
      
      // Check time difference (email and receipt of same transaction should be close)
      const timeDiff = Math.abs(new Date(existing.transactionDate) - new Date(transaction.transactionDate));
      if (timeDiff > timeWindow) return false;
      
      return true;
    });

    return potentialDuplicates.map(existing => ({
      transaction: existing,
      confidence: 0.9,
      reason: 'email_receipt_duplicate',
      timeDifference: Math.abs(new Date(existing.transactionDate) - new Date(transaction.transactionDate)),
      amountDifference: Math.abs(existing.amount - transaction.amount)
    }));
  }

  // Merge duplicate transactions
  async mergeDuplicates(primaryTransaction, duplicateTransaction, userId) {
    try {
      // Determine which transaction has higher confidence/better data
      const mergedData = this.selectBestData(primaryTransaction, duplicateTransaction);
      
      // Update the primary transaction with merged data
      await Transaction.update(primaryTransaction.id, mergedData);
      
      // Mark the duplicate as merged or delete it
      await Transaction.delete(duplicateTransaction.id);
      
      return {
        success: true,
        mergedTransaction: { ...primaryTransaction, ...mergedData },
        deletedTransaction: duplicateTransaction
      };
      
    } catch (error) {
      console.error('Error merging duplicates:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Select the best data from two transactions
  selectBestData(transaction1, transaction2) {
    const merged = {};
    
    // Use the more detailed description
    merged.description = transaction1.description.length > transaction2.description.length 
      ? transaction1.description 
      : transaction2.description;
    
    // Use the merchant if one has it and the other doesn't
    merged.merchant = transaction1.merchant || transaction2.merchant;
    
    // Use the higher confidence score's category
    merged.category = transaction1.confidenceScore > transaction2.confidenceScore
      ? transaction1.category
      : transaction2.category;
    
    // Use the more accurate timestamp (receipt usually more accurate than email)
    merged.transactionDate = transaction1.source === 'telegram' 
      ? transaction1.transactionDate 
      : transaction2.transactionDate;
    
    // Use the higher confidence score
    merged.confidenceScore = Math.max(transaction1.confidenceScore, transaction2.confidenceScore);
    
    // Mark as verified if either was verified
    merged.isVerified = transaction1.isVerified || transaction2.isVerified;
    
    return merged;
  }

  // Batch duplicate detection for multiple transactions
  async batchDetectDuplicates(transactions, userId) {
    const results = [];
    
    for (const transaction of transactions) {
      const duplicateResult = await this.findDuplicates(transaction, userId);
      results.push({
        transaction,
        duplicateResult
      });
    }
    
    return results;
  }
}

module.exports = new DuplicateDetector();