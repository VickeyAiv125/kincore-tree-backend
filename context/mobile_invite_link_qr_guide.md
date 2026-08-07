# Mobile: Family invite link & QR

UAT API: `https://uat.api.kincore.com`  
Share base: `https://uat.kincore.com/join/{CODE}`  
Deep link: `kincore://join/{CODE}`

## APIs

| Action | Method | Path |
|--------|--------|------|
| Get current code (do **not** rotate) | GET | `/api/families/:id/invite` |
| Generate new code (invalidates old QR) | POST | `/api/families/:id/invite` |
| Join | POST | `/api/families/join-link` body `{ "link": "<url or code>" }` |
| Tree after join | GET | `/api/tree/data?family_space_id=...` |

### GET invite response

```json
{
  "invite_code": "FAM-XXXX",
  "family_space_id": "…",
  "family_name": "…",
  "invite_url": "https://uat.kincore.com/join/FAM-XXXX",
  "deep_link": "kincore://join/FAM-XXXX"
}
```

### Join response

- `200` → `{ message, space_id }`
- `409` → already a member
- `404` → invalid code

## Flutter packages

```yaml
dependencies:
  qr_flutter: ^4.1.0
  share_plus: ^10.0.0
  app_links: ^6.3.0
  # plus your existing http / dio / go_router
```

## Copy these files into the app

Reference implementations live under [`mobile/invite/`](../../mobile/invite/) in the monorepo (or copy from this guide’s sibling folder):

- `invite_api.dart` — API client
- `invite_share_screen.dart` — admin share + QR
- `join_link_screen.dart` — paste code / deep-link landing
- `invite_deep_link.dart` — app_links wiring

## Deep link setup

### Android `AndroidManifest.xml`

```xml
<!-- Custom scheme -->
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="kincore" android:host="join" />
</intent-filter>

<!-- HTTPS App Links (optional; verify assetlinks later) -->
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="uat.kincore.com" android:pathPrefix="/join" />
</intent-filter>
```

### iOS `Info.plist`

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>kincore</string></array>
  </dict>
</array>
```

## Flow rules

1. Invite screen uses **GET** `/invite` for display + QR (never rotate on open).
2. Only “Generate new code” calls **POST** `/invite`.
3. On deep link: if logged out, stash code → login → call `join-link`.
4. After join, open `GET /api/tree/data?family_space_id={space_id}`.
