import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../models/transaction.dart';

class ApiService {
  // Change this to your computer's IP address when testing on phone
  // static const String baseUrl = 'http://localhost:3000';  // For emulator/desktop
  static const String baseUrl = 'http://YOUR_IP_HERE:3000';  // For phone - REPLACE YOUR_IP_HERE with actual IP
  static const String apiUrl = '$baseUrl/api';
  
  static ApiService? _instance;
  static ApiService get instance => _instance ??= ApiService._();
  
  ApiService._();

  Future<String?> _getAuthToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token');
  }

  Future<Map<String, String>> _getHeaders({bool includeAuth = true}) async {
    final headers = {
      'Content-Type': 'application/json',
    };
    
    if (includeAuth) {
      final token = await _getAuthToken();
      if (token != null) {
        headers['Authorization'] = 'Bearer $token';
      }
    }
    
    return headers;
  }

  Future<Map<String, dynamic>> _handleResponse(http.Response response) async {
    final body = jsonDecode(response.body);
    
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return body;
    } else {
      throw ApiException(
        message: body['error'] ?? 'Unknown error occurred',
        statusCode: response.statusCode,
      );
    }
  }

  // Health check
  Future<Map<String, dynamic>> healthCheck() async {
    final response = await http.get(
      Uri.parse('$baseUrl/health'),
      headers: await _getHeaders(includeAuth: false),
    );
    
    return _handleResponse(response);
  }

  // Authentication
  Future<String> getOutlookAuthUrl(int userId) async {
    final response = await http.get(
      Uri.parse('$baseUrl/auth/outlook/login?userId=$userId'),
      headers: await _getHeaders(includeAuth: false),
    );
    
    if (response.statusCode == 302) {
      return response.headers['location'] ?? '';
    }
    
    throw ApiException(message: 'Failed to get auth URL', statusCode: response.statusCode);
  }

  Future<Map<String, dynamic>> getAuthStatus(int userId) async {
    final response = await http.get(
      Uri.parse('$baseUrl/auth/outlook/status/$userId'),
      headers: await _getHeaders(),
    );
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> disconnectOutlook(int userId) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/outlook/disconnect/$userId'),
      headers: await _getHeaders(),
    );
    
    return _handleResponse(response);
  }

  // Transactions
  Future<Map<String, dynamic>> getTransactions(int userId, {
    String? startDate,
    String? endDate,
    String? category,
    String? source,
    int limit = 50,
    int page = 1,
    bool unverified = false,
  }) async {
    final queryParams = <String, String>{
      'limit': limit.toString(),
      'page': page.toString(),
      'unverified': unverified.toString(),
    };
    
    if (startDate != null) queryParams['startDate'] = startDate;
    if (endDate != null) queryParams['endDate'] = endDate;
    if (category != null) queryParams['category'] = category;
    if (source != null) queryParams['source'] = source;
    
    final uri = Uri.parse('$apiUrl/transactions/user/$userId').replace(
      queryParameters: queryParams,
    );
    
    final response = await http.get(uri, headers: await _getHeaders());
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> getTransaction(int id) async {
    final response = await http.get(
      Uri.parse('$apiUrl/transactions/$id'),
      headers: await _getHeaders(),
    );
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> createTransaction(Transaction transaction) async {
    final response = await http.post(
      Uri.parse('$apiUrl/transactions'),
      headers: await _getHeaders(),
      body: jsonEncode(transaction.toJson()),
    );
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> updateTransaction(int id, Map<String, dynamic> updates) async {
    final response = await http.put(
      Uri.parse('$apiUrl/transactions/$id'),
      headers: await _getHeaders(),
      body: jsonEncode(updates),
    );
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> deleteTransaction(int id) async {
    final response = await http.delete(
      Uri.parse('$apiUrl/transactions/$id'),
      headers: await _getHeaders(),
    );
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> verifyTransaction(int id, {bool verified = true}) async {
    final response = await http.post(
      Uri.parse('$apiUrl/transactions/$id/verify'),
      headers: await _getHeaders(),
      body: jsonEncode({'verified': verified}),
    );
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> bulkVerifyTransactions(List<int> transactionIds, {bool verified = true}) async {
    final response = await http.post(
      Uri.parse('$apiUrl/transactions/bulk-verify'),
      headers: await _getHeaders(),
      body: jsonEncode({
        'transactionIds': transactionIds,
        'verified': verified,
      }),
    );
    
    return _handleResponse(response);
  }

  Future<TransactionStats> getMonthlyStats(int userId, int year, int month) async {
    final response = await http.get(
      Uri.parse('$apiUrl/transactions/stats/$userId/$year/$month'),
      headers: await _getHeaders(),
    );
    
    final data = await _handleResponse(response);
    return TransactionStats.fromJson(data);
  }

  Future<List<Map<String, dynamic>>> getCategories() async {
    final response = await http.get(
      Uri.parse('$apiUrl/transactions/categories/list'),
      headers: await _getHeaders(),
    );
    
    final data = await _handleResponse(response);
    return List<Map<String, dynamic>>.from(data['categories'] ?? data);
  }

  // AI Processing
  Future<Map<String, dynamic>> processReceipt(File imageFile, int userId) async {
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$apiUrl/ai/process-receipt'),
    );
    
    request.headers.addAll(await _getHeaders());
    request.fields['userId'] = userId.toString();
    request.files.add(await http.MultipartFile.fromPath('receipt', imageFile.path));
    
    final streamedResponse = await request.send();
    final response = await http.Response.fromStream(streamedResponse);
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> getProcessingStatus(int transactionId) async {
    final response = await http.get(
      Uri.parse('$apiUrl/ai/processing-status/$transactionId'),
      headers: await _getHeaders(),
    );
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> getOllamaStatus() async {
    final response = await http.get(
      Uri.parse('$apiUrl/ai/ollama-status'),
      headers: await _getHeaders(),
    );
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> getQueueStatus() async {
    final response = await http.get(
      Uri.parse('$apiUrl/ai/queue-status'),
      headers: await _getHeaders(),
    );
    
    return _handleResponse(response);
  }

  // Email Sync
  Future<Map<String, dynamic>> syncEmails(int userId, {int days = 7}) async {
    final response = await http.post(
      Uri.parse('$apiUrl/sync/emails/$userId'),
      headers: await _getHeaders(),
      body: jsonEncode({'days': days}),
    );
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> getSyncStatus(int userId) async {
    final response = await http.get(
      Uri.parse('$apiUrl/sync/status/$userId'),
      headers: await _getHeaders(),
    );
    
    return _handleResponse(response);
  }

  // Telegram Webhook (for testing)
  Future<Map<String, dynamic>> setupTelegramWebhook() async {
    final response = await http.post(
      Uri.parse('$baseUrl/webhook/telegram/setup-webhook'),
      headers: await _getHeaders(),
    );
    
    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> getTelegramWebhookInfo() async {
    final response = await http.get(
      Uri.parse('$baseUrl/webhook/telegram/webhook-info'),
      headers: await _getHeaders(),
    );
    
    return _handleResponse(response);
  }
}

class ApiException implements Exception {
  final String message;
  final int statusCode;
  
  ApiException({required this.message, required this.statusCode});
  
  @override
  String toString() => 'ApiException: $message (Status: $statusCode)';
}

// Network connectivity helper
class NetworkUtils {
  static Future<bool> isConnected() async {
    try {
      final response = await http.get(Uri.parse('https://www.google.com')).timeout(
        const Duration(seconds: 5),
      );
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }
  
  static Future<bool> isServerReachable() async {
    try {
      final response = await ApiService.instance.healthCheck();
      return response['status'] == 'OK';
    } catch (e) {
      return false;
    }
  }
}