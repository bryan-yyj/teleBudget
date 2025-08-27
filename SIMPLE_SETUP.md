# 🚀 TeleBudget - Simple Setup Guide

A streamlined budget tracker with Telegram bot and AI receipt processing.

## What You Need

1. **Telegram Bot Token** (free from BotFather)
2. **Ollama AI** (free, runs locally)
3. **Node.js** (free)

## 📋 Step-by-Step Setup

### 1. Create Telegram Bot (5 minutes)

1. **Open Telegram** and search for `@BotFather`
2. **Start a chat** with BotFather and send: `/newbot`
3. **Choose a name**: `My Budget Bot` (can be anything)
4. **Choose a username**: `your_budget_bot` (must be unique and end with "bot")
5. **Copy the token** BotFather gives you

**Your token will look like:**
```
1234567890:ABCdefGHIjklMNOpqrSTUVwxyz1234567890
```

**⚠️ Important:** This token is like a password - keep it secure!

### 2. Install Ollama AI (5 minutes)

**Windows:**
```bash
# Download from https://ollama.com/download/windows
# Or use winget:
winget install Ollama.Ollama

# Start Ollama
ollama serve

# In new terminal, pull the AI model:
ollama pull llava:latest
```

**Mac:**
```bash
# Download from https://ollama.com/download/macos
# Or use brew:
brew install ollama

# Start and pull model
ollama serve
ollama pull llava:latest
```

### 3. Setup Your Environment

Edit your `.env` file and replace these values:

```env
# Your Bot Token (from step 1)
TELEGRAM_BOT_TOKEN=1234567890:ABC-DEF1234ghIkl-zyx57W2v1u123ew11

# Generate secure keys (run these commands):
# For DATABASE_ENCRYPTION_KEY:
DATABASE_ENCRYPTION_KEY=your_32_character_key_here_change_this_now

# For JWT_SECRET:
JWT_SECRET=your_long_random_secret_key_here_change_this
```

**Generate secure keys:**
```bash
# Generate encryption key (32+ chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Install and Start

```bash
# Install dependencies
npm install

# Start the server (this creates the database automatically)
npm run dev
```

**What happens when you start:**
- ✅ SQLite database is created automatically at `./data/telebudget.db`
- ✅ All tables are set up (users, transactions, receipts, etc.)
- ✅ Default categories are added
- ✅ WebSocket server starts for real-time updates

### 5. Verify Database Creation

After starting the server, check that the database was created:

```bash
# Check if database file exists
ls -la data/

# You should see: telebudget.db
```

**Or on Windows:**
```cmd
dir data\
```

### 6. Test Everything

1. **Check server**: http://localhost:3000/health
2. **Find your bot** in Telegram (search for the username you created)
3. **Send `/start`** to your bot
4. **Send a receipt photo** to test AI processing
5. **Type `5.50 Coffee`** to test manual entry

**First time you send `/start`:**
- Your Telegram user will be added to the database
- You'll see a welcome message
- Database tables will start filling with your data

### 7. Database Structure (Auto-Created)

The database includes these tables:

```
📊 users          - Your Telegram user info
💰 transactions   - All your expense records  
📸 receipts       - Receipt images and AI data
🏷️  categories     - Expense categories (Food, Transport, etc.)
⚙️  processing_queue - AI job queue
📱 app_settings   - App configuration
```

**View your data** (optional):
```bash
# Install SQLite browser (optional)
# Windows: Download from https://sqlitebrowser.org/
# Mac: brew install --cask db-browser-for-sqlite

# Then open: data/telebudget.db
```

## 🎯 How to Use

### Send Receipt Photos
- Just send any receipt photo to your Telegram bot
- AI will extract: amount, merchant, date, category
- Processing takes 10-30 seconds

### Manual Transactions
- Type: `15.50 Lunch at McDonald's`
- Format: `{amount} {description}`

### Commands
- `/start` - Welcome message
- `/help` - Show help
- `/recent` - View recent transactions
- `/stats` - View spending statistics
- `/categories` - View available categories

## 🔧 Troubleshooting

