Write-Host "Starting TeleBudget Flutter App..." -ForegroundColor Green
Write-Host ""

Write-Host "Checking Flutter installation..." -ForegroundColor Yellow
flutter doctor --version
Write-Host ""

Write-Host "Getting dependencies..." -ForegroundColor Yellow
flutter pub get
Write-Host ""

Write-Host "Available devices:" -ForegroundColor Yellow
flutter devices
Write-Host ""

Write-Host "Running app..." -ForegroundColor Green
Write-Host "Make sure your phone is connected or emulator is running!" -ForegroundColor Cyan
Write-Host ""

Read-Host "Press Enter to continue"
flutter run