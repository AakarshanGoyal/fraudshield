# FraudShield - Model Card

**Model:** XGBoost classifier, version `xgb-v1`, seed 42.
**Task:** probability a card transaction is fraud; served as `fraud_score` in [0,1].
**Training data:** `case_01_labelled_transactions_V1.0.csv`, out-of-time split
(train before 2026-01-01). **Does not use** `txn_id`, `txn_ts`, `city_tier`, card
number, customer name or mobile.

## Performance (test period)

| | Baseline | Model |
|---|---:|---:|
| PR-AUC | 0.1329 | 0.6474 (4.87x) |
| ROC-AUC | 0.7155 | 0.9186 |

Full metrics in `evaluation_report.md`.

## AI-3 - Operating threshold

The model adds friction by the config thresholds: **step-up at 0.70**,
**block at 0.90**. We justify 0.70 by expected cost, where a missed
fraud costs the transaction amount and a false alarm costs rupees 150.

Sweeping thresholds 0.01-0.99 on the test period, total expected cost is minimised at
**threshold 0.52** (cost rupees 418,374). At the operating threshold
0.70 the cost is rupees 572,213 - the same order as the optimum, so 0.70 is a reasonable, slightly conservative operating point that favours catching fraud.

## AI-3 - Friction by segment (genuine transactions only)

Friction = share of **genuine** transactions scored at or above the step-up
threshold 0.70 (i.e. customers inconvenienced).

### By city tier
| segment | friction rate (genuine) | n |
|---|---:|---:|
| METRO | 1.12% | 20,239 |
| NON_METRO | 1.30% | 12,249 |

lower/higher ratio: **0.86** (fair if >= 0.80).

### By card type
| segment | friction rate (genuine) | n |
|---|---:|---:|
| CREDIT | 1.28% | 12,943 |
| DEBIT | 1.12% | 19,545 |

lower/higher ratio: **0.87** (fair if >= 0.80).

**Overall:** both ratios are >= 0.80 - no disproportionate friction detected.

## Limitations & governance

- No demographic attributes are used. Fairness is monitored on `city_tier` and
  `card_type` only (AI-3).
- The model can only make a decision **stricter** (APPROVE->STEP_UP->BLOCK); it never
  releases a transaction the rules blocked.
- Every decision stores `model_version` and the features used, so any score replays.
- Served scores are only as good as the features the backend computes; parity with the
  labelled-file definitions is required.
- Reference metrics assume the labelled file's distribution; the live batch is enriched
  with fraud and will show different base rates.
