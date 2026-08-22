#  **PlenorHub Commerce API Guide**

**For: External ecosystem application developers who need to display products and support ordering**

**Version:** 2.2

## **1\) Base URLs**

* PLENORHUB\_API\_BASE\_URL \= https://api.plenorhub.com/api/v1/

* PLENORHUB\_SERVER\_URL \= https://api.plenorhub.com

* KCC\_ID\_BASE\_URL \= https://auth.bigkpay.com

All endpoint paths below are relative to PLENORHUB\_API\_BASE\_URL unless stated otherwise.

## **2\) API Families**

PlenorHub exposes multiple API families, each serving a different type of client.

### **2.1 Public Catalog for Display-Only Integrations**

These endpoints support product, merchant, and category browsing without user authentication.

* /integration/products

* /integration/products/{productId}

* /integration/merchants

* /integration/merchants/{merchantId}

* /integration/categories

### **2.2 Wallet-Authenticated Commerce APIs**

These endpoints support signed-in user flows for wishlist, cart, checkout, and order history.

* /app/wishlist/\*

* /app/cart/\*

* /app/\*

* /checkout/\*

* /kmall/merchant/access

### **2.3 Merchant APIs**

Merchant management, merchant portal, imports, exports, payouts, and merchant settings live on a separate merchant-scoped surface and are not covered by this guide.

## **3\) Authentication**

### **3.1 When Authentication is Required**

* /integration/\* does not require authentication

* /app/\*, /checkout/\*, and /kmall/merchant/access do require authentication

### **3.2 Bearer Token Headers**

For authenticated requests, send:

* Authorization: Bearer \<access\_token\>

* Accept: application/json

* Content-Type: application/json

### **3.3 Token Issuer**

Tokens are issued by KCC ID.

These are the KCC ID endpoints currently used in production:

* POST {KCC\_ID\_BASE\_URL}/kccid/v1/authorize

* POST {KCC\_ID\_BASE\_URL}/kccid/v1/token

* POST {KCC\_ID\_BASE\_URL}/kccid/v1/login

### **3.3a Login Request Body (/kccid/v1/login)**

The password-based login endpoint requires the following JSON body:

{  
  "identifier": "user@example.com",  
  "password": "example-password",  
  "client\_id": "bigk\_wallet",  
  "scope": "commerce wallet"  
}

| Field | Type | Required | Notes |
| :---- | :---- | :---- | :---- |
| identifier | string | yes | The user’s email address |
| password | string | yes | The user’s password |
| client\_id | string | yes | OAuth client identifier — see table below |
| scope | string | recommended | Space-delimited scope string |

**client\_id values:**

| Client | client\_id | Typical scope |
| :---- | :---- | :---- |
| Wallet / app users (BigK consumer app) | bigk\_wallet | commerce wallet |
| Merchant portal users | bigk\_merchant | openid profile email |

The login response includes access\_token, id\_token, refresh\_token, token\_type, expires\_in, and scope.

### **3.4 Token Type, Expiry, and Refresh**

* Tokens issued by KCC ID are JWT access tokens.

* The token should be treated as opaque in client code; business meaning should not be inferred from claims.

* Access tokens expire after 60 minutes (expires\_in: 3600).

* Refresh tokens are supported. POST {KCC\_ID\_BASE\_URL}/kccid/v1/token with grant\_type=refresh\_token and the current refresh\_token value returns a new access token.

* Refresh tokens expire after 30 days of non-use.

* **Token Versioning:** KCC ID issues tokens with a token\_version claim. If a user’s password is changed or 2FA is modified, the global token version increments. Tokens with older versions will be rejected with 401 Unauthorized.

* **2FA:** For some clients (e.g. BigK Wallet), KCC ID login endpoints may return 2fa\_enrollment\_required or 2fa\_required. Clients must intercept these responses and initiate TOTP authentication.

Example token response from /kccid/v1/token:

{  
  "access\_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",  
  "token\_type": "Bearer",  
  "expires\_in": 3600,  
  "refresh\_token": "def502004b...",  
  "scope": "commerce wallet"  
}

### **3.5 Required Scopes**

The following scopes are required for commerce API access:

* commerce — required for wishlist, cart, checkout, and order endpoints

* wallet — required for KCC direct order placement and KCC discount application

