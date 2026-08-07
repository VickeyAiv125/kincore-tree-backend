# Mobile: Family invite link & QR (API-focused)

Base URL: `https://uat.api.kincore.com`

## Admin — share invite + QR

**GET** `/api/families/{family_space_id}/invite`  
Auth: Bearer token (owner/admin)

Returns:

```json
{
  "invite_code": "DEMO-CHEN",
  "invite_url": "https://uat.kincore.com/join/DEMO-CHEN",
  "deep_link": "kincore://join/DEMO-CHEN",
  "qr_code_data_url": "data:image/png;base64,..."
}
```

- Show `qr_code_data_url` in an `<Image>` / Flutter `Image.memory` after decoding base64  
- Or generate QR client-side from `invite_url`  
- **POST** same path only when regenerating code (invalidates old QR)

## Public — preview invite (no login)

**GET** `/api/families/join-info?code=DEMO-CHEN`

Same shape as above (includes QR). Use on join screen before the form.

## Public — join without prior login

**POST** `/api/families/join`  
**No Authorization header**

```json
{
  "link": "DEMO-CHEN",
  "first_name": "Riya",
  "last_name": "Sharma",
  "email": "riya@example.com",
  "password": "Secret@123",
  "gender": "female"
}
```

`link` may be full URL or raw code. Optional: `phone`, `date_of_birth`.

Creates account if new, or signs in if email already exists (password must match), then adds family membership.

Response `201`/`200`:

```json
{
  "message": "Successfully joined \"…\"",
  "token": "<use as Bearer for later calls>",
  "space_id": "…",
  "family_space_id": "…",
  "family_name": "…",
  "is_new_user": true,
  "already_member": false,
  "user": { }
}
```

Then load tree: **GET** `/api/tree/data?family_space_id={space_id}` with the returned `token`.

## Optional — already logged-in join

**POST** `/api/families/join-link`  
Auth required  
`{ "link": "DEMO-CHEN" }`

## Landing

https://uat.kincore.com/join/{CODE} — form posts to public `/api/families/join`.
