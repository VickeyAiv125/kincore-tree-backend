# Production OAuth — Hostinger frontend + your API (no Render required)

Live frontend: https://kincore-tree.amritaesolution.in  
Live backend:  https://kincore-api.amritaesolution.in

## 1) Backend env on kincore-api.amritaesolution.in (REQUIRED)

Wherever this Node API is hosted, set:

```
FRONTEND_URL=https://kincore-tree.amritaesolution.in
APP_URL=https://kincore-tree.netlify.app
BACKEND_URL=https://kincore-api.amritaesolution.in
GOOGLE_CLIENT_ID=1019077580250-rcro8um3d73gdr9qm1kirfbsba9dug1g.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://kincore-api.amritaesolution.in/api/auth/google/callback
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
FACEBOOK_REDIRECT_URI=https://kincore-api.amritaesolution.in/api/auth/facebook/callback
```

Restart the API after saving.

### App / Flutter web (browser OAuth redirect back to Netlify)

Start Google sign-in from the app with:

```
GET https://kincore-api.amritaesolution.in/api/auth/google?client_type=app&redirect_to=https://kincore-tree.netlify.app/
```

After Google auth, the callback redirects to Netlify with `?token=...&provider=google` (not the admin `/auth/callback` path).

Set on the API host:

```
APP_URL=https://kincore-tree.netlify.app
```

Verify:
https://kincore-api.amritaesolution.in/api/auth/google/status  
→ `redirect_uri` must be `https://kincore-api.amritaesolution.in/api/auth/google/callback`  
→ NOT localhost and NOT onrender.com

## 2) Google Cloud Console

Authorized JavaScript origins:
```
https://kincore-tree.amritaesolution.in
https://kincore-api.amritaesolution.in
```

Authorized redirect URIs:
```
https://kincore-api.amritaesolution.in/api/auth/google/callback
```

## 3) Meta / Facebook

Valid OAuth Redirect URIs:
```
https://kincore-api.amritaesolution.in/api/auth/facebook/callback
```

## 4) Frontend build (Hostinger)

`.env.production` uses:
```
BACKEND_URL=https://kincore-api.amritaesolution.in
VITE_API_BASE_URL=https://kincore-api.amritaesolution.in/api
FRONTEND_URL=https://kincore-tree.amritaesolution.in
```

Rebuild (`npm run build`) and re-upload `dist/` to Hostinger.