If a token is missing required scopes, PlenorHub returns 403.

When using the PKCE flow (/kccid/v1/authorize), include scope=commerce wallet in the authorization request.

### **3.6 Integration Guidance**

* Access tokens should be treated as opaque and sent to PlenorHub as issued.

* JWT claims should not be parsed in client code to infer business state.

* Token refresh should be implemented before expiry, for example when fewer than 5 minutes remain.

* The preferred production auth flow should be confirmed with the platform owner for the relevant app type.

### **3.7 What “Wallet-Scoped Token” Means**

Wishlist, cart, checkout, and customer order endpoints require a token that resolves to a valid wallet context inside PlenorHub.

If a token is valid but cannot be resolved to a wallet-enabled commerce user, PlenorHub may return 403.

## **4\) Integration Conventions**

### **4.1 Canonical Request Field Names**

The following field names are the preferred canonical form for new integrations:

* quantity

* shipping\_address

  * shipping\_address.state

  * shipping\_address.postal\_code

  * recipient\_name

  * recipient\_phone

**Important:** This section describes the preferred client-side shape. Some live endpoints still validate or return older field names such as name, phone, province, and zip. The endpoint notes below call out those differences where they matter.

### **4.2 Compatibility Aliases**

Some older routes and flows still accept or return legacy names. Legacy names that may still appear include:

* qty

* province

* zip

* flattened address fields instead of a nested shipping\_address object

New integrations should use the preferred names above.

### **4.3 Money and Currency Rules**

PlenorHub commerce evaluates fiat prices cross-currency using exchange rates updated hourly from live market data (e.g., European Central Bank).

* fiat\_price: The raw, exact fiat value configured by the merchant.

* merchant\_currency: The merchant’s native settlement/reference currency (derived strictly from merchant.base\_currency).

* price / display\_price.display.amount: The dynamically converted price in the buyer’s requested currency (e.g., USD), calculated live using the latest hourly exchange rates.

* KCC discount calculations are pegged to USD-based discount logic internally.

### **4.4 Timestamps**

When timestamps are returned, they are ISO-8601 strings.

### **4.5 Pagination**

Most paginated endpoints return:

{  
  "meta": {  
    "current\_page": 1,  
    "per\_page": 20,  
    "total": 100,  
    "last\_page": 5  
  }  
}

Standard query parameters for list endpoints:

| Parameter | Type | Default | Notes |
| :---- | :---- | :---- | :---- |
| page | integer | 1 | Page number |
| per\_page | integer | 20 | Items per page |
| sort | string | created\_at | Field to sort by (not supported on all endpoints) |
| order | string | desc | Sort direction: asc or desc |
| search | string | — | Full-text search (supported where noted) |

The public /integration/\* catalog family may also include page for compatibility.

**Category filter note:** The category query parameter on /app/products currently performs a direct equality match against the product category name string. It is not a category\_id filter and should not be treated as a slug-based filter unless the backend is updated to support that explicitly.

## **5\) Public Catalog APIs**

These endpoints are intended for display-only third-party integrations.

### **5.1 List Products**

* **GET** /integration/products

Query parameters:

* per\_page optional, default 20

Example response:

{  
  "data": \[  
    {  
      "id": 123,  
      "name": "Product name",  
      "description": "...",  
      "price": 99.5,  
      "currency": "KCC",  
      "image\_url": "https://...",  
      "images": \["/storage/products/a.jpg"\],  
      "category": "Category",  
      "category\_id": 5,  
      "stock": 10,  
      "in\_stock": **true**,  
      "merchant": {  
        "id": 77,  
        "name": "Merchant name",  
        "slug": "merchant-slug",  
        "cashback\_rate": 5  
      }  
    }  
  \],  
  "meta": {  
    "total": 100,  
    "page": 1,  
    "per\_page": 20,  
    "last\_page": 5  
  }  
}

### **5.2 Get Product Details**

* **GET** /integration/products/{productId}

Possible errors:

* 404 if the product does not exist or is not available in the public catalog

### **5.3 List Merchants**

* **GET** /integration/merchants

Query parameters:

* per\_page optional, default 20

Example response:

