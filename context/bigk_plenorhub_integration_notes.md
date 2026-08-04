# BigK / PlenorHub Integration Notes (confirmed)

## Auth (KCC ID admin login — not client credentials)
- `POST https://auth.bigkpay.com/kccid/v1/login`
- Body: `{ identifier, password, client_id: "bigk_admin" }`
- Returns `access_token` for a real KCC ID user with `super_admin` / `plenorhub_admin`
- Pass as `Authorization: Bearer <token>`

## BigK Admin (KCC Coin / ledger)
- Base: `https://api.bigkpay.com/api/v1`
- Ledger: `GET /ledger/transactions`
- Wallets: `GET /wallets`
- Family Admin ledger: filter/aggregate in **Kincore** via wallet mapping — do **not** push `family_id` into BigK

## PlenorHub Mall (Business Admin)
- Base: `https://api.plenorhub.com/api/v1`
- Merchants: `GET /admin/merchant-applications` (omit status for full list; `status=all` returns empty)
  - `?status=pending|approved|rejected`
  - `GET /admin/merchant-applications/stats`
  - `POST /admin/merchant-applications/{id}/approve` (provisions KCC ID + may return temp credentials)
  - `POST /admin/merchant-applications/{id}/reject`
- Disputes (admin): `GET /admin/disputes`, `GET /admin/disputes/{id}`, `POST /admin/disputes/{id}/arbitrate`
- Payouts: `GET /admin/payouts/stats` → `{ data: { pending_count, completed_count, rejected_count, processing_count, total_requested_usd } }`

## Separation
- PlenorHub = platform mall / merchants
- Family P2P marketplace stays entirely inside Kincore
