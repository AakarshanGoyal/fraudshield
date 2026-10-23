# FraudShield – System Design Document

**HCL BFSI Hackathon – Use Case 01: Retail Banking: Cards & Payments**  
*Real-Time Card Transaction Fraud Detection, Step-Up Verification, and Alert Management*

---

## 1. Executive Summary & Architecture Overview

FraudShield is an enterprise-grade real-time fraud mitigation and risk management system built for high-throughput retail payment processing. It couples a sub-50ms deterministic business rules engine with an AI overlay (XGBoost + SHAP explainer), a cardholder two-factor step-up authentication mechanism, an analyst alert investigation queue with strict SLAs, maker-checker governance on high-value releases, and an append-only audit trail.

### High-Level Architecture

```mermaid
graph TD
    subgraph Clients["Clients & Gateways"]
        GW["Payment Gateway Client<br/>(Simulated / Batch)"]
        CH_UI["Cardholder Portal<br/>(React / Vite)"]
        OPS_UI["Analyst & Manager UI<br/>(React / Vite)"]
    end

    subgraph Backend["Core Decision Service (Node.js / Express :4000)"]
        AUTH["Auth & Role Guard<br/>(JWT / API Key)"]
        DECIDE["Decision Engine<br/>(Rules R1-R13)"]
        CTX["Context Store<br/>(In-Memory Cache)"]
        STATE["Lifecycle & Step-Up Manager"]
        AUDIT["Audit & SLA Service"]
    end

    subgraph ML["AI Service (FastAPI :8000)"]
        XGB["XGBoost Classifier<br/>(xgb-v1)"]
        SHAP["TreeSHAP Explainer"]
    end

    subgraph Storage["Persistent Storage"]
        PG[("PostgreSQL 16<br/>(Prisma ORM)")]
        REDIS[("Redis 7<br/>(Cache / Locks)")]
    end

    GW -->|"POST /api/v1/authorisations<br/>(x-api-key)"| AUTH
    CH_UI -->|"POST /api/me/stepups/:id/respond<br/>(JWT: CARDHOLDER)"| AUTH
    OPS_UI -->|"GET /api/alerts, POST /api/alerts/:id/*<br/>(JWT: ANALYST/MANAGER)"| AUTH

    AUTH --> DECIDE
    DECIDE <--> CTX
    DECIDE -->|"POST /score (HTTP/JSON)"| XGB
    XGB --> SHAP
    DECIDE --> STATE
    STATE --> AUDIT
    DECIDE <--> PG
    STATE <--> PG
    AUDIT --> PG
```

---

## 2. Technology Decisions & Rationale

| Layer / Component | Technology Selected | Rationale & Justification |
|---|---|---|
| **Backend Core** | Node.js (v20+) & Express 5 | High asynchronous I/O efficiency for concurrent transaction processing; predictable event-loop latency. |
| **Database & ORM** | PostgreSQL 16 & Prisma 6 | ACID transactional integrity; exact `Decimal(12,2)` precision for financial amounts; conditional updates and row-level locking (`FOR UPDATE`). |
| **ML Inference Service** | Python 3.12 & FastAPI + Uvicorn | Ultra-low latency ASGI interface; native C++ bindings for XGBoost 3.4.1 and fast vectorized TreeSHAP calculations. |
| **Frontend Application** | React 18, Vite 6, TailwindCSS 4 | Instant sub-second hot reload; modern responsive component library; TanStack Query for 5s automatic polling of queues and SLA timers. |
| **Containerization** | Docker & Docker Compose | Single-command deployment reproducible across environments; isolated networking and healthchecks. |

---

## 3. Assumptions & Compliance Standards

1. **PCI-DSS Compliance (Masked Card Data):**
   - Full 16-digit Primary Account Numbers (PAN) are **never** stored, logged, transmitted, or displayed.
   - The database stores a salted SHA-256 hash (`card_hash`) and the unmasked `last4` digits.
   - All customer-facing and analyst-facing UIs display card numbers masked as `•••• 1234` or `XXXXXXXXXXXX1234`.