{  
  "data": \[  
    {  
      "id": 77,  
      "name": "Merchant Name",  
      "slug": "merchant-slug",  
      "description": "Short description",  
      "logo\_url": "https://...",  
      "banner\_url": "https://...",  
      "category": "Electronics",  
      "cashback\_rate": "3.00",  
      "product\_count": 5  
    }  
  \],  
  "meta": {  
    "total": 10,  
    "page": 1,  
    "per\_page": 20  
  }  
}

**Note:** This endpoint returns banner\_url, category, and product\_count. It does not include an is\_active field (only active merchants are returned). The meta shape uses page (not current\_page) and omits last\_page.

### **5.4 Get Merchant Details**

* **GET** /integration/merchants/{merchantId}

Returns merchant details plus up to 50 active products.

Example response:

{  
  "data": {  
    "id": 77,  
    "name": "Merchant Name",  
    "slug": "merchant-slug",  
    "description": "Short description",  
    "logo\_url": "https://...",  
    "banner\_url": "https://...",  
    "category": "Electronics",  
    "cashback\_rate": "3.00",  
    "products": \[  
      {  
        "id": 123,  
        "name": "Product Name",  
        "price": "99.50",  
        "image\_url": "https://...",  
        "stock": 10  
      }  
    \]  
  }  
}

**Note:** Product objects in this response include price and stock (not in\_stock or currency). Only active products are returned.

### **5.5 List Categories**

* **GET** /integration/categories

Example response:

{  
  "data": \[  
    {  
      "id": 5,  
      "name": "Electronics",  
      "slug": "electronics"  
    }  
  \]  
}

## **6\) Wallet-Authenticated Catalog APIs**

These endpoints support authenticated K-Mall browsing.

### **6.1 List Merchants**

* **GET** /app/merchants

Query parameters:

* search optional

### **6.2 Merchant Details**

* **GET** /app/merchants/{merchantId}

### **6.3 List Categories**

* **GET** /app/categories

### **6.4 List Products**

* **GET** /app/products

Query parameters:

* merchant\_id optional

* category optional

* search optional

* page optional

### **6.5 Get Product Details**

* **GET** /app/products/{productId}

Product responses in this family are richer than the public /integration/\* family. Example response:

{  
  "data": {  
    "id": 123,  
    "external\_id": "gid://shopify/Product/...",  
    "name": "Product Name",  
    "description": "Full product description",  
    "price": 150.0,  
    "token\_price": **null**,  
    "fiat\_price": 150.0,  
    "fiat\_currency": "USD",  
    "price\_currency": "USD",  
    "display\_price": {  
      "original": {  
        "amount": 150.0,  
        "currency": "USD",  
        "formatted": "$150.00"  
      },  
      "display": {  
        "amount": 150.0,  
        "currency": "USD",  
        "formatted": "$150.00",  
        "is\_converted": **false**  
      }  
    },  
    "merchant\_price": 150.0,  
    "merchant\_currency": "USD",  
    "category": "Electronics",  
    "product\_type": "standard",  
    "inventory": 50,  
    "sku": **null**,  
    "status": "live",  
    "image\_url": "https://...",  
    "images": \[  
      {"url": "https://...", "type": "image"}  
    \],  
    "variants": \[  
      {  
        "id": 10,  
        "name": "Large / Red",  
        "sku": "LRG-RED",  
        "price\_adjustment": 0.0,  
        "stock": 5,  
        "attributes": {"size": "Large", "color": "Red"},  
        "is\_active": **true**  
      }  
    \],  
    "merchant": {  
      "id": 77,  
      "name": "Merchant Name",  
      "logo\_url": "https://...",  
      "type": "type\_1",  
      "base\_currency": "USD"  
    }  
  }  
}

**Key schema notes:** \- price and display\_price.display.amount represent the dynamically converted value (e.g., USD) using hourly-updated exchange rates against the merchant\_currency. \- display\_price is a nested object with original and display sub-objects — not a scalar. \- inventory is the stock count field (not stock). \- There is no top-level in\_stock boolean or has\_variants flag — derive these from inventory \> 0 and variants.length \> 0. \- Variant objects use price\_adjustment (the delta from base price) and attributes (key/value object) — not price, fiat\_price, in\_stock, or options. \- images is an array of {url, type} objects — not plain URL strings.

**Variant rules:** Stock is tracked per variant when a product has active variants. Derive variant availability from variants\[\].is\_active \=== true and variants\[\].stock \> 0. When a product has active variants, a valid variant\_id is required for cart, pricing, checkout, and order operations.

