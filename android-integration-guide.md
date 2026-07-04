# Android integration guide

## WebView setup
- Load the website inside a WebView with Firebase Auth, Firestore, Storage, and notifications enabled.
- Enable JavaScript, DOM storage, cookies, file uploads, geolocation, downloads, and mixed content compatibility.
- Preserve cookies and auth sessions by keeping the WebView tied to the app login flow.

## FCM integration
- Register the Android app for Firebase Cloud Messaging.
- Send the FCM token to Firestore under notificationTokens/{uid}.
- Use the same Cloud Function as the web app to dispatch push notifications.

## Android notification channel
- Create a channel named `munner_trip_channel` with high importance.
- Use heads-up notifications, action buttons, and deep links into chat rooms or the notification center.

## Deep links
- Open the app with a URL like `munnertrip://chat/{roomId}`.
- The app should route to the correct chat room when notification is tapped.
