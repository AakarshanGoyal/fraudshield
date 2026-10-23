"""AI-4 second detector: Isolation Forest (unsupervised).

Trained on the same out-of-time split as the XGBoost model. Labels are used ONLY
for evaluation, never for fitting (true to the unsupervised requirement). The raw
anomaly score is normalised to [0,1] using training percentiles so it can sit next
to the XGBoost fraud_score on the alert screen.

Saves model/iso_model.pkl and model/iso_meta.json.
Reference target (AI-4): Isolation Forest ROC-AUC above the baseline ROC-AUC.
"""
import json, sys
import numpy as np
import joblib
from sklearn.ensemble import IsolationForest
from sklearn.metrics import average_precision_score, roc_auc_score

from common import load_labelled, split_out_of_time, prepare_iso, SEED

DATA = sys.argv[1] + "/data" if len(sys.argv) > 1 else "../../data"
MODEL_DIR = "model"
CATEGORIES = json.load(open(f"{MODEL_DIR}/features.json"))["categories"]

df = load_labelled(DATA)
train, test = split_out_of_time(df)
Xtr = prepare_iso(train, CATEGORIES)
Xte = prepare_iso(test, CATEGORIES)
yte = test.is_fraud.values

# 50 trees keeps single-row scoring well inside the 150 ms budget on the live path.
iso = IsolationForest(n_estimators=50, max_samples=256, contamination="auto",
                      random_state=SEED, n_jobs=-1)
iso.fit(Xtr)                              # unsupervised: no labels

raw_tr = -iso.score_samples(Xtr)          # higher = more anomalous
lo, hi = float(np.percentile(raw_tr, 1)), float(np.percentile(raw_tr, 99))

def norm(raw):
    return np.clip((raw - lo) / (hi - lo + 1e-9), 0.0, 1.0)

iso_score = norm(-iso.score_samples(Xte))
pr = average_precision_score(yte, iso_score)
roc = roc_auc_score(yte, iso_score)

BASE_ROC, BASE_PR = 0.7155, 0.1329
XGB_ROC, XGB_PR = 0.9186, 0.6474

print("=" * 58)
print("AI-4  ISOLATION FOREST  (test period, labels for eval only)")
print("=" * 58)
print(f"  Isolation Forest : ROC-AUC {roc:.4f}   PR-AUC {pr:.4f}")
print(f"  baseline (rules) : ROC-AUC {BASE_ROC:.4f}   PR-AUC {BASE_PR:.4f}")
print(f"  XGBoost (AI-1)   : ROC-AUC {XGB_ROC:.4f}   PR-AUC {XGB_PR:.4f}")
print(f"  AI-4 target (IF ROC > baseline ROC): "
      f"{'PASS' if roc > BASE_ROC else 'FAIL'} ({roc:.4f} vs {BASE_ROC:.4f})")
print("=" * 58)

joblib.dump(iso, f"{MODEL_DIR}/iso_model.pkl")
json.dump({"norm_lo": lo, "norm_hi": hi, "n_estimators": 50,
           "test_roc_auc": roc, "test_pr_auc": pr},
          open(f"{MODEL_DIR}/iso_meta.json", "w"), indent=2)
print(f"saved {MODEL_DIR}/iso_model.pkl + iso_meta.json")
