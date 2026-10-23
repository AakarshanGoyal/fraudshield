-- CreateTable
CREATE TABLE "Customer" (
    "customer_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "username" TEXT NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "Card" (
    "card_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "card_hash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "card_type" TEXT NOT NULL,
    "card_status" TEXT NOT NULL,
    "issue_date" DATE NOT NULL,
    "expiry_date" DATE NOT NULL,
    "home_city" TEXT NOT NULL,
    "home_country" TEXT NOT NULL,
    "daily_limit" DECIMAL(12,2) NOT NULL,
    "international_enabled" BOOLEAN NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("card_id")
);

-- CreateTable
CREATE TABLE "Merchant" (
    "merchant_id" TEXT NOT NULL,
    "merchant_name" TEXT NOT NULL,
    "mcc" TEXT NOT NULL,
    "mcc_description" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "merchant_risk" TEXT NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "MccCode" (
    "mcc" TEXT NOT NULL,
    "mcc_description" TEXT NOT NULL,
    "mcc_category" TEXT NOT NULL,
    "high_risk" BOOLEAN NOT NULL,

    CONSTRAINT "MccCode_pkey" PRIMARY KEY ("mcc")
);

-- CreateTable
CREATE TABLE "City" (
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "city_tier" TEXT NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("city")
);

-- CreateTable
CREATE TABLE "CountryRisk" (
    "country_code" TEXT NOT NULL,
    "country_name" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,

    CONSTRAINT "CountryRisk_pkey" PRIMARY KEY ("country_code")
);

-- CreateTable
CREATE TABLE "RuleConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "txn_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "txn_ts" TIMESTAMPTZ NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "merchant_id" TEXT NOT NULL,
    "mcc" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "txn_city" TEXT NOT NULL,
    "txn_country" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'LIVE',
    "decision" TEXT,
    "final_decision" TEXT,
    "reason_codes" TEXT[],
    "rule_risk_score" INTEGER,
    "velocity_10m" INTEGER,
    "avg_amount_30d" DECIMAL(12,2),
    "speed_kmph" DOUBLE PRECISION,
    "fraud_score" DOUBLE PRECISION,
    "top_factors" JSONB,
    "model_status" TEXT,
    "model_version" TEXT,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("txn_id")
);

-- CreateTable
CREATE TABLE "StepUp" (
    "id" SERIAL NOT NULL,
    "txn_id" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "StepUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "alert_id" SERIAL NOT NULL,
    "txn_id" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sla_due_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "claimed_by" TEXT,
    "proposed_by" TEXT,
    "closed_by" TEXT,
    "comment" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("alert_id")
);

-- CreateTable
CREATE TABLE "User" (
    "user_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "customer_id" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT,
    "comment" TEXT,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_username_key" ON "Customer"("username");

-- CreateIndex
CREATE INDEX "Transaction_card_id_txn_ts_idx" ON "Transaction"("card_id", "txn_ts");

-- CreateIndex
CREATE UNIQUE INDEX "StepUp_txn_id_key" ON "StepUp"("txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_txn_id_key" ON "Alert"("txn_id");

-- CreateIndex
CREATE INDEX "Alert_status_priority_sla_due_at_idx" ON "Alert"("status", "priority", "sla_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_customer_id_key" ON "User"("customer_id");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entity_id_ts_idx" ON "AuditLog"("entity", "entity_id", "ts");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("customer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "Card"("card_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepUp" ADD CONSTRAINT "StepUp_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "Transaction"("txn_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "Transaction"("txn_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("customer_id") ON DELETE SET NULL ON UPDATE CASCADE;