2. **Currency:**
   - Single-currency INR (`INR`) processing. Money is tracked using `Decimal(12,2)` to eliminate floating-point rounding errors.
3. **Authentication & Authorization:**
   - **System Integration:** The card authorization gateway uses a 24-byte random `GATEWAY_API_KEY` passed in the `x-api-key` header.
   - **Human Users:** Role-Based Access Control (RBAC) enforced via signed JSON Web Tokens (`JWT`) with roles `CARDHOLDER`, `ANALYST`, and `MANAGER`.
4. **Time & Locality:**
   - All timestamps are ISO-8601 with Indian Standard Time (+05:30) offset.
   - Odd-hour risk checks apply between 00:00 and 04:00 IST.

---

## 4. Database Schema & Entity-Relationship Diagram (ERD)

The data model is implemented in PostgreSQL via Prisma (`code/backend/prisma/schema.prisma`). Real database foreign keys enforce integrity, while reference dimensions (merchants, cities, MCCs) are validated in application logic.

```mermaid
erDiagram
    Customer ||--o{ Card : "owns"
    Customer |o--o| User : "logs in as"
    Card ||--o{ Transaction : "used for"
    Transaction ||--o| StepUp : "verified by"
    Transaction ||--o| Alert : "raises"

    Merchant ||..o{ Transaction : "merchant_id"
    MccCode ||..o{ Merchant : "mcc"
    MccCode ||..o{ Transaction : "mcc"
    City ||..o{ Transaction : "txn_city"
    City ||..o{ Card : "home_city"
    CountryRisk ||..o{ Transaction : "txn_country"
    User ||..o{ Alert : "claimed / proposed / closed by"
    AuditLog }o..o| Transaction : "entity TRANSACTION"
    AuditLog }o..o| Alert : "entity ALERT"
    AuditLog }o..o| Card : "entity CARD"
    AuditLog }o..o| RuleConfig : "entity CONFIG"

    Customer {
        String customer_id PK
        String full_name
        String mobile
        String email
        String city
        String username UK
    }
    User {
        String user_id PK
        String username UK
        String password_hash "bcrypt"
        String role "CARDHOLDER | ANALYST | MANAGER"
        String customer_id FK,UK "null for staff"
    }
    Card {
        String card_id PK
        String customer_id FK
        String card_hash "salted hash, never the number"
        String last4
        String card_type "DEBIT | CREDIT"
        String card_status "ACTIVE | BLOCKED | EXPIRED"
        Date issue_date
        Date expiry_date
        String home_city
        String home_country
        Decimal daily_limit "12,2"
        Boolean international_enabled
    }
    Transaction {
        String txn_id PK
        String card_id FK
        Timestamptz txn_ts "index with card_id"
        Decimal amount "12,2"
        String currency "INR"
        String merchant_id
        String mcc
        String channel "POS | ECOM | ATM | CONTACTLESS"
        String txn_city
        String txn_country
        String status "RECEIVED | STEP_UP_PENDING | APPROVED | BLOCKED"
        String source "LIVE | HISTORY"
        String decision "rules only"
        String final_decision "after AI"
        String_array reason_codes
        Int rule_risk_score
        Int velocity_10m
        Decimal avg_amount_30d
        Float speed_kmph
        Float fraud_score
        Json top_factors
        String model_status "OK | MODEL_UNAVAILABLE"
        String model_version
        DateTime processed_at
    }
    StepUp {
        Int id PK
        String txn_id FK,UK
        String otp_hash
        DateTime expires_at
        String status "PENDING | CONFIRMED | DENIED | EXPIRED"
        DateTime responded_at
    }
    Alert {
        Int alert_id PK
        String txn_id FK,UK
        String priority "HIGH | MEDIUM"
        String status "OPEN | IN_REVIEW | PENDING_MANAGER_APPROVAL | CONFIRMED_FRAUD | FALSE_POSITIVE"
        DateTime sla_due_at
        DateTime created_at
        String claimed_by "username"
        String proposed_by "maker"
        String closed_by "checker or analyst"
        String comment
        Int version "optimistic lock"
    }
    Merchant {
        String merchant_id PK
        String merchant_name "untrusted text"
        String mcc
        String mcc_description
        String city
        String country
        String merchant_risk "LOW | MEDIUM | HIGH | BLACKLISTED"
    }
    MccCode {
        String mcc PK
        String mcc_description
        String mcc_category
        Boolean high_risk
    }
    City {
        String city PK
        String country
        Float lat
        Float lon
        String city_tier "METRO | NON_METRO | INTL"
    }
    CountryRisk {
        String country_code PK
        String country_name
        String risk_level "LOW | HIGH"
    }
    RuleConfig {
        String key PK
        Json value
        DateTime updated_at
    }
    AuditLog {
        BigInt id PK
        String entity "TRANSACTION | ALERT | CARD | CONFIG"
        String entity_id "index with entity, ts"
        String actor
        String role
        DateTime ts
        String action
        String from_status
        String to_status
        String comment
        Json before
        Json after
    }
```

