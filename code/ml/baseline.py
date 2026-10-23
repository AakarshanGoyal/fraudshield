"""AI-1 rules-only baseline, computed from the labelled file's own columns.

The case pins this formula exactly; thresholds and points are read from
case_01_rules_config_V1.0.json so they cannot drift from the backend's engine.
"""
import sys
import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, roc_auc_score

from common import load_config, load_labelled, split_out_of_time


def baseline_score(df, cfg):
    pts = cfg["points"]
    amount = pd.to_numeric(df["amount"])
    ratio = pd.to_numeric(df["amount_to_avg30_ratio"])
    vel = pd.to_numeric(df["velocity_10m"])
    hour = pd.to_numeric(df["local_hour"])

    # R7 velocity 3-4
    r7 = vel.between(cfg["velocity_stepup_min"], cfg["velocity_stepup_max"])
    # R8 amount spike: ratio > 5 and amount >= 10k, or no history and amount >= 50k
    r8 = ((ratio > cfg["amount_spike_multiplier"]) & (amount >= cfg["amount_spike_min_amount"])) \
         | (ratio.isna() & (amount >= cfg["amount_spike_no_history_amount"]))
    # R9 risky country
    r9 = pd.to_numeric(df["country_risk_high"]) == 1
    # R10 risky MCC - by MCC CODE from config, not category and not merchant_risk
    r10 = df["mcc"].astype(str).isin(cfg["high_risk_mcc"])
    # R11 odd hour and high value
    r11 = hour.between(cfg["odd_hour_start"], cfg["odd_hour_end"]) \
          & (amount >= cfg["odd_hour_min_amount"])
    # R12 ECOM at a new merchant, high value
    r12 = (df["channel"] == "ECOM") & (pd.to_numeric(df["new_merchant_flag"]) == 1) \
          & (amount >= cfg["new_merchant_min_amount"])

    soft = (r7 * pts["HIGH_VELOCITY"] + r8 * pts["AMOUNT_SPIKE"]
            + r9 * pts["HIGH_RISK_GEO"] + r10 * pts["HIGH_RISK_MCC"]
            + r11 * pts["ODD_HOUR_HIGH_VALUE"] + r12 * pts["NEW_MERCHANT_HIGH_VALUE"])
    soft = soft.clip(upper=100)

    hard = (vel >= cfg["velocity_burst_count"]) | (df["merchant_risk"] == "BLACKLISTED")
    return np.where(hard, 100, soft).astype(float), {
        "R7_HIGH_VELOCITY": r7, "R8_AMOUNT_SPIKE": r8, "R9_HIGH_RISK_GEO": r9,
        "R10_HIGH_RISK_MCC": r10, "R11_ODD_HOUR": r11, "R12_NEW_MERCHANT": r12,
        "HARD_100": hard,
    }


def main(data_dir):
    cfg = load_config(data_dir)
    df = load_labelled(data_dir)
    train, test = split_out_of_time(df)

    score, flags = baseline_score(test, cfg)
    y = test["is_fraud"].values

    pr = average_precision_score(y, score)
    roc = roc_auc_score(y, score)

    print("=" * 62)
    print("AI-1 RULES-ONLY BASELINE  (test period: on/after 2026-01-01)")
    print("=" * 62)
    print(f"test rows      : {len(test):,}   frauds: {int(y.sum()):,} ({100*y.mean():.4f}%)")
    print()
    print("rule hit rates on the test period:")
    for name, mask in flags.items():
        m = mask.values if hasattr(mask, "values") else mask
        hits = int(m.sum())
        cap = y[m].mean() * 100 if hits else 0.0
        print(f"  {name:22s} {hits:6,d} rows   fraud within: {cap:6.2f}%")
    print()
    print(f"  baseline PR-AUC  : {pr:.6f}   <-- the number to beat 2x")
    print(f"  baseline ROC-AUC : {roc:.6f}")
    print()
    print(f"  TARGET for the model: PR-AUC >= {2*pr:.6f}")
    print("=" * 62)
    return pr, roc


if __name__ == "__main__":
    main(sys.argv[1])
