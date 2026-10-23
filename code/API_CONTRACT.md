# FraudShield – API Contract

**Read this before writing code.** Frontend (Manish), backend (Aakarshan) and ML (Dev) must all follow these exact names and formats. If something needs to change, tell the other two first and update this file.

---

## 0. Basics

| Thing | Value |
|---|---|
| Backend base URL | `http://localhost:4000` |
| ML service base URL | `http://localhost:8000` |
| Frontend | `http://localhost:5173` (Vite) – set `VITE_API_URL=http://localhost:4000` |
| Format | JSON everywhere |
| Dates/times | ISO-8601 with IST offset, e.g. `2026-03-04T14:05:00+05:30` |
| Money | number with 2 decimals, e.g. `15000.00` (backend stores as Decimal) |
| Card numbers | never sent anywhere; only `last4` or `masked_number` like `XXXXXXXXXXXX1234` |

### Auth

- **Users (frontend):** `POST /api/auth/login` returns a JWT. Send it on every call:
  `Authorization: Bearer <token>`
- **Gateway (system):** only `POST /api/v1/authorisations`, with header
  `x-api-key: <GATEWAY_API_KEY from .env>`

### Roles

`CARDHOLDER` · `ANALYST` · `MANAGER`

### Demo logins (created by the seed script)

| Username | Password | Role |
|---|---|---|
| `analyst1`, `analyst2` | `demo123` | ANALYST |
| `manager1`, `manager2` | `demo123` | MANAGER |
| any `username` from customers.csv | `demo123` | CARDHOLDER |

Two analysts and two managers exist so maker-checker can be demoed.

