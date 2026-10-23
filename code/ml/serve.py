"""FraudShield ML service — API Contract Section 8.

GET  /health -> {"status": "ok", "model_version": "xgb-v1"}
POST /score  -> {"fraud_score", "top_factors", "model_version"}

Model, feature spec and TreeExplainer are loaded ONCE at import so each request
only runs a predict + a tree SHAP pass. The backend owns the 150 ms timeout,
the ratchet and model_status; this service just returns a score and reasons.
"""
import json
import os
from typing import Optional

import numpy as np
import pandas as pd
import xgboost as xgb
import shap
from fastapi import FastAPI
from pydantic import BaseModel

from common import FEATURES, CATEGORICAL, NUMERIC
from explain import phrase

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(HERE, "model")

spec = json.load(open(os.path.join(MODEL_DIR, "features.json")))
meta = json.load(open(os.path.join(MODEL_DIR, "meta.json")))
CATEGORIES = spec["categories"]
MODEL_VERSION = meta["model_version"]

booster = xgb.Booster()
booster.load_model(os.path.join(MODEL_DIR, "model.json"))
booster.set_param({"device": "cpu"})
explainer = shap.TreeExplainer(booster)

app = FastAPI(title="FraudShield ML", version=MODEL_VERSION)


class ScoreRequest(BaseModel):
    # The backend sends null for any lookup it cannot resolve (merchant/mcc/city
    # not in its maps) and for amount_to_avg30_ratio when there is no 30-day
    # history. Those must parse, not 422 - a 422 looks like MODEL_UNAVAILABLE.
    card_type: str
    channel: str
    mcc: str
    mcc_category: Optional[str] = None
    merchant_risk: Optional[str] = None
    amount: float
    local_hour: int
    is_international: int
    country_risk_high: int
    distance_from_home_km: Optional[float] = None
    velocity_10m: int
    velocity_24h: int
    amount_to_avg30_ratio: Optional[float] = None   # null when no 30-day history
    new_merchant_flag: int
    card_age_days: int


def _frame(req: ScoreRequest) -> pd.DataFrame:
    """One raw payload -> the exact 1-row matrix the model was trained on."""
    d = req.model_dump()
    row = {}
    for c in NUMERIC:
        row[c] = pd.to_numeric(pd.Series([d[c]]), errors="coerce")[0]
    X = pd.DataFrame([row])
    for c in CATEGORICAL:
        # unseen level -> NaN (not an error), category order pinned from training
        X[c] = pd.Categorical([str(d[c])], categories=CATEGORIES[c])
    return X[FEATURES]


@app.get("/health")
def health():
    return {"status": "ok", "model_version": MODEL_VERSION}


@app.post("/score")
def score(req: ScoreRequest):
    X = _frame(req)
    dm = xgb.DMatrix(X, enable_categorical=True)
    fraud_score = float(booster.predict(dm)[0])

    sv = explainer.shap_values(X)
    sv = np.asarray(sv).reshape(-1)        # one row, one contribution per feature
    raw = req.model_dump()
    order = np.argsort(sv)[::-1]           # most score-INCREASING first

    # Pick the top-3 feature INDICES once, so names and phrases stay aligned 1:1.
    chosen = [int(i) for i in order if sv[i] > 0][:3]   # only reasons that pushed up
    for i in order:                        # backfill if fewer than 3 pushed up
        if len(chosen) >= 3:
            break
        if int(i) not in chosen:
            chosen.append(int(i))

    # top_features = raw names for fraud_scores_output.csv (joined by | downstream)
    # top_factors  = same three, in plain English, for the analyst screen
    top_features = [FEATURES[i] for i in chosen]
    top_factors = [phrase(FEATURES[i], raw[FEATURES[i]]) for i in chosen]

    return {
        "fraud_score": round(fraud_score, 4),
        "top_factors": top_factors,
        "top_features": top_features,
        "model_version": MODEL_VERSION,
    }


# Warm up at import: run one full predict + SHAP pass so the first real request is
# fast, and so a self-restart comes back already hot. A failure here must not stop
# the service starting - it would just mean a slightly slower first request.
def _warmup():
    try:
        dummy = ScoreRequest(
            card_type="DEBIT", channel="POS", mcc="5411", mcc_category="GROCERY",
            merchant_risk="LOW", amount=1000.0, local_hour=12, is_international=0,
            country_risk_high=0, distance_from_home_km=1.0, velocity_10m=0,
            velocity_24h=1, amount_to_avg30_ratio=1.0, new_merchant_flag=0,
            card_age_days=500,
        )
        score(dummy)
    except Exception as e:  # never block startup on warmup
        print(f"[ml] warmup skipped: {e}")


_warmup()
