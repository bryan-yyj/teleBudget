@echo off
echo Starting TeleBudget Flutter App...
echo.

echo Checking Flutter installation...
flutter doctor --version
echo.

echo Getting dependencies...
flutter pub get
echo.

echo Running app...
echo Connect your phone or start an emulator first!
echo.
pause
flutter run

pause