### **6.6 Pricing Preview**

* **POST** /app/pricing/preview

Preferred request body:

{  
  "items": \[  
    {  
      "product\_id": 123,  
      "quantity": 2,  
      "variant\_id": 10,  
      "options": {"color": "red"}  
    }  
  \]  
}

Important behavior:

* all items should belong to the same merchant

* if a product has variants, a valid variant\_id is required

* stock is validated during preview

Response example:

{  
  "data": {  
    "items": \[  
      {  
        "product\_id": 123,  
        "name": "Product name",  
        "unit\_price": 150,  
        "quantity": 1,  
        "line\_total": 150,  
        "variant\_id": **null**,  
        "variant\_name": **null**,  
        "options": **null**  
      }  
    \],  
    "subtotal": 150,  
    "discounts": \[\],  
    "total\_discount": 0,  
    "final\_total": 150,  
    "currency": "KCC"  
  }  
}

**Note:** Each item contains only quantity — the legacy qty alias is no longer emitted in the response.

## **7\) Wishlist APIs**

### **7.1 List Wishlist**

* **GET** /app/wishlist

Query parameters:

* per\_page optional, default 20

### **7.2 Add Item to Wishlist**

* **POST** /app/wishlist

{ "product\_id": 123 }

Responses:

* 201 created

* 409 already in wishlist

### **7.3 Toggle Wishlist Item**

* **POST** /app/wishlist/toggle

{ "product\_id": 123 }

### **7.4 Remove Wishlist Item**

* **DELETE** /app/wishlist/{id}

### **7.5 Check Wishlist State**

* **GET** /app/wishlist/check/{productId}

## **8\) Cart APIs**

### **8.1 Get Cart**

* **GET** /app/cart

Example response:

{  
  "data": {  
    "id": 2,  
    "item\_count": 1,  
    "total": 150,  
    "items": \[  
      {  
        "id": 55,  
        "product\_id": 123,  
        "product": {  
          "id": 123,  
          "name": "Product Name",  
          "price": 150.0,  
          "image\_url": "https://..."  
        },  
        "variant\_id": **null**,  
        "variant": **null**,  
        "quantity": 1,  
        "subtotal": 150.0,  
        "options": **null**  
      }  
    \]  
  }  
}

**Schema notes:** \- The cart object includes a top-level id and item\_count (total quantity across all cart items). \- Each item has a nested product object with basic fields; currency, merchant\_id, and in\_stock are not included at the item level. \- subtotal on each item is the line total (unit price × quantity).

### **8.2 Get Cart Count**

* **GET** /app/cart/count

Example response:

{ "count": 3 }

### **8.3 Add Item**

* **POST** /app/cart/items

Preferred request body:

{  
  "product\_id": 123,  
  "quantity": 2,  
  "variant\_id": 10,  
  "options": {"color": "red"}  
}

### **8.4 Update Quantity**

* **PUT** /app/cart/items/{itemId}

{ "quantity": 1 }

If quantity is set to 0, the item is removed.

### **8.5 Remove Item**

* **DELETE** /app/cart/items/{itemId}

### **8.6 Clear Cart**

* **DELETE** /app/cart

### **8.7 Cart Merchant Constraint**

Partners should treat cart and checkout as single-merchant flows.

Do not assume a multi-merchant cart can be checked out in a single session.

## **9\) Checkout APIs (Stripe / fiat)**

These endpoints support card/fiat checkout through Stripe.

### **9.1 Shipping Rates**

* **POST** /checkout/shipping-rates

Actual request body accepted today (live validator requires **name** and **zip**, not only recipient_name / postal_code). Send both names:

```json
{
  "merchant_id": 77,
  "items": [
    { "product_id": 123, "quantity": 2 }
  ],
  "shipping_address": {
    "name": "Jane Doe",
    "address": "123 Street",
    "city": "Kuala Lumpur",
    "state": "WP Kuala Lumpur",
    "zip": "50000",
    "recipient_name": "Jane Doe",
    "recipient_phone": "+60123456789",
    "postal_code": "50000",
    "country": "MY"
  }
}
```

Required by live API: `shipping_address.name`, `address`, `city`, `state`, `zip`.

Optional aliases: `recipient_name`, `recipient_phone`, `postal_code`.

