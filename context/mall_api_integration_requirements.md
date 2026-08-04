# Business Admin Dashboard - API Integration Blockers
**Date:** 2026-06-29

**Subject: Missing APIs & Credentials for Business Admin**

Hi Team,

We are missing the following API contracts and credentials to finalize the Business Admin integration. Please provide them so we can proceed:

**1. Mall Page:**
* **Pending Sellers API:** Need endpoint for list of pending merchants (Missing from PlenorHub docs Section 2.3).
* **Disputes API:** Need endpoint for e-commerce buyer/seller disputes (Not in docs).
* **Payout Stats Schema:** Need a sample JSON response for `GET /admin/payouts/stats` and `GET /payments/refunds/stats` to map the frontend KPIs (BigK docs Section 10).

**2. Governance Page:**
* **Rule Templates API:** Need endpoints to fetch/view Governance Policies (Not in docs).
* **Fee Structure API:** Need endpoints to update P2P Transfer & Mall Transaction fees (Not in docs).
* **KCC ID Service Credentials:** Need an admin service account (email/password or Client ID) with `plenorhub_admin` and `super_admin` scopes to authenticate and fetch the live Ledger and Wallet Controls.
