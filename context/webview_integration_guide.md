# Kincore Mobile App WebView Integration Guide
**Target Audience**: React Native, Flutter, iOS (SwiftUI), and Android (Kotlin) App Developers  
**Live Web Domain**: `https://kincore-tree.vercel.app`  
**Purpose**: Embedding interactive **Family Lineage Tree** and **Migration Map** UI components into the mobile application using standalone WebViews.

---

## 📌 Overview
The Kincore Web Dashboard exposes two standalone, responsive canvas UI endpoints specifically optimized for mobile WebView embedding. Neither endpoint renders web administrative navigation headers, sidebars, or menus—they render **only the interactive canvas/map**, allowing them to blend seamlessly into your native mobile app containers.

Both WebViews require two parameters to render family-specific data securely:
1. **`familySpaceId`** (in the URL path): Ensures the UI loads the specific dynasty/space tree or migration points.
2. **`token`** (as a URL query parameter): The authenticated user's JWT access token (`Bearer token`), used by the internal canvas to fetch live backend data.

---

## 🔑 How Mobile App Developers Obtain the JWT Access Token

When a user logs into the Kincore mobile application, they authenticate against the backend API using either standard login or OAuth SSO:

* **Standard Login**: `POST /api/auth/login`
* **OAuth SSO Login**: `POST /api/auth/oauth-login` (with payload header/body `"client_type": "app"`)

### **Authentication Response Example**
Upon successful authentication, the backend returns a JSON response containing the access token and user profile:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjhmM2ExYjJjLTRkNWUtNmY3YS04YjljLTBkMWUyZjNhNGI1YyIsImVtYWlsIjoiam9obkBleGFtcGxlLmNvbSIsImlhdCI6MTcyMDAwMDAwMCwiZXhwIjoxNzIwNjA0ODAwfQ...",
  "user": {
    "id": "8f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
    "email": "john@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "family_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d"
  }
}
```

### **How to Use It in the WebView**
1. **Store Securely**: The mobile application stores the returned `"token"` string securely in local device storage (e.g., `AsyncStorage` / `SecureStore` in React Native, or `flutter_secure_storage` in Flutter).
2. **Append to URL**: When the user opens the Family Tree or Migration Map screen in the app, retrieve the stored token from memory and append it directly to the WebView URL as `?token=YOUR_STORED_JWT_TOKEN`.

---

## 🌲 1. Family Lineage Tree WebView

### **Live Endpoint URL Format**
```http
https://kincore-tree.vercel.app/family-tree/webview/{familySpaceId}?token={user_jwt_token}
```

### **⚡ Concrete Example URL (Ready for Testing)**
```http
https://kincore-tree.vercel.app/family-tree/webview/8f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjhmM2ExYjJjLTRkNWUtNmY3YS04YjljLTBkMWUyZjNhNGI1YyIsImVtYWlsIjoiam9obkBleGFtcGxlLmNvbSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

### **Parameters**
* **`{familySpaceId}`** *(Path Parameter - Required)*: The UUID of the family space (e.g., `8f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c`).
* **`token`** *(Query Parameter - Required)*: The valid user JWT access token obtained during login.

### **Features & Capabilities inside WebView**
* **Dynamic Generation Rows**: Displays generational hierarchy automatically arranged with clean SVG connector lines between parents and children.
* **Pan & Zoom Interactive Canvas**: Users can pinch-to-zoom or drag to explore massive family trees smoothly on touchscreen devices.
* **Master Lineage Indicators**: Displays total generations and member counts at the top center.
* **Member Status Badges**: Shows icons for Living/Deceased, Minors, Private profiles, and Claimed accounts.

---

## 🗺️ 2. Family Migration Map WebView

### **Live Endpoint URL Format**
```http
https://kincore-tree.vercel.app/migration-map/webview/{familySpaceId}?token={user_jwt_token}
```

### **⚡ Concrete Example URL (Ready for Testing)**
```http
https://kincore-tree.vercel.app/migration-map/webview/8f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjhmM2ExYjJjLTRkNWUtNmY3YS04YjljLTBkMWUyZjNhNGI1YyIsImVtYWlsIjoiam9obkBleGFtcGxlLmNvbSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

### **Parameters**
* **`{familySpaceId}`** *(Path Parameter - Required)*: The UUID of the family space whose ancestral journeys should be plotted.
* **`token`** *(Query Parameter - Required)*: The valid user JWT access token obtained during login.

### **Features & Capabilities inside WebView**
* **Interactive SVG World Map**: Visualizes origin (`from_location`) and destination (`to_location`) coordinates with animated journey trajectories.
* **Chronological Timeline**: Lists historical relocation milestones, reasons for migration, and date ranges below the map.
* **Media & Archival Attachments**: Users can tap attached historical documents or pictures directly within the timeline cards.
* **Entity Tagging**: Displays linked branches, persons, and historical chapters associated with each journey point.

---

## 📱 Code Integration Examples

### **React Native (`react-native-webview`)**
```jsx
import React, { useEffect, useState } from 'react';
import { SafeAreaView, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FamilyTreeScreen = ({ route }) => {
  const { familySpaceId } = route.params;
  const [token, setToken] = useState(null);

  useEffect(() => {
    // Retrieve the JWT token stored during mobile login
    const loadToken = async () => {
      const storedToken = await AsyncStorage.getItem('user_jwt_token');
      setToken(storedToken);
    };
    loadToken();
  }, []);

  if (!token) {
    return <ActivityIndicator size="large" color="#F97316" style={styles.loader} />;
  }

  // Build the live Vercel webview URL
  const webviewUrl = `https://kincore-tree.vercel.app/family-tree/webview/${familySpaceId}?token=${token}`;

  return (
    <SafeAreaView style={styles.container}>
      <WebView 
        source={{ uri: webviewUrl }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  webview: { flex: 1 },
  loader: { flex: 1, justifyContent: 'center', alignItems: 'center' }
});

export default FamilyTreeScreen;
```

### **Flutter (`webview_flutter` + `flutter_secure_storage`)**
```dart
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class MigrationMapScreen extends StatefulWidget {
  final String familySpaceId;

  const MigrationMapScreen({Key? key, required this.familySpaceId}) : super(key: key);

  @override
  State<MigrationMapScreen> createState() => _MigrationMapScreenState();
}

class _MigrationMapScreenState extends State<MigrationMapScreen> {
  late WebViewController _controller;
  bool _isLoading = true;
  final _storage = const FlutterSecureStorage();

  @override
  void initState() {
    super.initState();
    _initializeWebView();
  }

  Future<void> _initializeWebView() async {
    // Read JWT token saved during app login
    String? token = await _storage.read(key: 'jwt_token');
    
    final url = 'https://kincore-tree.vercel.app/migration-map/webview/${widget.familySpaceId}?token=$token';
    
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0F172A))
      ..loadRequest(Uri.parse(url));

    setState(() {
      _isLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator(color: Color(0xFFF97316))),
      );
    }
    return Scaffold(
      body: SafeArea(
        child: WebViewWidget(controller: _controller),
      ),
    );
  }
}
```

---

## 🔒 Security & Best Practices for App Devs
1. **Token Refresh**: Ensure the JWT token passed to the WebView is valid and unexpired. If the app refreshes the user's session in the background, reload the WebView URL with the newly issued access token.
2. **Hardware Acceleration**: Enable hardware rendering in your Android/iOS WebView container settings to ensure smooth 60fps pan/zoom performance on large family trees.
3. **No Header Overlaps**: Since the WebViews do not include back buttons or navigation bars, ensure your mobile app wrapper provides its own native back/close header above the WebView container.