Shipping response values are returned in the buyer display/payment currency when conversion is needed.

### **9.2 Preview Order Totals**

* **POST** /checkout/preview

Supports either:

* items\[\] cart-style mode

* single-item compatibility mode using product\_id and quantity

Preferred request body:

{  
  "items": \[  
    {"product\_id": 123, "quantity": 2, "variant\_id": 10}  
  \],  
  "shipping\_option\_id": 5,  
  "apply\_kcc\_discount": **true**,  
  "kcc\_amount": 100  
}

The response includes:

* buyer/payment-side totals

* merchant-side totals

* FX metadata

* KCC discount eligibility details

**Important:** This endpoint requires the authenticated user to have a linked BigK wallet. If PlenorHub cannot resolve that wallet, the server returns 404 Wallet not found. The token is expected to be issued for the bigk\_wallet client, and the user account must already have an active wallet on the BigK side.

Example response:

{  
  "data": {  
    "subtotal": 150.0,  
    "shipping\_fee": 5.0,  
    "discount\_usd\_amount": 0,  
    "discount\_kcc\_amount": 0,  
    "total": 155.0,  
    "currency": "USD",  
    "merchant\_subtotal": 150.0,  
    "merchant\_shipping": 5.0,  
    "merchant\_total": 155.0,  
    "merchant\_currency": "USD",  
    "fx\_rate": **null**,  
    "fx\_source": **null**,  
    "can\_apply\_discount": **false**,  
    "discount\_details": {}  
  }  
}

### **9.3 Create Checkout Session**

* **POST** /checkout/create-session

Required:

* items\[\] or product\_id plus quantity

* shipping\_address

* shipping\_rate

* success\_url

* cancel\_url

Example:

{  
  "items": \[  
    {"product\_id": 123, "quantity": 2, "variant\_id": 10}  
  \],  
  "shipping\_address": {  
    "recipient\_name": "Jane Doe",  
    "recipient\_phone": "+60123456789",  
    "address": "123 Street",  
    "city": "Kuala Lumpur",  
    "state": "WP Kuala Lumpur",  
    "postal\_code": "50000",  
    "country": "MY"  
  },  
  "shipping\_rate": {  
    "id": "rate\_abc",  
    "amount": 10.0,  
    "shipping\_option\_id": 5,  
    "is\_live\_rate": **false**  
  },  
  "apply\_kcc\_discount": **true**,  
  "kcc\_amount": 100,  
  "success\_url": "https://app.example.com/checkout/success",  
  "cancel\_url": "https://app.example.com/checkout/cancel"  
}

Response:

{  
  "session\_id": "cs\_test\_...",  
  "checkout\_url": "https://checkout.stripe.com/..."  
}

### **9.4 Verify Payment**

* **GET** /checkout/verify/{sessionId}

Example response:

{  
  "status": "paid",  
  "order\_number": "PH-123456",  
  "state": "confirmed"  
}

### **9.5 Retry Guidance**

The current backend does not advertise a server-enforced Idempotency-Key contract for checkout creation or KCC direct orders.

Recommended behavior:

* prevent duplicate taps/submissions client-side

* do not blindly retry POST /checkout/create-session after a network timeout

* strong deduplication requirements should be handled by backend orchestration with request correlation rules.

### **9.6 Shipping Semantics**

shipping\_rate may include:

* id required — a PlenorHub-generated shipping rate identifier returned by /checkout/shipping-rates

* amount required

* shipping\_option\_id optional — present for merchant-configured fixed shipping options

* is\_live\_rate optional — true when the rate was verified against an external carrier at quote time

**Quote validity:** Treat shipping quotes as advisory and valid for the current session only. Fetch rates again right before calling /checkout/create-session. Do not cache or reuse a rate across separate checkout attempts.

**Rate source:** id values are generated by PlenorHub, not by an external carrier. Pass the full shipping\_rate object from the rates response into session creation unchanged.

### **9.6 Currency Semantics for Checkout**

Stripe checkout uses buyer/payment currency for charge display and session creation.

PlenorHub also stores merchant-side totals for settlement/reference.

### **9.7 KCC Discount Semantics**

KCC discount eligibility is controlled by platform settings and product-level discount support.

Today, that means:

* KCC discount logic is pegged using kcc\_per\_usd

