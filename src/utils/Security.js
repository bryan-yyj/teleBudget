const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

class Security {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'telebudget_default_secret_change_in_production';
    this.encryptionKey = process.env.DATABASE_ENCRYPTION_KEY || 'default_encryption_key_change_in_production';
  }

  // Hash password or sensitive data
  hashData(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  // Generate secure random token
  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  // Encrypt sensitive data
  encryptData(text) {
    try {
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher(algorithm, key, iv);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      
      return {
        encrypted: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex')
      };
    } catch (error) {
      console.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  // Decrypt sensitive data
  decryptData(encryptedData) {
    try {
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const decipher = crypto.createDecipher(algorithm, key);
      
      decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  // Generate JWT token
  generateJWT(payload, expiresIn = '24h') {
    return jwt.sign(payload, this.jwtSecret, { expiresIn });
  }

  // Verify JWT token
  verifyJWT(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  // Middleware to verify JWT
  authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    try {
      const decoded = this.verifyJWT(token);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
  }

  // Rate limiting middleware
  createRateLimit(windowMs = 15 * 60 * 1000, max = 100) {
    return rateLimit({
      windowMs: windowMs,
      max: max,
      message: {
        error: 'Too many requests, please try again later',
        retryAfter: Math.ceil(windowMs / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false
    });
  }

  // Strict rate limiting for sensitive endpoints
  createStrictRateLimit() {
    return this.createRateLimit(15 * 60 * 1000, 10); // 10 requests per 15 minutes
  }

  // Validate input data to prevent injection attacks
  sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    
    return input
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/[<>&'"]/g, (char) => {
        const entities = {
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          "'": '&#39;',
          '"': '&quot;'
        };
        return entities[char] || char;
      });
  }

  // Validate email format
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Validate Telegram ID
  isValidTelegramId(telegramId) {
    return /^\d+$/.test(telegramId) && telegramId.length >= 8 && telegramId.length <= 12;
  }

  // Validate transaction amount
  isValidAmount(amount) {
    const num = parseFloat(amount);
    return !isNaN(num) && num >= 0 && num <= 999999.99;
  }

  // Validate date
  isValidDate(dateString) {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date);
  }

  // Check for suspicious transaction patterns
  detectSuspiciousTransaction(transaction, userHistory = []) {
    const suspiciousFlags = [];

    // Check for unusually large amounts
    if (transaction.amount > 10000) {
      suspiciousFlags.push('large_amount');
    }

    // Check for round numbers (often indicates manual/fake entries)
    if (transaction.amount % 100 === 0 && transaction.amount > 100) {
      suspiciousFlags.push('round_amount');
    }

    // Check for duplicate amounts in short time frame
    const recentSimilar = userHistory.filter(tx => {
      const timeDiff = Math.abs(new Date(transaction.transactionDate) - new Date(tx.transactionDate));
      return Math.abs(tx.amount - transaction.amount) < 0.01 && timeDiff < 60000; // Same amount within 1 minute
    });

    if (recentSimilar.length > 0) {
      suspiciousFlags.push('potential_duplicate');
    }

    // Check for suspicious descriptions
    const suspiciousKeywords = ['test', 'fake', 'dummy', 'sample'];
    const description = transaction.description.toLowerCase();
    if (suspiciousKeywords.some(keyword => description.includes(keyword))) {
      suspiciousFlags.push('suspicious_description');
    }

    return suspiciousFlags;
  }

  // Validate webhook signature (for Telegram)
  validateTelegramWebhook(body, signature, botToken) {
    if (!signature || !botToken) return false;

    const hash = crypto
      .createHmac('sha256', botToken)
      .update(JSON.stringify(body))
      .digest('hex');

    return hash === signature;
  }

  // Generate secure webhook URL
  generateWebhookPath(identifier) {
    const hash = crypto.createHash('sha256').update(identifier + this.jwtSecret).digest('hex');
    return `/webhook/${identifier}/${hash.substring(0, 16)}`;
  }

  // Log security events
  logSecurityEvent(event, details = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event: event,
      details: details,
      ip: details.ip || 'unknown',
      userAgent: details.userAgent || 'unknown'
    };

    console.log('SECURITY EVENT:', JSON.stringify(logEntry));
    
    // In production, you would send this to a security monitoring service
    // or save to a dedicated security log file
  }

  // Middleware to log security events
  securityLogger(req, res, next) {
    const originalSend = res.send;
    res.send = function(body) {
      // Log failed authentication attempts
      if (res.statusCode === 401 || res.statusCode === 403) {
        Security.prototype.logSecurityEvent('auth_failure', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          path: req.path,
          method: req.method
        });
      }
      
      originalSend.call(this, body);
    };
    
    next();
  }

  // Clean sensitive data from logs
  sanitizeForLogging(data) {
    const sensitiveFields = ['password', 'token', 'access_token', 'refresh_token', 'secret'];
    const sanitized = { ...data };
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }
}

module.exports = new Security();