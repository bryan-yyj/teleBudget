import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../services/api_service.dart';

class AuthProvider with ChangeNotifier {
  int? _userId;
  String? _telegramId;
  String? _outlookEmail;
  bool _isAuthenticated = false;
  bool _isLoading = false;
  String? _error;

  // Getters
  int? get userId => _userId;
  String? get telegramId => _telegramId;
  String? get outlookEmail => _outlookEmail;
  bool get isAuthenticated => _isAuthenticated;
  bool get isLoading => _isLoading;
  String? get error => _error;

  // Set loading state
  void _setLoading(bool loading) {
    _isLoading = loading;
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

  // Load user from storage
  Future<void> loadUserFromStorage() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _userId = prefs.getInt('user_id');
      _telegramId = prefs.getString('telegram_id');
      _outlookEmail = prefs.getString('outlook_email');
      
      if (_userId != null) {
        _isAuthenticated = true;
        notifyListeners();
      }
    } catch (e) {
      _setError('Failed to load user data');
    }
  }

  // Login with Telegram ID (simulate user creation)
  Future<bool> loginWithTelegram(String telegramId) async {
    _setLoading(true);
    _setError(null);

    try {
      // In a real implementation, this would call an API to create or find the user
      // For now, we'll simulate user creation
      final userId = DateTime.now().millisecondsSinceEpoch ~/ 1000; // Simple ID generation
      
      await _saveUserToStorage(userId, telegramId, null);
      
      _userId = userId;
      _telegramId = telegramId;
      _outlookEmail = null;
      _isAuthenticated = true;
      
      _setLoading(false);
      notifyListeners();
      return true;
      
    } catch (e) {
      _setError('Failed to login: $e');
      _setLoading(false);
      return false;
    }
  }

  // Connect Outlook email
  Future<bool> connectOutlook() async {
    if (_userId == null) {
      _setError('User not logged in');
      return false;
    }

    _setLoading(true);
    _setError(null);

    try {
      // Get auth URL from API
      final authUrl = await ApiService.instance.getOutlookAuthUrl(_userId!);
      
      // In a real app, you would open a web view or browser for OAuth
      // For now, we'll simulate successful connection
      _setError('Please complete OAuth flow in browser: $authUrl');
      _setLoading(false);
      return false;
      
    } catch (e) {
      _setError('Failed to connect Outlook: $e');
      _setLoading(false);
      return false;
    }
  }

  // Check Outlook connection status
  Future<bool> checkOutlookConnection() async {
    if (_userId == null) return false;

    try {
      final status = await ApiService.instance.getAuthStatus(_userId!);
      final isConnected = status['connected'] ?? false;
      final email = status['email'];
      
      if (isConnected && email != null) {
        _outlookEmail = email;
        await _updateOutlookEmailInStorage(email);
        notifyListeners();
        return true;
      }
      
      return false;
    } catch (e) {
      return false;
    }
  }

  // Disconnect Outlook
  Future<bool> disconnectOutlook() async {
    if (_userId == null) return false;

    _setLoading(true);
    _setError(null);

    try {
      await ApiService.instance.disconnectOutlook(_userId!);
      
      _outlookEmail = null;
      await _updateOutlookEmailInStorage(null);
      
      _setLoading(false);
      notifyListeners();
      return true;
      
    } catch (e) {
      _setError('Failed to disconnect Outlook: $e');
      _setLoading(false);
      return false;
    }
  }

  // Logout
  Future<void> logout() async {
    _setLoading(true);
    
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.clear();
      
      _userId = null;
      _telegramId = null;
      _outlookEmail = null;
      _isAuthenticated = false;
      _error = null;
      
      _setLoading(false);
      notifyListeners();
    } catch (e) {
      _setError('Failed to logout: $e');
      _setLoading(false);
    }
  }

  // Save user data to storage
  Future<void> _saveUserToStorage(int userId, String telegramId, String? outlookEmail) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('user_id', userId);
    await prefs.setString('telegram_id', telegramId);
    if (outlookEmail != null) {
      await prefs.setString('outlook_email', outlookEmail);
    }
  }

  // Update Outlook email in storage
  Future<void> _updateOutlookEmailInStorage(String? email) async {
    final prefs = await SharedPreferences.getInstance();
    if (email != null) {
      await prefs.setString('outlook_email', email);
    } else {
      await prefs.remove('outlook_email');
    }
  }

  // Manual email update (for when OAuth completes outside the app)
  void updateOutlookEmail(String email) {
    _outlookEmail = email;
    _updateOutlookEmailInStorage(email);
    notifyListeners();
  }

  // Check if user has completed setup
  bool get hasCompletedSetup => _userId != null && _telegramId != null;
  
  // Check if user has Outlook connected
  bool get hasOutlookConnected => _outlookEmail != null;
}