"""Shared by train.py, baseline.py and serve.py so encoding can never drift."""
import json
import numpy as np
import pandas as pd

# The 15 model features, in the order the model is trained on.
# Order is pinned here and re-saved as features.json next to the model.
NUMERIC = [
    "amount", "local_hour", "is_international", "country_risk_high",
    "distance_from_home_km", "velocity_10m", "velocity_24h",
    "amount_to_avg30_ratio", "new_merchant_flag", "card_age_days",
]
CATEGORICAL = ["card_type", "channel", "mcc", "mcc_category", "merchant_risk"]
FEATURES = NUMERIC + CATEGORICAL

# Never features: txn_id, txn_ts (banned), city_tier (banned as a feature,
# kept aside for the AI-3 fairness table), is_fraud (the label).
BANNED = ["txn_id", "txn_ts", "city_tier", "is_fraud"]

SPLIT_DATE = "2026-01-01"
SEED = 42


def load_config(data_dir):
    with open(f"{data_dir}/case_01_rules_config_V1.0.json") as f:
        return json.load(f)


def load_labelled(data_dir):
    """mcc must be read as a string: the config's high_risk_mcc list holds strings."""
    df = pd.read_csv(
        f"{data_dir}/case_01_labelled_transactions_V1.0.csv",
        dtype={"mcc": str},
    )
    df["txn_ts"] = pd.to_datetime(df["txn_ts"], format="ISO8601")
    return df


def split_out_of_time(df):
    """Out-of-time split required by AI-1: train before 2026-01-01, test after."""
    cut = pd.Timestamp(SPLIT_DATE, tz="+05:30")
    return df[df.txn_ts < cut].copy(), df[df.txn_ts >= cut].copy()


def prepare(df):
    """Raw columns -> model matrix. The ONE place encoding happens.

    Categoricals become pandas 'category' dtype, which XGBoost consumes natively
    with enable_categorical=True. amount_to_avg30_ratio keeps its NaN: a card with
    no 30-day history has no ratio, which is not a ratio of zero.
    """
    X = pd.DataFrame(index=df.index)
    for c in NUMERIC:
        X[c] = pd.to_numeric(df[c], errors="coerce")
    for c in CATEGORICAL:
        X[c] = df[c].astype(str).astype("category")
    return X[FEATURES]


def align_categories(X, categories):
    """Serve-time: force the training set's categories so column order and level
    order match exactly. Unseen levels become NaN rather than raising."""
    for c in CATEGORICAL:
        X[c] = pd.Categorical(X[c].astype(str), categories=categories[c])
    return X[FEATURES]


def prepare_iso(df, categories):
    """Numeric matrix for the Isolation Forest (AI-4). IF cannot take pandas
    categoricals or NaN, so categoricals become integer codes (unseen/NaN -> -1)
    aligned to the training categories, and numeric NaN is filled with 0."""
    X = align_categories(prepare(df), categories).copy()
    for c in CATEGORICAL:
        X[c] = X[c].cat.codes          # -1 for unseen / missing
    return X[FEATURES].astype(float).fillna(0.0)
