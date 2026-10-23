# FraudShield – ER diagram

Source: `code/backend/prisma/schema.prisma` (PostgreSQL). GitHub renders the diagram below.

- **Solid line**: real foreign key, enforced by the database.
- **Dotted line**: reference by ID or code, checked by the application (no FK constraint).

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

## Relationships

| From | To | Cardinality | Enforced by | Notes |
|---|---|---|---|---|
| Customer | Card | 1 to many | FK `Card.customer_id` | A customer can have several cards |
| Customer | User | 0..1 to 0..1 | FK `User.customer_id` (unique) | Cardholder logins only; staff users have no customer |
| Card | Transaction | 1 to many | FK `Transaction.card_id` | Indexed on `(card_id, txn_ts)` for velocity and history lookups |
| Transaction | StepUp | 1 to 0..1 | FK `StepUp.txn_id` (unique) | Only STEP_UP decisions create one; OTP stored as a hash |
| Transaction | Alert | 1 to 0..1 | FK `Alert.txn_id` (unique) | At most one alert per transaction |
| Merchant, MccCode, City, CountryRisk | Transaction / Card / Merchant | 1 to many | Application | Reference data loaded from the CSVs; looked up by code |
| User | Alert | 1 to many | Application | `claimed_by`, `proposed_by`, `closed_by` store usernames; maker and checker must differ |
| AuditLog | Transaction, Alert, Card, RuleConfig | many to 0..1 | Application | Polymorphic (`entity` + `entity_id`); append-only, no update or delete |

## Design notes

- **No full card numbers**: `Card` keeps only `card_hash` and `last4`.
- **Money** is `Decimal(12,2)`, never float.
- **Concurrency**: status changes are conditional updates; `Alert.version` increments on every change, so a second claim or decision gets HTTP 409.
- **Configuration**: every threshold lives in `RuleConfig` (loaded from `case_01_rules_config_V1.0.json`); changes write an `AuditLog` row with before and after values.
