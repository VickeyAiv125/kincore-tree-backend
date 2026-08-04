# Mobile App Integration Guide: Global Fees API

This document provides the mobile developer with the backend API endpoint required to fetch global transaction fees configured by the Kincore Business Admin panel.

## 1. Overview & Architectural Clarity
There are three distinct global fees managed by Kincore:
1. **P2P Marketplace & Transfer Fee (`p2p_transfer_fee`)**: Applied to transactions on our internal **P2P Marketplace** (handled entirely by Kincore), as well as direct peer-to-peer KCC transfers between user wallets.
2. **Mall Transaction Fee (`mall_transaction_fee`)**: Applied to checkouts/purchases on the **PlenorHub Mall** (which connects to their platform APIs).
3. **Liquidity Exit Surcharge (`liquidity_exit_fee`)**: Applied when transferring KCC out to an external wallet.

Whenever the Business Admin updates these fees on the web dashboard, this API immediately reflects the live percentages.

---

## 2. When to Call This API (Mobile Workflow)
To ensure the mobile app always displays accurate pricing without hardcoding numbers, call `GET /api/governance/fees` **right before** presenting a checkout or transfer confirmation screen to the user:
1. **Before Kincore P2P Marketplace Purchases**: Call this API when the user proceeds to checkout or confirms a purchase for products on our internal P2P Marketplace. Apply `p2p_transfer_fee` to calculate the total fee deduction **before** submitting the order/purchase API call.
2. **Before PlenorHub Mall Checkout**: Call this API when the user proceeds to checkout for Mall products. Apply `mall_transaction_fee` **before** calling the PlenorHub order placement API.
3. **Before External Wallet Withdrawal**: Call this API when the user initiates a withdrawal. Apply `liquidity_exit_fee` **before** submitting the external transfer request.

---

## 3. Fetch Global Fees API

**Endpoint:** `GET /api/governance/fees`  
**Description:** Returns the live global fee percentages for P2P transfers, Mall checkouts, and external liquidity exits.

### cURL Request
```bash
curl -X GET "http://localhost:5000/api/governance/fees" \
     -H "Content-Type: application/json"
```

### Live Response Data
```json
{
  "p2p_transfer_fee": 2.5,
  "mall_transaction_fee": 1.2,
  "liquidity_exit_fee": 5
}
```

---

## 4. How to Apply in Mobile App
Once fetched, calculate the final deduction on the client before calling the transfer/checkout API.

**Example: P2P Transfer Calculation**
```javascript
// 1. Fetch live fees from Kincore backend right before showing confirmation
const response = await fetch('http://localhost:5000/api/governance/fees');
const fees = await response.json();

const transferAmount = 1000; // KCC

// 2. Calculate percentage fee (e.g., 2.5%)
let calculatedFee = transferAmount * (fees.p2p_transfer_fee / 100);

// 3. Enforce Minimum Charge (if applicable, e.g., min 0.5 KCC)
if (calculatedFee < 0.5) {
    calculatedFee = 0.5;
}

const finalAmountDeducted = transferAmount + calculatedFee;
console.log(`Total KCC to deduct: ${finalAmountDeducted}`);
```