### Error format (all errors)

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid input", "fields": { "amount": "must be > 0" } } }
```

| HTTP | code | When |
|---|---|---|
| 400 / 422 | `VALIDATION_ERROR` | bad input (`fields` lists the problems) |
| 401 | `UNAUTHORIZED` | no/invalid token or API key |
| 403 | `FORBIDDEN` | wrong role, someone else's data, same maker and checker |
| 404 | `NOT_FOUND` | id doesn't exist |
| 409 | `CONFLICT` | alert already claimed / already changed by someone else |

---

## 1. Status values (use exactly these strings)

| Thing | Values |
|---|---|
| Transaction `status` | `RECEIVED`, `STEP_UP_PENDING`, `APPROVED`, `BLOCKED` |
| `decision` / `final_decision` | `APPROVE`, `STEP_UP`, `BLOCK` |
| Alert `status` | `OPEN`, `IN_REVIEW`, `PENDING_MANAGER_APPROVAL`, `CONFIRMED_FRAUD`, `FALSE_POSITIVE` |
| Alert `priority` | `HIGH`, `MEDIUM` |
| Card `card_status` | `ACTIVE`, `BLOCKED`, `EXPIRED` |
| `model_status` | `OK`, `MODEL_UNAVAILABLE` |
| `channel` | `POS`, `ECOM`, `ATM`, `CONTACTLESS` |

### Reason codes → message the cardholder sees

Analysts and managers see the codes. Cardholders see only the neutral message.

| Code | Cardholder message |
|---|---|
| `CARD_NOT_ACTIVE` | Your card is not active. |
| `INTL_NOT_ENABLED` | International payments are not enabled on this card. |
| `DAILY_LIMIT_EXCEEDED` | This payment is above your daily limit. |
| `MERCHANT_BLACKLISTED`, `VELOCITY_BURST`, `IMPOSSIBLE_TRAVEL`, `MULTIPLE_RED_FLAGS`, `HIGH_FRAUD_SCORE_MODEL` | This payment was declined for your safety. |
| `HIGH_VELOCITY`, `AMOUNT_SPIKE`, `HIGH_RISK_GEO`, `HIGH_RISK_MCC`, `ODD_HOUR_HIGH_VALUE`, `NEW_MERCHANT_HIGH_VALUE` (when STEP_UP) | We need to confirm this payment with you. |
| `STEP_UP_DENIED` | You told us this wasn't you. The card has been blocked. |
| `STEP_UP_TIMEOUT` | We didn't hear back in time, so the payment was declined. |
| (none, APPROVED) | Payment approved. |

The backend sends this text in a `message` field; the frontend just shows it.

---

## 2. Gateway API (backend owns, no frontend)

### `POST /api/v1/authorisations`

Header: `x-api-key`

**Request**
```json
{
  "txn_id": "T200000007",
  "card_id": "C1007",
  "txn_ts": "2026-03-04T14:05:00+05:30",
  "amount": 15000.00,
  "currency": "INR",
  "merchant_id": "M00451",
  "mcc": "5732",
  "channel": "ECOM",
  "txn_city": "Mumbai",
  "txn_country": "IN"
}
```

Validation: `txn_id` matches `^T[0-9]{9}$`; amount > 0 and ≤ 1000000; currency `INR` only; mcc 4 digits; channel one of the 4; city must exist in cities.

**Response 200**
```json
{
  "txn_id": "T200000007",
  "decision": "STEP_UP",
  "final_decision": "STEP_UP",
  "reason_codes": ["AMOUNT_SPIKE"],
  "rule_risk_score": 30,
  "status": "STEP_UP_PENDING",
  "alert_id": null,
  "processed_at": "2026-03-04T14:05:00.112+05:30",
  "fraud_score": 0.4120,
  "top_factors": ["amount 6.3x the card's 30-day average", "online payment", "electronics merchant"],
  "model_status": "OK"
}
```

- `decision` = rules only. `final_decision` = after AI.
- Same `txn_id` sent again → same response, nothing new created.

---

## 3. Auth (all roles)

### `POST /api/auth/login`
Request `{ "username": "analyst1", "password": "demo123" }`
Response
```json
{ "token": "eyJ...", "user": { "user_id": "U_A1", "username": "analyst1", "role": "ANALYST", "customer_id": null, "display_name": "Analyst One" } }
```

### `GET /api/auth/me`
Response: the same `user` object.

Frontend: after login, route by `role` → `/cardholder`, `/analyst`, `/manager`.

---

## 4. Cardholder APIs (role CARDHOLDER, own data only)

### `GET /api/me/cards`
```json
[
  { "card_id": "C1007", "masked_number": "XXXXXXXXXXXX4821", "card_type": "DEBIT", "card_status": "ACTIVE",
    "expiry_date": "2029-12-31", "daily_limit": 100000.00, "international_enabled": false }
]
```

### `GET /api/me/transactions?card_id=C1007&limit=50`
Newest first.
```json
[
  { "txn_id": "T200000007", "card_id": "C1007", "txn_ts": "2026-03-04T14:05:00+05:30", "amount": 15000.00,
    "merchant_name": "Bluebird Electronics Online", "channel": "ECOM", "txn_city": "Mumbai",
    "status": "STEP_UP_PENDING", "message": "We need to confirm this payment with you." }
]
```
No reason codes, scores or rules here.

### `GET /api/me/stepups/pending`
```json
[
  { "txn_id": "T200000007", "card_id": "C1007", "amount": 15000.00, "merchant_name": "Bluebird Electronics Online",
    "txn_ts": "2026-03-04T14:05:00+05:30", "expires_at": "2026-03-04T14:20:00+05:30" }
]
```
Frontend polls this every 5 seconds and shows the "Was this you?" popup.

### `POST /api/me/stepups/:txn_id/respond`
Request
```json
{ "response": "CONFIRM", "otp": "482913" }
```
or `{ "response": "NOT_ME" }` (no OTP needed).

Response
```json
{ "txn_id": "T200000007", "status": "APPROVED", "message": "Payment approved." }
```
- Wrong OTP → 422 `{ "error": { "code": "VALIDATION_ERROR", "message": "Incorrect OTP", "fields": { "otp": "incorrect" } } }`
- Expired → 409, message "This request has expired."
- The OTP is printed in the backend console log (no SMS).

### `POST /api/me/cards/:card_id/block`
Request `{}` → Response `{ "card_id": "C1007", "card_status": "BLOCKED" }`

---

## 5. Analyst APIs (role ANALYST; MANAGER can also read)

### `GET /api/alerts?status=OPEN,IN_REVIEW&priority=HIGH`
Both filters optional. Sorted: HIGH first, then `sla_due_at` earliest first.
```json
[
  { "alert_id": 15, "txn_id": "T200000005", "priority": "HIGH", "status": "OPEN",
    "created_at": "2026-03-04T14:05:00+05:30", "sla_due_at": "2026-03-04T14:35:00+05:30", "sla_breached": false,
    "amount": 4000.00, "card_id": "C1005", "card_last4": "1234", "merchant_name": "…",
    "reason_codes": ["IMPOSSIBLE_TRAVEL"], "fraud_score": 0.8812, "claimed_by": null }
]
```
`sla_breached` = not closed and now > `sla_due_at`. Show these in red as **SLA_BREACHED**.
Frontend polls every 5 seconds.

### `GET /api/alerts/:alert_id`
```json
{
  "alert": { "alert_id": 15, "priority": "HIGH", "status": "IN_REVIEW", "sla_due_at": "…", "sla_breached": false,
             "claimed_by": "analyst1", "proposed_by": null, "comment": null },
  "transaction": { "txn_id": "T200000005", "txn_ts": "…", "amount": 4000.00, "channel": "POS",
                   "merchant_id": "M00450", "merchant_name": "…", "mcc": "5411", "txn_city": "Delhi", "txn_country": "IN",
                   "status": "BLOCKED", "decision": "BLOCK", "final_decision": "BLOCK",
                   "reason_codes": ["IMPOSSIBLE_TRAVEL"], "rule_risk_score": 100 },
  "features": { "velocity_10m": 0, "approved_today": 0.00, "avg_amount_30d": 2400.00,
                "speed_kmph": 1148.09, "new_merchant": false },
  "ai": { "fraud_score": 0.8812, "top_factors": ["…", "…", "…"], "model_status": "OK", "model_version": "xgb-v1" },
  "card": { "card_id": "C1005", "masked_number": "XXXXXXXXXXXX1234", "card_type": "DEBIT", "card_status": "ACTIVE",
            "home_city": "Mumbai", "daily_limit": 100000.00 },
  "recent_transactions": [ { "txn_id": "…", "txn_ts": "…", "amount": 2400.00, "txn_city": "Mumbai", "status": "APPROVED" } ],
  "narrative": null
}
```
If AI is unavailable: `ai.model_status = "MODEL_UNAVAILABLE"`, `fraud_score = null` → show "AI score unavailable".
`narrative` is the optional AI summary (bonus); show with the label "AI-generated" when not null.

### `POST /api/alerts/:alert_id/claim`
Request `{}` → 200 with the updated alert (`status: "IN_REVIEW"`, `claimed_by`).
Someone else got it first → **409**.

### `POST /api/alerts/:alert_id/close`
Request
```json
{ "outcome": "FALSE_POSITIVE", "comment": "Customer confirmed by phone, genuine travel." }
```
`outcome` = `CONFIRMED_FRAUD` or `FALSE_POSITIVE`. `comment` at least 10 characters (else 422).
Only the analyst who claimed it can close it (else 403).

Response
```json
{ "alert_id": 15, "status": "PENDING_MANAGER_APPROVAL" }
```
- `CONFIRMED_FRAUD` → status `CONFIRMED_FRAUD`, card becomes BLOCKED.
- `FALSE_POSITIVE` and amount ≤ ₹1,00,000 → status `FALSE_POSITIVE`.
- `FALSE_POSITIVE` and amount > ₹1,00,000 → status `PENDING_MANAGER_APPROVAL` (`proposed_by` = this analyst).

---

## 6. Manager APIs (role MANAGER)

### Pending approvals
`GET /api/alerts?status=PENDING_MANAGER_APPROVAL` (same list format as above)

### `POST /api/alerts/:alert_id/decision`
Request
```json
{ "decision": "APPROVE", "comment": "Reviewed evidence, genuine payment." }
```
- `APPROVE` → `FALSE_POSITIVE`. `REJECT` → `CONFIRMED_FRAUD` (card blocked).
- Comment at least 10 characters.
- If this manager is the same user as `proposed_by` → **403**.
- Already decided by someone else → **409**.

Response `{ "alert_id": 15, "status": "FALSE_POSITIVE" }`

### `GET /api/dashboard?from=2026-03-01&to=2026-03-05`
```json
{
  "transactions_by_decision": { "APPROVE": 120, "STEP_UP": 20, "BLOCK": 10 },
  "block_rate": 0.0667,
  "step_up_rate": 0.1333,
  "open_alerts_by_priority": { "HIGH": 4, "MEDIUM": 7 },
  "sla_breaches": 2,
  "false_positive_rate": 0.25,
  "top_reason_codes": [ { "code": "AMOUNT_SPIKE", "count": 14 }, { "code": "HIGH_VELOCITY", "count": 9 } ]
}
```
`false_positive_rate` = FALSE_POSITIVE ÷ all closed alerts. Rates are 0–1; frontend shows them as %.

### `GET /api/audit?entity=TRANSACTION&entity_id=T200000007`
`entity` = `TRANSACTION`, `ALERT`, `CARD` or `CONFIG`. Oldest first.
```json
[
  { "id": 101, "entity": "TRANSACTION", "entity_id": "T200000007", "actor": "system", "role": "ENGINE",
    "ts": "2026-03-04T14:05:00+05:30", "action": "DECISION", "from_status": "RECEIVED", "to_status": "STEP_UP_PENDING",
    "comment": "AMOUNT_SPIKE", "before": null, "after": { "rule_risk_score": 30, "fraud_score": 0.41 } }
]
```

### `GET /api/audit/export?entity=TRANSACTION&entity_id=T200000007`
Returns a CSV file download of the same rows.

### `GET /api/config`
```json
[ { "key": "velocity_burst_count", "value": 5, "updated_at": "…" } ]
```

### `PUT /api/config/:key`
Request `{ "value": 6 }` → Response `{ "key": "velocity_burst_count", "value": 6 }`. Writes an audit row with before/after.

---

## 7. Simulate transaction (for the demo; ANALYST or MANAGER)

### `POST /api/simulate`
Same body as the gateway request (Section 2), no API key needed – the backend uses the user's JWT and calls its own decision engine. Same response as Section 2.
If `txn_id` is left empty, the backend generates one.

---

## 8. ML service (Dev owns, backend calls it)

### `GET /health` → `{ "status": "ok", "model_version": "xgb-v1" }`

### `POST /score`

**Request** – exactly the feature names from `case_01_labelled_transactions_V1.0.csv`. The backend sends raw values; the ML service does all encoding.

```json
{
  "card_type": "DEBIT",
  "channel": "ECOM",
  "mcc": "5732",
  "mcc_category": "ELECTRONICS",
  "merchant_risk": "LOW",
  "amount": 15000.00,
  "local_hour": 14,
  "is_international": 0,
  "country_risk_high": 0,
  "distance_from_home_km": 0.0,
  "velocity_10m": 0,
  "velocity_24h": 1,
  "amount_to_avg30_ratio": 6.25,
  "new_merchant_flag": 0,
  "card_age_days": 812
}
```

| Feature | How the backend computes it |
|---|---|
| `local_hour` | hour of `txn_ts` in IST (0–23) |
| `is_international` | 1 if `txn_country` ≠ card `home_country` |
| `country_risk_high` | 1 if the country's `risk_level` = HIGH |
| `distance_from_home_km` | haversine(card `home_city`, `txn_city`), earth radius 6371 |
| `velocity_10m` | prior transactions on the card in the 10 minutes before |
| `velocity_24h` | prior transactions on the card in the 24 hours before |
| `amount_to_avg30_ratio` | amount ÷ avg_amount_30d; `null` when there is no 30-day history |
| `new_merchant_flag` | 1 if no prior transaction with this merchant in 90 days |
| `card_age_days` | transaction date − card `issue_date` |

Do **not** send `txn_id`, `txn_ts`, `city_tier`, card number, names or mobile.

**Response**
```json
{
  "fraud_score": 0.4120,
  "top_factors": ["amount 6.3x the card's 30-day average", "online payment", "electronics merchant"],
  "model_version": "xgb-v1"
}
```
- `fraud_score` between 0 and 1.
- `top_factors` = top 3 SHAP features in plain English.

### Backend rules for using the score
- Timeout **150 ms**. On timeout or error → use rules only, `model_status = "MODEL_UNAVAILABLE"`, `fraud_score = null`.
- Rules said `APPROVE` and score ≥ 0.70 → `STEP_UP`, add `HIGH_FRAUD_SCORE_MODEL`.
- Rules said `STEP_UP` and score ≥ 0.90 → `BLOCK`, add `HIGH_FRAUD_SCORE_MODEL`.
- Rules said `BLOCK` → stays `BLOCK`. The AI never softens a decision.
- Thresholds 0.70 / 0.90 come from the config table.

**Until Dev's service is ready**, the backend uses a fake `/score` that returns `{ "fraud_score": 0.1, "top_factors": [], "model_version": "stub" }`.

---

## 9. Batch commands (backend, no API)

```
npm run reset                                   # wipe DB, reload seed data
npm run batch -- ../../data/case_01_batch_transactions_sample_V1.0.csv
                                                # writes /output/decisions_output.csv and /output/alerts_output.csv
npm run replay -- <file.csv> --rate 2           # posts rows to the gateway API, 2 per second (demo)
```
Dev's script writes `/output/fraud_scores_output.csv` (`txn_id, fraud_score, final_decision, top_factors`).

---

## 10. Who builds what

| Person | Builds | Uses |
|---|---|---|
| **Aakarshan** | Sections 2–7 and 9 (all backend endpoints), calls Section 8 | — |
| **Manish** | Screens that call Sections 3–7 | mock JSON from this file until the backend is ready |
| **Dev** | Section 8 (`/health`, `/score`), model, reports | sample rows from the labelled CSV to test |
