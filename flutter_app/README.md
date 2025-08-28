# TeleBudget Flutter App

A clean, modern Flutter app for tracking your budget transactions from the TeleBudget backend.

## Features

- 📱 Modern Material 3 design
- 🌙 Dark theme optimized
- 🔄 Real-time transaction sync
- ⚙️ Configurable backend URL
- 📊 Spending statistics
- 🔌 Offline mode with mock data

## Quick Setup

### 1. Install Dependencies
```bash
flutter pub get
```

### 2. Run the App
```bash
# On connected device/emulator
flutter run

# Or build APK for Android
flutter build apk --release
```

### 3. Configure Backend URL

When you first open the app:
1. Tap the **Settings** icon (⚙️) in the top right
2. Enter your backend URL:
   - **Local development**: `http://localhost:3000`
   - **Phone testing**: `http://YOUR_COMPUTER_IP:3000`
3. Tap **Save**

### Finding Your Computer's IP

**Windows:**
```cmd
ipconfig
```

**Mac/Linux:**
```bash
ifconfig
```

Look for your local network IP (usually starts with 192.168.x.x)

## App Structure

```
lib/
├── main.dart           # Main app entry point
└── test/
    └── widget_test.dart # Basic tests
```

## Key Components

### HomeScreen
- Displays transaction list
- Shows spending statistics
- Handles backend connection
- Settings configuration

### Transaction Model
- Clean data structure
- JSON serialization
- Type-safe properties

### Features

**Automatic Fallback:**
- Tries to connect to backend
- Falls back to mock data if offline
- Shows connection status

**Settings:**
- Persistent backend URL storage
- Easy configuration dialog
- Automatic reconnection

**Modern UI:**
- Material 3 design system
- Gradient cards
- Clean typography
- Intuitive navigation

## Testing

```bash
# Run all tests
flutter test

# Check for issues
flutter analyze

# Clean build
flutter clean && flutter pub get
```

## Troubleshooting

### "No transactions" showing
1. Check backend is running on port 3000
2. Verify backend URL in settings
3. Check network connectivity
4. Look for error messages in the orange warning bar

### Connection issues on phone
1. Make sure phone and computer are on same WiFi
2. Use computer's IP address, not `localhost`
3. Check firewall isn't blocking port 3000
4. Try accessing `http://YOUR_IP:3000/health` in phone browser

### Build issues
```bash
flutter clean
flutter pub get
flutter analyze
```

## Backend Integration

The app connects to these endpoints:
- `GET /api/transactions/user/1` - Fetch transactions
- `GET /health` - Health check

Mock data is used when backend is unavailable.

## Next Steps

- Add transaction creation
- Implement user authentication
- Add real-time WebSocket updates
- Include receipt photo viewing
- Add spending analytics charts

---

**Ready to track your budget!** 📊💰