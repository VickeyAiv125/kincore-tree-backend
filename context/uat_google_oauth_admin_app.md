# UAT Google OAuth — Admin + Mobile App only

UAT domains (hyphen):

| Role | URL |
|---|---|
| Admin UI | https://uat-admin.kincore.com |
| API | https://uat-api.kincore.com |

Landing (`uat.kincore.com`) does **not** use Google login.

Both **admin** and **mobile app** use the same backend OAuth flow:

```
Browser → GET /api/auth/google → Google → GET /api/auth/google/callback → redirect with ?token=
```

---

## 1) Google Cloud Console

Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) → your **Web application** OAuth client.

### Authorized redirect URIs

```
https://uat-api.kincore.com/api/auth/google/callback
```

### Authorized JavaScript origins

```
https://uat-admin.kincore.com
https://uat-api.kincore.com
```

Do **not** add `uat.kincore.com` unless landing gets Google later.

Save and wait ~1 minute for Google to propagate.

---

## 2) VPS backend env

Edit `/opt/kincore/backend/.env`:

```env
FRONTEND_URL=https://uat-admin.kincore.com
BACKEND_URL=https://uat-api.kincore.com

GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-secret
GOOGLE_REDIRECT_URI=https://uat-api.kincore.com/api/auth/google/callback
APP_OAUTH_REDIRECT=kincore://auth/callback
# Do NOT set APP_URL=https://uat.app.kincore.com for native APK OAuth (causes browser redirect)
```

Restart:

```bash
pm2 restart kincore-api --update-env
```

Verify:

```bash
curl -sS https://uat-api.kincore.com/api/auth/google/status
```

Expected `redirect_uri`:

```
https://uat-api.kincore.com/api/auth/google/callback
```

---

## 3) Admin (`uat-admin.kincore.com`)

Already wired in the React app:

- **Continue with Google** → `GET https://uat-api.kincore.com/api/auth/google?mode=login`
- After Google → `https://uat-admin.kincore.com/auth/callback?token=...`

Requirements:

1. Admin build uses `VITE_API_BASE_URL=https://uat-api.kincore.com/api`
2. Backend `FRONTEND_URL=https://uat-admin.kincore.com`
3. Google redirect URI registered (step 1)

**Note:** Admin Google is login-oriented — users need an existing admin/invited account unless they use signup flows elsewhere.

Test: open admin → Continue with Google → should land on `/auth/callback` then dashboard.

---

## 4) Mobile app (Flutter) — direct backend OAuth (no Supabase)

Same Google Cloud **Web** client as admin. The app does **not** use Supabase for Google login.

```
GET https://uat-api.kincore.com/api/auth/google
  ?client_type=app
  &redirect_to=kincore://auth/callback
  &mode=login
```

After Google, the API redirects to:

```
kincore://auth/callback?token=...&provider=google
```

The app completes sign-in via `POST /api/auth/oauth-login` with `client_type: 'app'`.

### Platform setup

- **Android package:** `com.example.kincore_app` (see `ApiConfig.appPackageName`)
- **iOS bundle:** `com.example.kincore_app`
- **Deep link:** `kincore://auth/callback` (manifest + Info.plist)
- **No** Supabase redirect URLs for app Google login
- Browser OAuth uses the same **Web** redirect URI as admin (not a separate Android OAuth client unless you add native sign-in later)

Rebuild from branch **`vickey`** and install on device.

### D) Browser flow URL

```
GET https://uat-api.kincore.com/api/auth/google
  ?client_type=app
  &redirect_to=kincore://auth/callback
  &mode=login
```

After Google, the API redirects to:

```
kincore://auth/callback?token=...&provider=google
```

The app completes sign-in via `POST /api/auth/oauth-login`.

### Platform setup

- **Android:** `AndroidManifest.xml` intent filter for `kincore://auth/callback`
- **iOS:** `Info.plist` URL scheme `kincore`

Rebuild and install the app after pulling mobile OAuth changes.

### Test on device

1. Tap **Google** on login screen
2. Browser opens Google account picker
3. App reopens via deep link
4. User lands on choose-space or dashboard

---

## 5) Troubleshooting

| Symptom | Fix |
|---|---|
| `redirect_uri_mismatch` | Google Console redirect URI must match `GOOGLE_REDIRECT_URI` exactly |
| Admin goes to wrong host after Google | Set `FRONTEND_URL=https://uat-admin.kincore.com` and restart PM2 |
| `/api/auth/google/status` shows old dot URL | Update `.env`, restart PM2 |
| App opens browser but never returns | Check deep link intent filter; after fix, rebuild app |
| Native Google fails immediately | Add **Android OAuth client** with package + SHA-1 |
| `Google ID token audience is not allowed` | App `serverClientId` must match `GOOGLE_CLIENT_ID`; add Android client IDs to `GOOGLE_OAUTH_CLIENT_IDS` |
| Browser returns to app but login fails | App must call `POST /auth/oauth-login` with deep-link token (fixed in vickey branch) |
| `Account not found` on admin Google | User needs admin invite or existing admin account |
| App sign-in works but no family space | Expected for new users — choose/create space flow |

---

## Quick test URLs

```bash
# Config probe
curl -sS https://uat-api.kincore.com/api/auth/google/status

# Admin start (should 302 to accounts.google.com)
curl -sI "https://uat-api.kincore.com/api/auth/google?mode=login" | head -5

# App start (should 302 to accounts.google.com)
curl -sI "https://uat-api.kincore.com/api/auth/google?client_type=app&redirect_to=kincore%3A%2F%2Fauth%2Fcallback" | head -5
```
