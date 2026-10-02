# TeleBudget - Comprehensive Budget Tracking System

> **Current deployment:** The active backend is in [`cloudflare/`](cloudflare/README.md): Cloudflare Pages Functions, a Queue consumer Worker, D1, and Workers AI. Send a Telegram message such as `6.50 at macs` or a receipt photo. Receipt images are processed in memory and discarded. The older Express/Ollama instructions below describe the legacy local backend and are not used for Cloudflare deployment.

A production-ready budget tracking application that combines AI-powered receipt processing, email integration, and Telegram bot automation to provide seamless expense tracking for Singapore users.

## 🌟 Key Features

### 📸 AI-Powered Receipt Processing
- **Telegram Bot Integration**: Send receipt photos directly via Telegram
- **Ollama LLaVA Model**: Local AI processing for privacy and accuracy
- **Automatic Data Extraction**: Amount, merchant, date, category, and itemization
- **Confidence Scoring**: AI confidence levels with manual verification prompts

### 📧 Email Transaction Detection
- **Microsoft Outlook Integration**: OAuth 2.0 secure email access
- **PayNow/PayLah Detection**: Automatic parsing of Singapore payment notifications
- **DBS Bank Support**: Specialized parsing for DBS PayNow emails
- **Real-time Sync**: Background email processing every 30 minutes

### 📱 Flutter Mobile App
- **Cross-platform**: iOS and Android support
- **Offline Capability**: Local SQLite database with cloud sync
- **Real-time Updates**: WebSocket integration for live notifications
- **Material Design**: Modern, intuitive interface

### 🔒 Security & Privacy
- **End-to-End Encryption**: Sensitive data encrypted at rest
- **OAuth 2.0**: Secure email access without password storage
- **Rate Limiting**: Protection against abuse and attacks
- **Webhook Verification**: Secure Telegram webhook validation
- **Duplicate Detection**: Advanced algorithms to prevent duplicate entries

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Telegram Bot  │    │  Flutter App    │    │  Email Service  │
│   (Receipt)     │    │  (Mobile UI)    │    │  (PayNow/PayLah)│
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   Express.js    │
                    │   Backend API   │
                    └─────────────────┘
                                 │
            ┌────────────────────┼────────────────────┐
            │                    │                    │
   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
   │     SQLite      │  │   Ollama AI     │  │   WebSocket     │
   │   Database      │  │   (LLaVA)       │  │   Real-time     │
   └─────────────────┘  └─────────────────┘  └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** (v18 or higher)
- **Ollama** installed locally with LLaVA model
- **Flutter** SDK (for mobile app development)
- **Telegram Bot Token** (from BotFather)
- **Microsoft Azure App** (for Outlook integration)

### 1. Backend Setup

```bash
# Clone repository
git clone <repository-url>
cd teleBudget

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
nano .env
```

### 2. Environment Configuration

Update `.env` with your credentials:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_WEBHOOK_URL=https://yourdomain.com/webhook/telegram

# Microsoft Azure/Outlook
AZURE_CLIENT_ID=your_azure_client_id
AZURE_CLIENT_SECRET=your_azure_client_secret
AZURE_TENANT_ID=your_azure_tenant_id
AZURE_REDIRECT_URI=http://localhost:3000/auth/outlook/callback

# Ollama AI
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llava:latest

# Security
DATABASE_ENCRYPTION_KEY=your_secure_encryption_key
JWT_SECRET=your_jwt_secret
```

### 3. Start Ollama and Pull Model

```bash
# Start Ollama service
ollama serve

# Pull LLaVA model (in another terminal)
ollama pull llava:latest
```

### 4. Start the Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

### 5. Flutter App Setup

```bash
cd flutter_app

# Install dependencies
flutter pub get

