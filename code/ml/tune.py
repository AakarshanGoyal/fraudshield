"""Quantify tuning headroom WITHOUT leaking the test set.

Hyperparameters are selected on the validation slice (last month of the train
period). The test set is touched once, at the end, to report the final number
for the chosen config. Seed fixed at 42 throughout.
"""
import sys, itertools
import numpy as np, pandas as pd
import xgboost as xgb
from sklearn.metrics import average_precision_score

from common import load_labelled, split_out_of_time, prepare, SEED

DATA = sys.argv[1]
df = load_labelled(DATA)
train, test = split_out_of_time(df)
val_cut = pd.Timestamp("2025-12-01", tz="+05:30")
tr = train[train.txn_ts < val_cut]
va = train[train.txn_ts >= val_cut]

Xtr, ytr = prepare(tr), tr.is_fraud.values
Xva, yva = prepare(va), va.is_fraud.values
Xte, yte = prepare(test), test.is_fraud.values
spw = (ytr == 0).sum() / (ytr == 1).sum()

# current production config, as the point of comparison
# (subsample / colsample_bytree are fixed in fit_eval, not tuned here)
CURRENT = dict(max_depth=5, learning_rate=0.05, min_child_weight=5)

# small, sensible grid around it
grid = dict(
    max_depth=[4, 5, 6, 7],
    learning_rate=[0.03, 0.05, 0.08],
    min_child_weight=[3, 5, 10],
)

def fit_eval(params):
    m = xgb.XGBClassifier(
        n_estimators=800, subsample=0.8, colsample_bytree=0.8,
        scale_pos_weight=spw, eval_metric="aucpr", early_stopping_rounds=40,
        enable_categorical=True, tree_method="hist", random_state=SEED, **params)
    m.fit(Xtr, ytr, eval_set=[(Xva, yva)], verbose=False)
    val_pr = average_precision_score(yva, m.predict_proba(Xva)[:, 1])
    return m, val_pr

# baseline: current config, measured on validation
_, cur_val = fit_eval(CURRENT)

results = []
keys = list(grid.keys())
for combo in itertools.product(*grid.values()):
    params = dict(zip(keys, combo))
    _, val_pr = fit_eval(params)
    results.append((val_pr, params))
    print(f"val PR-AUC {val_pr:.4f}  {params}")

results.sort(reverse=True)
best_val, best_params = results[0]

print("\n" + "=" * 60)
print(f"current config   val PR-AUC {cur_val:.4f}  {CURRENT}")
print(f"best on val      val PR-AUC {best_val:.4f}  {best_params}")

# touch the TEST set once, for current and best only
def test_pr(params):
    m, _ = fit_eval(params)
    return average_precision_score(yte, m.predict_proba(Xte)[:, 1]), m.best_iteration

cur_test, cur_it = test_pr(CURRENT)
best_test, best_it = test_pr(best_params)
print("-" * 60)
print(f"current config   TEST PR-AUC {cur_test:.4f}  ({cur_it} trees)")
print(f"tuned config     TEST PR-AUC {best_test:.4f}  ({best_it} trees)")
print(f"gain             {best_test - cur_test:+.4f}  ({100*(best_test/cur_test - 1):+.1f}%)")
print("=" * 60)