---

## 5. Rules Evaluation & Decision Flowchart (R1–R13)

The decision engine evaluates incoming payment authorizations in a strict deterministic order. Hard-stop checks take precedence; if none fail, derived features are computed and soft risk points are aggregated, followed by the Machine Learning overlay.

```mermaid
flowchart TD
    START(["Incoming Authorization"]) --> IDEMP{"Idempotency Check<br/>(txn_id exists?)"}
    IDEMP -- "Yes" --> RET_EXIST["Return Stored Decision<br/>(Idempotent 200)"]
    IDEMP -- "No" --> LOCK["Acquire Card Row Lock<br/>(SELECT ... FOR UPDATE)"]

    LOCK --> R1_R2{"Hard Stops (R1 & R2)<br/>Card Active & Unexpired?<br/>Intl Enabled if txn_country != IN?"}
    R1_R2 -- "Failed" --> BLOCK_HARD["BLOCK (Score: null)<br/>CARD_NOT_ACTIVE / INTL_NOT_ENABLED"]

    R1_R2 -- "Passed" --> FEAT["Compute Dynamic Features<br/>- 10-min & 24h Velocity<br/>- Today's Spend vs Daily Limit<br/>- 30-Day Avg Spend<br/>- Geo Distance & Speed (km/h)<br/>- 90-Day Merchant History"]

    FEAT --> R3_R6{"Hard Block Rules (R3-R6)<br/>- R3: Merchant Blacklisted?<br/>- R4: Daily Limit Exceeded?<br/>- R5: Velocity >= 5 in 10m?<br/>- R6: Speed > 800 km/h?"}
    R3_R6 -- "Triggered" --> BLOCK_R36["BLOCK (Score: 100)<br/>VELOCITY_BURST / IMPOSSIBLE_TRAVEL / ..."]

    R3_R6 -- "None" --> R7_R12["Evaluate Soft Rules & Points (R7-R12)<br/>- R7: Velocity 3-4 (25 pts)<br/>- R8: Amount Spike >5x avg or >50k (30 pts)<br/>- R9: High-Risk Country (25 pts)<br/>- R10: High-Risk MCC (15 pts)<br/>- R11: Odd-Hours 00:00-04:00 >20k (15 pts)<br/>- R12: New ECOM Merchant >25k (20 pts)"]

    R7_R12 --> R13{"Rule R13: Multiple Red Flags?<br/>Triggered rules >= 3?"}
    R13 -- "Yes (>=3)" --> BLOCK_FLAGS["BLOCK (Score: points sum)<br/>Reason: MULTIPLE_RED_FLAGS"]

    R13 -- "No (<3)" --> CHECK_SOFT{"Any Soft Rules Fired?"}
    CHECK_SOFT -- "1 or 2 rules" --> RULES_STEP["Rules Decision: STEP_UP"]
    CHECK_SOFT -- "0 rules" --> RULES_APP["Rules Decision: APPROVE"]

    RULES_STEP --> ML_CALL["Call ML Model (:8000/score)<br/>Input: 15 Engineered Features"]
    RULES_APP --> ML_CALL
    BLOCK_R36 --> ML_CALL
    BLOCK_FLAGS --> ML_CALL

    ML_CALL --> AI_OVERLAY{"AI Overlay (AI-2)<br/>Score Thresholds:<br/>Step-Up >= 0.70, Block >= 0.90"}
    AI_OVERLAY -->|"Score >= 0.90"| OVER_BLOCK["Final Decision: BLOCK<br/>HIGH_FRAUD_SCORE_MODEL"]
    AI_OVERLAY -->|"Score >= 0.70 and APPROVE"| OVER_STEP["Final Decision: STEP_UP<br/>HIGH_FRAUD_SCORE_MODEL"]
    AI_OVERLAY -->|"No escalation"| KEEP_DECISION["Keep Rules Decision"]

    OVER_BLOCK --> POST_PROC["Persist Txn & Audit Log<br/>Create StepUp or Alert if needed"]
    OVER_STEP --> POST_PROC
    KEEP_DECISION --> POST_PROC
    BLOCK_HARD --> POST_PROC
```

