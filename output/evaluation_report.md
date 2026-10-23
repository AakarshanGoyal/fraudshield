# FraudShield - Evaluation Report (AI-1)

Out-of-time split: train `txn_ts < 2026-01-01`, test on/after. Seed 42.
Test period: **32,915** transactions, **427** fraud (1.2973%).
Metrics computed on the test period only.

## Model vs rules-only baseline

| Metric | Baseline (rules) | XGBoost model |
|---|---:|---:|
| **PR-AUC** (primary) | 0.1329 | **0.6474** |
| ROC-AUC | 0.7155 | 0.9186 |
| Precision @ 0.70 | 0.0819 | 0.4452 |
| Recall @ 0.70 | 0.4801 | 0.7237 |

**PR-AUC ratio: 4.87x** the baseline
(AI-1 reference target: >= 2.00x). **PASS.**

## Confusion matrix - model at step-up threshold 0.70

|            | pred genuine | pred fraud |
|------------|-------------:|-----------:|
| **actual genuine** | 32,103 | 385 |
| **actual fraud**   | 118 | 309 |

At this threshold the model catches **309/427** frauds (72.4% recall)
while stepping up **385** genuine transactions.

## How the baseline is defined

Rules-only score from the labelled file's own columns, per the case:
score 100 if `velocity_10m >= 5` or `merchant_risk == BLACKLISTED`, otherwise the
sum of R7-R12 points (capped at 100). R10 uses the config `high_risk_mcc` list
['4829', '5967', '6051', '7995']. Note: `BLACKLISTED` does not occur in the labelled file, so
the hard-100 branch fires only on the velocity condition here.

## Model

XGBoost, 170 trees, `scale_pos_weight` 82.3
for the 1.30% fraud rate. Early stopping on the last month of the
training period (never the test set). 15 features; `txn_id`, `txn_ts`, `city_tier`
excluded as required. Missing `amount_to_avg30_ratio` kept as NaN (XGBoost native).