### "Bot not responding" or "ETELEGRAM: 404 Not Found"
```bash
# This error means your bot token is wrong or not set

# 1. Check your .env file has the correct token:
cat .env  # Look at TELEGRAM_BOT_TOKEN line

# 2. Your token should look like:
# TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrSTUVwxyz1234567890

# 3. Common issues:
# - Token has spaces or extra characters
# - Token is still the default "your_telegram_bot_token_from_botfather"
# - Token was copied incorrectly from BotFather

# 4. Get a new token from BotFather:
# - Go to @BotFather in Telegram
# - Send /mybots
# - Choose your bot
# - Go to "API Token"
# - Copy the new token

# 5. Test server without bot (server will still work):
curl http://localhost:3000/health
```

### "Receipt processing fails"
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# If not working:
ollama serve
ollama pull llava:latest
```

### "Database not created"
```bash
# Test database creation separately:
node test-db.js

# Check what's in your project directory:
ls -la
dir  # Windows

# Check if data directory exists:
ls -la data/
dir data\  # Windows

# Manual troubleshooting:
mkdir data  # Create data directory manually
npm run dev

# Check server output - should see:
# "Creating directory: data"  (if needed)
# "Database path: ./data/telebudget.db"
# "📦 Connected to SQLite database"
# "✅ Database tables initialized"
```

### "Database errors"
```bash
# If database is corrupted, delete and restart:
rm data/telebudget.db
npm run dev  # Will recreate automatically

# Check database file was created:
ls -la data/telebudget.db  # Should show file size > 0
```

### "Database permission errors"
```bash
# Windows - make sure you have write permissions:
# Right-click on teleBudget folder → Properties → Security → Make sure you have "Full control"

# Mac/Linux - fix permissions:
chmod 755 data/
chmod 644 data/telebudget.db
```

## 📱 Flutter App on Your Phone

### Option 1: Direct USB Connection (Easiest)

**Android:**
1. **Enable Developer Options** on your phone:
   - Go to Settings → About Phone
   - Tap "Build Number" 7 times
   - Go back to Settings → Developer Options
   - Turn on "USB Debugging"

2. **Connect phone to computer** with USB cable

3. **Install and run:**
   ```bash
   # Install Flutter: https://flutter.dev/docs/get-started/install
   
   cd flutter_app
   flutter pub get
   
   # Check if your phone is detected
   flutter devices
   
   # Run on your phone
   flutter run
   ```

**iPhone:**
1. **Install Xcode** (Mac only)
2. **Connect iPhone** with USB
3. **Trust your computer** when prompted
4. Same commands as Android above

### Option 2: Build APK for Android (No USB needed)

```bash
cd flutter_app

# Build APK file
flutter build apk --release

# APK will be created at:
# build/app/outputs/flutter-apk/app-release.apk

# Transfer this file to your phone and install it
```

### Option 3: Wireless Testing (Advanced)

**Android:**
```bash
# After connecting once via USB, enable wireless debugging
adb tcpip 5555
adb connect YOUR_PHONE_IP:5555

# Now you can flutter run wirelessly
```

### ⚙️ Update Backend URL for Phone

Your phone can't access `localhost`, so update the API URL:

```dart
// In flutter_app/lib/services/api_service.dart
// Change this line:
static const String baseUrl = 'http://localhost:3000';

// To your computer's IP address:
static const String baseUrl = 'http://192.168.1.100:3000';  // Your computer's IP
```

**Find your computer's IP:**
```bash
# Windows
ipconfig

# Mac/Linux  
ifconfig
```

### 🔧 Flutter Setup Troubleshooting

```bash
# Check Flutter installation
flutter doctor

# Fix any issues it reports, then:
cd flutter_app
flutter pub get
flutter devices  # Should show your phone
flutter run
```

## 🏗️ What's Included

- ✅ Telegram Bot with AI receipt processing
- ✅ Manual transaction entry
- ✅ SQLite database (local)
- ✅ Real-time WebSocket updates
- ✅ Transaction categorization
- ✅ Spending statistics
- ✅ Duplicate detection

## 🔒 Security Notes

- All data stored locally in SQLite
- No cloud dependencies
- Telegram communications are encrypted
- AI processing happens locally (private)

## 💡 Tips

- **Clear photos**: Take well-lit, clear receipt photos
- **Manual backup**: You can always add transactions manually
- **Categories**: AI will auto-categorize, but you can edit
- **Local only**: Everything runs on your computer

## 🚀 Ready to Use!

Your budget tracker is now ready. Send a receipt photo to your Telegram bot and watch the magic happen!

---

**Need help?** Create an issue in the GitHub repository or check the logs in your terminal.