# Run on device/emulator
flutter run
```

## 🔧 API Endpoints

### Authentication
- `GET /auth/outlook/login` - Initiate Outlook OAuth
- `GET /auth/outlook/callback` - Handle OAuth callback
- `POST /auth/outlook/disconnect/:userId` - Disconnect Outlook

### Transactions
- `GET /api/transactions/user/:userId` - Get user transactions
- `POST /api/transactions` - Create new transaction
- `PUT /api/transactions/:id` - Update transaction
- `DELETE /api/transactions/:id` - Delete transaction
- `POST /api/transactions/:id/verify` - Verify transaction

### AI Processing
- `POST /api/ai/process-receipt` - Upload and process receipt
- `GET /api/ai/processing-status/:transactionId` - Check processing status
- `GET /api/ai/ollama-status` - Check AI service status

### Email Sync
- `POST /api/sync/emails/:userId` - Sync user emails
- `GET /api/sync/status/:userId` - Get sync status

### Webhooks
- `POST /webhook/telegram` - Telegram bot webhook

## 🔐 Security Features

### Data Protection
- **Encryption at Rest**: SQLite database with AES-256 encryption
- **Secure Token Storage**: JWT with configurable expiration
- **OAuth 2.0**: No password storage for email access
- **Input Sanitization**: XSS and injection attack prevention

### Rate Limiting
- **General API**: 100 requests per 15 minutes
- **Authentication**: 10 requests per 15 minutes
- **File Uploads**: 5 uploads per minute

### Webhook Security
- **Telegram Verification**: HMAC signature validation
- **Secure URLs**: Cryptographically generated webhook paths
- **IP Whitelisting**: Optional IP-based access control

## 🇸🇬 Singapore-Specific Features

### Email Parsing Patterns
- **DBS PayNow**: `SGD XX.XX` amount extraction, Singapore timezone parsing
- **PayLah**: Mobile number and reference ID extraction
- **Date Handling**: SGT timezone with various formats
- **Merchant Detection**: Singapore business name patterns

### Transaction Categories
- Food & Dining (Hawker centres, restaurants)
- Transportation (MRT, buses, Grab, taxis)
- Shopping (malls, NTUC, Cold Storage)
- Entertainment (cinemas, attractions)
- Bills & Utilities (SP Group, telcos)
- Healthcare (clinics, hospitals, pharmacies)

### Currency Support
- **Primary**: Singapore Dollar (SGD)
- **Secondary**: USD, EUR, MYR with conversion tracking

## 📊 Data Flow Examples

### Receipt Processing Flow
```
User sends photo → Telegram → Express API → Ollama AI → Transaction created → WebSocket notification → Flutter app updates
```

### Email Sync Flow
```
PayNow notification → Outlook → OAuth API → Email parser → Duplicate detection → Transaction created → User notification
```

### Duplicate Detection
```
New transaction → Compare recent transactions → Check amount/time/merchant → Flag duplicates → User review → Merge/keep separate
```

## 🔧 Configuration Options

### AI Processing
- **Confidence Thresholds**: Adjustable AI confidence levels
- **Processing Timeout**: Maximum time for receipt processing
- **Queue Management**: Concurrent processing limits

### Email Sync
- **Sync Frequency**: Configurable sync intervals
- **Email Retention**: How far back to process emails
- **Pattern Customization**: Custom parsing patterns

### Security Settings
- **Token Expiration**: JWT token lifetime
- **Rate Limits**: Per-endpoint rate limiting
- **Encryption**: Database encryption settings

## 🐛 Troubleshooting

### Common Issues

**Ollama Connection Failed**
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Restart Ollama service
ollama serve
```

**Telegram Webhook Issues**
```bash
# Check webhook status
curl -X GET "https://your-domain.com/webhook/telegram/webhook-info"

# Reset webhook
curl -X POST "https://your-domain.com/webhook/telegram/setup-webhook"
```

**Email Sync Not Working**
```bash
# Test Outlook connection
curl -X GET "http://localhost:3000/auth/outlook/test/USER_ID"

# Force email sync
curl -X POST "http://localhost:3000/api/sync/emails/USER_ID"
```

### Logs and Monitoring
- **Application Logs**: `console.log` output in development
- **Security Events**: Logged to console with timestamps
- **WebSocket Events**: Real-time connection status
- **Processing Queue**: Job status and error tracking

## 📈 Performance Optimization

### Database
- **Indexes**: Optimized queries for common operations
- **Pagination**: Large result set handling
- **Caching**: In-memory caching for frequent queries

### AI Processing
- **Queue System**: Background processing with retry logic
- **Batch Processing**: Multiple receipts processed concurrently
- **Fallback Handling**: Graceful degradation when AI fails

### Mobile App
- **Offline Mode**: Local database with sync capabilities
- **Image Compression**: Optimize photos before upload
- **Background Sync**: Automatic sync when app becomes active

## 🚀 Deployment

### Production Checklist
- [ ] Change default encryption keys
- [ ] Set up HTTPS with SSL certificates
- [ ] Configure production database
- [ ] Set up monitoring and logging
- [ ] Enable backup automation
- [ ] Configure rate limiting
- [ ] Set up webhook domain
- [ ] Test all integrations

### Docker Deployment
```dockerfile
# Dockerfile example
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Environment Variables
Production environments should use secure values for:
- `TELEGRAM_BOT_TOKEN`
- `AZURE_CLIENT_SECRET`
- `DATABASE_ENCRYPTION_KEY`
- `JWT_SECRET`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Ollama Team**: For the excellent local AI inference
- **Telegram**: For the robust bot API
- **Microsoft**: For the Graph API and OAuth implementation
- **Flutter Team**: For the cross-platform mobile framework
- **Singapore Government**: For the PayNow digital payment system

---

**Note**: This application is designed specifically for Singapore users and payment systems. Adapting for other countries will require modifications to email parsing patterns and transaction categories.