* the platform enforces a minimum Stripe charge

* the maximum usable discount is limited by:

  * wallet balance

  * max discount percent

  * minimum Stripe charge floor

* products may disallow KCC discount entirely

## **10\) Orders APIs (KCC direct)**

### **10.1 Place Order from KCC Balance**

* **POST** /app/orders

Actual request body accepted today:

{  
  "items": \[  
    {  
      "product\_id": 123,  
      "quantity": 2,  
      "variant\_id": 10,  
      "options": {"color": "red"}  
    }  
  \],  
  "recipient\_name": "Jane Doe",  
  "recipient\_phone": "+60123456789",  
  "shipping\_address": "123 Street",  
  "city": "Kuala Lumpur",  
  "province": "WP Kuala Lumpur",  
  "postal\_code": "50000"  
}

This route currently accepts flattened shipping fields rather than a nested shipping\_address object.

Things to keep in mind:

* all items must be from the same merchant

* stock is checked at order placement

* if the product has active variants, a valid variant\_id is required

* payment is taken from the wallet balance immediately

### **10.2 List My Orders**

* **GET** /app/orders

Query parameters:

* page optional

* per\_page optional, default 20

Example response:

{  
  "data": \[  
    {  
      "id": 88,  
      "order\_number": "PH-000088",  
      "state": "confirmed",  
      "total": 199.0,  
      "currency": "KCC",  
      "created\_at": "2026-03-25T10:00:00Z"  
    }  
  \],  
  "meta": {  
    "current\_page": 1,  
    "per\_page": 20,  
    "total": 3,  
    "last\_page": 1  
  }  
}

### **10.3 Get One Order**

* **GET** /app/orders/{orderId}

Example response:

{  
  "data": {  
    "id": 88,  
    "order\_number": "KCC260314F30D",  
    "state": "confirmed",  
    "total": 72.79,  
    "currency": "USD",  
    "channel": "type\_1\_app",  
    "placed\_at": "2026-03-14T04:04:16+00:00",  
    "merchant\_amount": 500.0,  
    "merchant\_currency": "CNY",  
    "display\_amount": 72.79,  
    "display\_currency": "USD",  
    "fx\_rate": 0.145582,  
    "fx\_source": **null**,  
    "can\_apply\_discount": **false**,  
    "discount\_details": {}  
  }  
}

**Schema notes:** \- The placed\_at timestamp replaces created\_at. \- A channel field indicates the order source (e.g. type\_1\_app). \- A top-level merchant object (id, name) is included. \- A customer object (name, handle, email, phone) is included.

Legacy aliases such as top-level status are no longer emitted in canonical order or shipment payloads. Clients should read lifecycle state from state.

### **10.4 Order State Guidance**

For client display, treat these as the main lifecycle concepts:

* pending

* confirmed

* processing

* dispatched

* delivered

* cancelled

* refunded

## **11\) Merchant Access Check**

* **GET** /kmall/merchant/access

This endpoint returns whether the authenticated user has merchant access and which merchant links exist.

Related wallet-app merchant application routes:

* GET /app/merchant-applications/me

* POST /app/merchant-applications

## **12\) Standard Schemas**

### **12.1 Address Object**

Preferred client-side shape:

{  
  "recipient\_name": "Jane Doe",  
  "recipient\_phone": "+60123456789",  
  "address": "123 Street",  
  "city": "Kuala Lumpur",  
  "state": "WP Kuala Lumpur",  
  "postal\_code": "50000",  
  "country": "MY"  
}

### **12.2 Error Object**

Suggested client handling target:

\`\`json {   "message": "Validation failed",   "code": "VALIDATION\_ERROR",   "errors": {     "shipping\_address.state": \["The shipping\_address.state field is required."\]   } } 4\. For KCC direct purchase, callPOST /app/orders5\. For card/fiat purchase, use/checkout/shipping-rates,/checkout/preview,/checkout/create-session, and/checkout/verify/{sessionId}\`

## **16\) Partner implementation notes**

* Use decimal-safe handling for money values

* Do not assume one endpoint family uses the same response shape as another

* Do not assume /app/\* means anonymous access

* Treat preview totals as provisional until checkout completion is confirmed

* Prefer server-side checkout/session orchestration for partner applications where possible

**Document owner:** Munene|