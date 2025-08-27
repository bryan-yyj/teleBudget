# 📱 Setup Flutter App on Your Phone

## Quick Steps

### 1. Install Flutter
Download from: https://flutter.dev/docs/get-started/install

### 2. Enable Developer Mode (Android)
- Settings → About Phone
- Tap "Build Number" 7 times  
- Settings → Developer Options → USB Debugging ON

### 3. Connect Phone & Test
```bash
# Connect phone via USB
flutter devices

# You should see your phone listed
```

### 4. Update API URL for Phone Testing
Edit `lib/services/api_service.dart`:

```dart
// Find your computer's IP address first:
// Windows: ipconfig
// Mac: ifconfig  

// Then change this line:
static const String baseUrl = 'http://YOUR_COMPUTER_IP:3000';
// Example: 'http://192.168.1.100:3000'
```

### 5. Run on Phone
```bash
cd flutter_app
flutter pub get
flutter run
```

## Alternative: Build APK
```bash
flutter build apk --release

# Install the APK from:
# build/app/outputs/flutter-apk/app-release.apk
```

## Troubleshooting

**Phone not detected:**
```bash
flutter doctor
# Fix any issues, then try again
```

**Can't connect to backend:**
- Make sure your computer and phone are on same WiFi
- Check your computer's IP address matches the API URL
- Make sure backend server is running: `npm run dev`
- Test backend: http://YOUR_COMPUTER_IP:3000/health

**App crashes:**
```bash
flutter logs  # See error details
```