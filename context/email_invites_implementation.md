# Email Invites Implementation - Admin and User Flow
**Date:** June 29, 2026

## Overview
This document outlines the architecture and implementation details for how the Kincore Tree platform handles email invitations for both administrators (Business Admin/DevOps/Auditor) and standard users (Family Members).

## 1. The Core Implementation (Backend)

We rely on **Supabase Auth Admin API** (`supabase.auth.admin.inviteUserByEmail`) to securely generate and dispatch invitation links. 

### What We Implemented:
When an Owner or SuperAdmin adds a member (via the frontend `AddMember` or `EditMember` panels), the backend processes the request in the respective controller (e.g., `familyController.js` or `businessController.js`).

If an `email` is provided for the unregistered person, the system transitions their status to `invitation_pending` and triggers the Supabase API:

```javascript
const { error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { 
        first_name: first_name || 'Member',
        role: pendingRole,
        family_space_id: familyId
    },
    redirectTo: `${process.env.FRONTEND_URL || 'https://kincore-tree.vercel.app'}/accept-invite`
});
```

### Key Features of this Implementation:
- **Redirection Routing:** The `redirectTo` parameter strictly forces the user to land on the `/accept-invite` React route in the frontend when they click the link in their email.
- **Custom User Metadata (The `data` object):** We securely inject `first_name`, `role`, and `family_space_id` into the invitation. This accomplishes two things:
  1. It allows the email template to dynamically render their name and role.
  2. When the user accepts the invite, this data is saved to their `auth.users` raw_user_meta_data, allowing the frontend to know exactly who they are and what space they belong to before they even finish setting their password.

## 2. Production Environment Constraints (SMTP)

During development (localhost), Supabase uses a built-in email proxy to send invites. In production, this behavior changes:
- Supabase enforces strict rate limits (e.g., 3 emails per hour) on the Free Tier.
- Supabase's built-in mailer frequently gets blocked or marked as spam by major providers (Gmail, Yahoo) to prevent abuse.

**Resolution Required:**
To ensure 100% deliverability for production environments, the platform must be configured with a **Custom SMTP Provider** (e.g., Resend, SendGrid, Amazon SES). 
This is done inside the Supabase Dashboard: `Project Settings` -> `Authentication` -> `SMTP Settings`.

## 3. Dynamic Email Templates

Because we are passing `data` metadata in the backend invite call, the email templates inside Supabase can be customized to greet the user and declare their specific administrative or family role.

Inside the **Supabase Dashboard** -> **Authentication** -> **Email Templates** -> **Invite User**, the HTML template can be configured as follows:

```html
<h2>Welcome to Kincore Tree!</h2>
<p>Hello {{ .Data.first_name }},</p>
<p>You have been invited to join the platform. Your assigned role is: <strong>{{ .Data.role }}</strong>.</p>
<p>Please click the link below to accept your invitation and set up your account password:</p>
<p><a href="{{ .ConfirmationURL }}">Accept Invitation</a></p>
```

## 4. The Frontend Acceptance Flow (`/accept-invite`)

When the user clicks the `{{ .ConfirmationURL }}`, Supabase appends a `#access_token=...` hash to the URL and redirects them to `https://kincore-tree.vercel.app/accept-invite`.

1. The frontend parses the token to verify the invite is valid.
2. The user is prompted to set a new password.
3. Upon submission, the frontend calls the Supabase API to update the password.
4. The frontend calls the backend `/auth/complete-invite` endpoint to synchronize the `auth.users` record with our custom `users`, `family_memberships`, and `family_space_staff` RBAC tables.
5. The user is automatically logged in and routed to their respective dashboard based on the role provided in the metadata.