---

## 6. State Lifecycle Diagrams

### 6.1 Transaction State Lifecycle

```mermaid
stateDiagram-v2
    [*] --> RECEIVED: POST /api/v1/authorisations
    RECEIVED --> APPROVED: Low Risk (APPROVE)
    RECEIVED --> BLOCKED: Hard Stop / Velocity / AI Block
    RECEIVED --> STEP_UP_PENDING: Suspicious Payment (STEP_UP)

    STEP_UP_PENDING --> APPROVED: Cardholder Confirmed (Correct OTP)
    STEP_UP_PENDING --> BLOCKED: Cardholder Denied ('NOT_ME') -> Card Blocked
    STEP_UP_PENDING --> BLOCKED: Timeout Exceeded (15 min)

    APPROVED --> [*]
    BLOCKED --> [*]
```

### 6.2 Alert State Lifecycle & Maker-Checker Dual Control

```mermaid
stateDiagram-v2
    [*] --> OPEN: Created on Fraud Block
    OPEN --> IN_REVIEW: Analyst Claims Alert

    IN_REVIEW --> CONFIRMED_FRAUD: Analyst Confirms Fraud (Card Blocked)
    IN_REVIEW --> FALSE_POSITIVE: False Positive <= ₹1,00,000 (Released)
    IN_REVIEW --> PENDING_MANAGER_APPROVAL: False Positive > ₹1,00,000 (Maker Step)

    PENDING_MANAGER_APPROVAL --> FALSE_POSITIVE: Manager Approves (Checker Step)
    PENDING_MANAGER_APPROVAL --> CONFIRMED_FRAUD: Manager Rejects (Card Blocked)

    CONFIRMED_FRAUD --> [*]
    FALSE_POSITIVE --> [*]
```

---

## 7. Concurrency & Idempotency Controls

1. **Card Concurrency Locking:**
   - To prevent race conditions during high-frequency velocity bursts, `decide.js` executes:
     ```sql
     SELECT card_id FROM "Card" WHERE card_id = $1 FOR UPDATE;
     ```
   - All transactions for a given card are serialized, ensuring velocity counters and daily limits are strictly accurate.
2. **Idempotency Guarantee:**
   - Resending a request with an existing `txn_id` returns the previously computed authorization decision without creating duplicate transactions, step-ups, alerts, or audit records.
3. **Optimistic Locking for Alerts:**
   - Every `Alert` row includes a `version` counter and updates require matching status:
     ```sql
     UPDATE "Alert" SET status = 'IN_REVIEW', claimed_by = $1, version = version + 1
     WHERE alert_id = $2 AND status = 'OPEN';
     ```
   - If two analysts simultaneously claim or act on the same alert, the second request fails with `HTTP 409 Conflict`.

---

## 8. API Specification Reference

Complete interactive OpenAPI documentation is served at runtime and persisted for offline evaluation:
* **Interactive Swagger UI:** `http://localhost:4000/api/docs`
* **OpenAPI 3.0 Export:** `output/design/openapi.json` (20 documented paths covering Auth, Authorisations, Cardholder self-service, Analyst Alerts, Manager Dashboard, Audit, and Config APIs).
