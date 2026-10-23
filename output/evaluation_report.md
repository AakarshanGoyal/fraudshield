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

## AI-4 - Second detector (Isolation Forest vs XGBoost vs baseline)

Isolation Forest is unsupervised (labels used only for evaluation here), trained on
the same out-of-time split. Its anomaly score is normalised to [0,1] for the alert
screen. XGBoost remains the decision model; the Isolation Forest is a cross-check.

| Detector | ROC-AUC | PR-AUC (primary) |
|---|---:|---:|
| Baseline (rules) | 0.7155 | 0.1329 |
| **XGBoost (chosen)** | **0.9186** | **0.6474** |
| Isolation Forest | 0.8738 | 0.1119 |

AI-4 target (Isolation Forest ROC-AUC above the baseline ROC-AUC):
**PASS** (0.8738 vs 0.7155).

Why XGBoost is the decision model: the Isolation Forest ranks anomalies reasonably
(ROC-AUC 0.874) but its **PR-AUC is 0.1119** - below even the rules
baseline and far below XGBoost's 0.6474. For rare fraud, PR-AUC is the
metric that matters, so the supervised model is the right choice; the Isolation Forest
is shown alongside as an independent second opinion.

## Model

XGBoost, 170 trees, `scale_pos_weight` 82.3
for the 1.30% fraud rate. Early stopping on the last month of the
training period (never the test set). 15 features; `txn_id`, `txn_ts`, `city_tier`
excluded as required. Missing `amount_to_avg30_ratio` kept as NaN (XGBoost native).
