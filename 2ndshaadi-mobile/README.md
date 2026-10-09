# 2ndShaadi mobile app (customers)

Flutter app for members (not the admin site). Same server and features as the website.

| | Supported |
|---|---|
| Android | 7.0 and newer (built and tested for Android 15 and 16: edge-to-edge, predictive back, photo picker) |
| iOS | 18, 26 and 27 (the last three versions) |
| Screens | small phones (320 dp) to tablets; tablets get a side menu and grids |

## Permissions (asked only when needed)

| Permission | Why | When it is asked |
|---|---|---|
| Internet, network state | Talk to the server; show "You are offline" | Never asked (automatic) |
| Camera | Take a profile photo | When you tap "Take a photo" |
| Photos | Choose profile photos | Android uses the system photo picker (no permission); iOS asks once |
| Location (approximate) | Fill in city and state | When you tap "Use my current location" |
| Notifications | New interests, connections and messages | Once after sign-in (Android 13+, iOS) |
| Calls and SMS | Call or text a revealed number | Opens the phone's dialer / messages app, so no permission is needed |
| Login code from SMS | Fill the OTP automatically | Android shows "Allow 2ndShaadi to read this one message?" (Google SMS User Consent; no SMS permission) |

Settings → App permissions shows each one and opens the phone's settings.

## Build the APK (Windows, PowerShell)

Install Flutter (stable) and Android Studio once. Then:

```powershell
cd D:\2ndshaadi\mobile
flutter pub get
flutter build apk --release --dart-define=API_URL=https://2ndshadi.com
# APK: build\app\outputs\flutter-apk\app-release.apk
```

### Test APK against the API running on your computer

1. Find your computer's Wi-Fi address: `ipconfig` → IPv4 Address, e.g. `192.168.1.5`.
2. Allow port 4000 in Windows Firewall (the API listens on all addresses).
3. Add `cleartext=true` as a new line in `mobile\android\gradle.properties` (allows plain http; test builds only).
4. Build:
   ```powershell
   flutter build apk --release --dart-define=DEV_TOOLS=true --dart-define=API_URL=http://192.168.1.5:4000
   ```
5. Install on a phone on the same Wi-Fi. The address can be changed later: long-press the logo on the welcome screen.

Remove `cleartext=true` before building for the Play Store.

## Play Store / App Store

- Signing: create `mobile\android\key.properties` (see `android/app/build.gradle.kts`) with your upload key. Never commit it.
- `flutter build appbundle --release --dart-define=API_URL=https://2ndshadi.com` for Play.
- iOS needs a Mac: `flutter build ipa --release --dart-define=API_URL=https://2ndshadi.com`.
- Payments: Android uses Razorpay. Apple requires its own in-app purchase for memberships, so the iOS app shows plans but does not sell them (`--dart-define=IOS_PURCHASES=true` turns buying on if you add Apple IAP later). Google Play also expects Play Billing or its "user choice billing" programme for digital memberships in India; enrol before publishing.
- Notifications while the app is fully closed need Firebase Cloud Messaging (add `google-services.json` / `GoogleService-Info.plist` and a server sender). While the app is open or in the background they work already.

## Checks

```powershell
flutter analyze
flutter test
```
