# FraudShield ML service (Dev)

Implements **API Contract Section 8**: `GET /health` and `POST /score`.
XGBoost fraud-risk model with SHAP explanations, served by FastAPI.

## Layout

```
code/ml/
├── common.py       shared encoding (used by train / baseline / serve) — no drift
├── baseline.py     AI-1 rules-only baseline from the labelled file
├── train.py        trains the model, writes model/
├── serve.py        FastAPI /health + /score            <- the runtime service
├── explain.py      SHAP feature -> plain-English phrase
├── report.py       writes /output/evaluation_report.md + model_card.md
├── tune.py         hyperparameter sweep (evidence; not used in production)
├── sanity.py       data checks
├── latency.py      p95 latency + parity check against real rows
├── requirements.txt
├── Dockerfile
└── model/          model.json, features.json, meta.json  (committed, trained)
```

Data lives at the repo root `data/`. Scripts take the data dir as an argument.

## Run locally

```bash
cd code/ml
pip install -r requirements.txt
uvicorn serve:app --host 0.0.0.0 --port 8000
```

The model is already trained and committed, so the service runs immediately.

## Run with Docker (via the repo compose)

```bash
docker compose up ml          # from the repo root
curl http://localhost:8000/health
```

The backend reaches it on the compose network with `ML_URL=http://ml:8000`.

## Retrain (only if needed)

```bash
cd code/ml
python baseline.py ../../data     # prints the baseline PR-AUC (the number to beat 2x)
python train.py   ../../data      # retrains, overwrites model/
python report.py  ../../data      # regenerates the two /output reports
```

Out-of-time split (train before 2026-01-01), seed 42. Excludes `txn_id`,
`txn_ts`, `city_tier`. Current model: test PR-AUC **0.647** vs baseline
**0.133** = **4.87x** (AI-1 target >= 2x).

## Contract notes for the backend

- Request is flat JSON, the 15 feature names from the labelled file.
  `mcc_category`, `merchant_risk`, `distance_from_home_km` and
  `amount_to_avg30_ratio` may be `null`; the service handles that (no 422/500).
- Response: `fraud_score` (0-1), `top_factors` (3 plain-English strings),
  `top_features` (3 raw names, for `fraud_scores_output.csv`), `model_version`.
- `model_status`, the 150 ms timeout and the 0.70/0.90 ratchet are the backend's
  job (`services/ml.js`), not this service's.

## Verified

- p95 latency ~41 ms (budget 150 ms), model + SHAP explainer loaded once at import.
- Null fields, unseen `mcc`/`mcc_category`: 200, no crash.
- Service stopped -> backend returns rules-only + `MODEL_UNAVAILABLE`.
