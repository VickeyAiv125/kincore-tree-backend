# API Integration Blockers & Architecture Questions
**Date:** 2026-06-30

**Subject: Missing APIs, Credentials & Family-Level Filtering Requests**

Hi Team,

Based on our recent findings and the API documentation, we need clarification and credentials on the following items to finalize the Business Admin and Family Admin panels. We have broken this down by Panel and Page.

---

## Part 1: Business Admin Panel

### 1. Governance Page (Ledger & Wallet Controls)
* **Missing Admin Credentials (Blocker):** We need to access `GET /ledger/transactions` and `GET /wallets`. 
  * **Request:** Please provide the production/staging credentials (`client_id`/`client_secret` or email/password) so our backend can generate the `bigk_admin_token` required for these endpoints.

### 2. Mall Page
* **Note on P2P & Governance:** As you mentioned, "P2p mall is never the scope of plenorhub, it belongs to kincore." We have already separated this logic. Furthermore, as instructed, the Rule Templates and Fee Structure will be fully developed and managed by Kincore on our end.
* **Pending Sellers API:** We have integrated the public merchants list, but need an endpoint for pending merchants (Missing from PlenorHub docs Section 2.3).
* **Disputes API:** Need an endpoint for e-commerce buyer/seller disputes.
* **Payout Stats Schema:** Need a sample JSON response for `GET /admin/payouts/stats` to accurately map the frontend KPIs.

---

## Part 2: Family Admin Panel

### 1. KCC Coin Ledger Page
* **Missing Admin Credentials (Blocker):** Just like the Business Admin ledger, we cannot fetch the Family Ledger from BigK without the `bigk_admin_token` credentials.
* **Family-Based Ledger Filtering (BigK):** Currently, BigK's `GET /ledger/transactions` only filters by a single `wallet_id`. 
  * **Question:** How can we fetch the ledger for an entire family without making 50 separate API calls? Will a `family_id` filter be added to this API?

### 2. Mall Page
* **Family-Based Listed Items (PlenorHub):** PlenorHub's `GET /integration/products` only filters by a single `merchant_id`.
  * **Question:** How should we fetch all products listed by a specific family? Will PlenorHub support a `family_id` query parameter for products? 
* **Family Order History (PlenorHub):** PlenorHub only provides `GET /app/orders` for the currently logged-in user. There is no endpoint to fetch orders for a specific family.
  * **Question:** How should the Family Admin view their family's order history? Will PlenorHub provide a new Admin endpoint that supports family-based filtering?
