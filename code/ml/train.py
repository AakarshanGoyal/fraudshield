"""AI-1 model: XGBoost, out-of-time split, seed 42, class imbalance handled.

Saves model/model.json, model/features.json (column + category order) and
model/meta.json so serve.py reproduces the exact training encoding.
"""
import json
import os
import sys
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import average_precision_score, roc_auc_score

from common import (load_labelled, split_out_of_time, prepare,
                    FEATURES, CATEGORICAL, SEED)
from baseline import baseline_score
from common import load_config


def main(data_dir, out="model"):
    os.makedirs(out, exist_ok=True)
    cfg = load_config(data_dir)
    df = load_labelled(data_dir)
    train, test = split_out_of_time(df)

    # Validation = last month of the TRAIN period, for early stopping.
    # Never the test set: early-stopping on test would leak.
    val_cut = pd.Timestamp("2025-12-01", tz="+05:30")
    tr = train[train.txn_ts < val_cut]
    va = train[train.txn_ts >= val_cut]

    Xtr, ytr = prepare(tr), tr.is_fraud.values
    Xva, yva = prepare(va), va.is_fraud.values
    Xte, yte = prepare(test), test.is_fraud.values

    spw = (ytr == 0).sum() / (ytr == 1).sum()
    print(f"train {len(Xtr):,} | val {len(Xva):,} | test {len(Xte):,} | scale_pos_weight {spw:.1f}")

    model = xgb.XGBClassifier(
        n_estimators=600, learning_rate=0.05, max_depth=5,
        subsample=0.8, colsample_bytree=0.8, min_child_weight=5,
        scale_pos_weight=spw, eval_metric="aucpr",
        early_stopping_rounds=40, enable_categorical=True,
        tree_method="hist", random_state=SEED,
    )
    model.fit(Xtr, ytr, eval_set=[(Xva, yva)], verbose=False)
    print(f"best_iteration: {model.best_iteration}")

    p = model.predict_proba(Xte)[:, 1]
    pr, roc = average_precision_score(yte, p), roc_auc_score(yte, p)
    base, _ = baseline_score(test, cfg)
    bpr, broc = average_precision_score(yte, base), roc_auc_score(yte, base)

    print("=" * 56)
    print(f"  model    PR-AUC {pr:.6f}   ROC-AUC {roc:.6f}")
    print(f"  baseline PR-AUC {bpr:.6f}   ROC-AUC {broc:.6f}")
    print(f"  ratio    {pr/bpr:.2f}x   (AI-1 target >= 2.00x)")
    print(f"  {'PASS' if pr >= 2*bpr else 'FAIL'} the 2x gate")
    print("=" * 56)

    model.save_model(f"{out}/model.json")
    cats = {c: list(Xtr[c].cat.categories) for c in CATEGORICAL}
    json.dump({"features": FEATURES, "categories": cats},
              open(f"{out}/features.json", "w"), indent=2)
    json.dump({"model_version": "xgb-v1", "seed": SEED,
               "best_iteration": int(model.best_iteration),
               "test_pr_auc": pr, "test_roc_auc": roc,
               "baseline_pr_auc": bpr, "baseline_roc_auc": broc,
               "scale_pos_weight": float(spw)},
              open(f"{out}/meta.json", "w"), indent=2)
    print(f"saved -> {out}/model.json, features.json, meta.json")


if __name__ == "__main__":
    main(sys.argv[1])
