# Kincore Authentication: Mobile App Authentication API Guide

This document provides the complete technical specifications and integration guide for the **Mobile Application** (React Native / Flutter) development team, covering **OAuth SSO (Google & Facebook)** and **Password Recovery (Forgot / Reset Password)**.

---

## 🛑 Option B Error Handling & Account Recognition (All APIs)

All mobile authentication endpoints implement **Option B** for unregistered emails:
* When a user enters an email address, the API performs a unified lookup across all three Kincore account tables:
  1. `users` (Active registered members)
  2. `admin_users` (Direct admin accounts)
  3. `persons` (Invited members/admins pending registration)
* If an email is **not found** in any of these tables, the API immediately returns a **`404 Not Found`** error.
* This allows mobile applications to display an immediate red toast/warning advising the user to check their spelling or complete sign up.

---

## 🚀 Part 1: OAuth SSO (Google & Facebook Login & Sign Up)

On mobile devices, we support **both Sign Up and Log In** via Google and Facebook:
* **Sign Up:** If a new user logs in with Google/Facebook for the very first time, the Kincore backend automatically creates their account profile.
* **Log In:** If an existing user logs in, the backend identifies their account, resolves their **Kincore Role hierarchy** (`owner`, `admin`, `family-admin`, `branch-admin`, etc.), assigned **Family Spaces**, and updates their login telemetry (`last_login_at`).

To handle both flows seamlessly in a single step, use the dedicated backend endpoint: **`POST /api/auth/oauth-login`**.

### 1.1 Endpoint Specifications
* **URL:** `/api/auth/oauth-login`
* **Method:** `POST`
* **Headers:** `Content-Type: application/json`

#### **Request Payload:**
Pass the Supabase `access_token` (recommended) or their authenticated `email`, with `client_type` set to `"app"`:
```json
{
  "access_token": "<supabase_access_token_from_google_or_facebook>",
  "provider": "google",
  "client_type": "app"
}
```
*Note: `provider` can be `"google"` or `"facebook"`. `client_type: "app"` enables automatic profile creation for new mobile signups.*

#### **Success Response (`200 OK`):**
Returns the complete user session formatted identically to standard email/password login:
```json
{
  "message": "OAuth login successful",
  "token": "eyJhbGciOi...",
  "user": {
    "id": "uuid-here",
    "email": "mobileuser@gmail.com",
    "name": "Mobile User",
    "role": "member",
    "family_id": null,
    "family_name": null,
    "spaces": []
  }
}
```

#### **cURL Command:**
```bash
# Local Testing
curl -X POST http://localhost:5000/api/auth/oauth-login \
  -H "Content-Type: application/json" \
  -d '{"access_token": "YOUR_SUPABASE_ACCESS_TOKEN", "provider": "google", "client_type": "app"}'

# Production Testing
curl -X POST https://your-backend-domain.com/api/auth/oauth-login \
  -H "Content-Type: application/json" \
  -d '{"access_token": "YOUR_SUPABASE_ACCESS_TOKEN", "provider": "google", "client_type": "app"}'
```

### 1.2 Mobile Client Implementation (React Native / Flutter)
#### **Step 1: Initiate OAuth via SDK or Webview**
```javascript
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google', // or 'facebook'
  options: {
    redirectTo: 'kincore://login-callback', // Your app schema deep link
  },
});
```

#### **Step 2: Sync with Kincore Backend**
```javascript
const response = await fetch('https://your-backend-domain.com/api/auth/oauth-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    access_token: session.access_token,
    provider: 'google',
    client_type: 'app'
  })
});

const loginData = await response.json();
if (response.ok) {
  // Store token and user details in secure mobile storage
  await SecureStore.setItemAsync('token', loginData.token);
  await SecureStore.setItemAsync('user', JSON.stringify(loginData.user));
  // Navigate to mobile dashboard
} else {
  console.error('Authentication failed:', loginData.error);
}
```

---

## 📱 Part 2: Password Recovery (Forgot & Reset Password 2-Step Flow)

To ensure maximum security and a seamless user experience on mobile devices without deep-linking issues or browser redirects, mobile password recovery uses an in-app **6-digit numeric OTP code**.

### 2.1 Step 1: Request 6-Digit OTP Code
Sends a 6-digit verification code to the user's email inbox without creating a user or triggering web redirects.

* **URL:** `/api/auth/app/forgot-password`
* **Method:** `POST`
* **Headers:** `Content-Type: application/json`

#### **Request Payload:**
```json
{
  "email": "mobileuser@kincore.com"
}
```

#### **Success Response (`200 OK`):**
```json
{
  "message": "6-digit OTP code sent to your email."
}
```

#### **Error Response (`404 Not Found` - Unregistered Email):**
```json
{
  "error": "No account found with this email address. Please check your spelling or sign up."
}
```

#### **cURL Command:**
```bash
# Local Testing
curl -X POST http://localhost:5000/api/auth/app/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "mobileuser@kincore.com"}'

# Production Testing
curl -X POST https://your-backend-domain.com/api/auth/app/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "mobileuser@kincore.com"}'
```

---

### 2.2 Step 2: Verify OTP & Reset Password In-App
Verifies the 6-digit code received via email and updates the account password in a single atomic call.

* **URL:** `/api/auth/app/reset-password`
* **Method:** `POST`
* **Headers:** `Content-Type: application/json`

#### **Request Payload:**
```json
{
  "email": "mobileuser@kincore.com",
  "otp_code": "123456",
  "new_password": "NewSecurePassword123!"
}
```

#### **Success Response (`200 OK`):**
```json
{
  "message": "Password reset successfully. You can now log in."
}
```

#### **Error Response (`400 Bad Request` - Invalid/Expired OTP):**
```json
{
  "error": "Invalid or expired OTP code."
}
```

#### **cURL Command:**
```bash
# Local Testing
curl -X POST http://localhost:5000/api/auth/app/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "mobileuser@kincore.com",
    "otp_code": "123456",
    "new_password": "NewSecurePassword123!"
  }'

# Production Testing
curl -X POST https://your-backend-domain.com/api/auth/app/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "mobileuser@kincore.com",
    "otp_code": "123456",
    "new_password": "NewSecurePassword123!"
  }'
```

---

## 🛠️ Summary of API Endpoints for Mobile Team
| Flow | Method | Endpoint | Description |
| :--- | :--- | :--- | :--- |
| **OAuth SSO** | `POST` | `/api/auth/oauth-login` | Syncs Google/Facebook login & sign up, returns Kincore session & role hierarchy. |
| **Forgot Password** | `POST` | `/api/auth/app/forgot-password` | Sends a 6-digit OTP to the user's email inbox. |
| **Reset Password** | `POST` | `/api/auth/app/reset-password` | Verifies OTP code and sets the new password in-app. |
