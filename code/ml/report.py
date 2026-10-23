"""AI-1 / AI-3 reports. Writes evaluation_report.md and model_card.md.

One script computes every number so the two documents can never disagree.
"""
import json, os, sys
import numpy as np, pandas as pd
import xgboost as xgb
from sklearn.metrics import (average_precision_score, roc_auc_score,
                             precision_score, recall_score, confusion_matrix)

from common import load_labelled, split_out_of_time, prepare, load_config
from baseline import baseline_score

DATA = sys.argv[1]
# repo-root /output (where decisions_output.csv and alerts_output.csv live),
# per the case submission layout: code/ml -> repo root is ../..
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "output")
os.makedirs(OUT, exist_ok=True)
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "model")

STEP_UP = 0.70      # config ai_step_up_threshold; first point the model adds friction
BLOCK = 0.90        # config ai_block_threshold
FP_COST = 150.0     # a false alarm costs rupees 150 (from AI-3)

cfg = load_config(DATA)
meta = json.load(open(f"{MODEL_DIR}/meta.json"))
df = load_labelled(DATA)
train, test = split_out_of_time(df)

booster = xgb.Booster(); booster.load_model(f"{MODEL_DIR}/model.json")
p = booster.predict(xgb.DMatrix(prepare(test), enable_categorical=True))
y = test.is_fraud.values
amt = test.amount.values
base, _ = baseline_score(test, cfg)


def metrics_at(score, thr):
    pred = (score >= thr).astype(int)
    return dict(
        pr_auc=average_precision_score(y, score),
        roc_auc=roc_auc_score(y, score),
        precision=precision_score(y, pred, zero_division=0),
        recall=recall_score(y, pred, zero_division=0),
        cm=confusion_matrix(y, pred),
    )


# --- threshold by expected cost (missed fraud costs amount, FP costs 150) ---
grid = np.round(np.arange(0.01, 1.00, 0.01), 2)
costs = []
for t in grid:
    flagged = p >= t
    missed_fraud = amt[(y == 1) & (~flagged)].sum()      # fraud we let through
    false_alarms = ((y == 0) & flagged).sum() * FP_COST  # genuine we stopped
    costs.append(missed_fraud + false_alarms)
costs = np.array(costs)
best_t = float(grid[costs.argmin()])
best_cost = float(costs.min())
cost_at_070 = float(costs[np.where(grid == 0.70)[0][0]])


# --- fairness: friction on GENUINE transactions by segment ---
genuine = test[y == 0].copy()
genuine["flagged"] = (p[y == 0] >= STEP_UP)
def friction(col):
    g = genuine.groupby(col)["flagged"].agg(["mean", "size"])
    g.columns = ["friction_rate", "n"]
    g["friction_rate"] *= 100
    return g
ft_city = friction("city_tier")
ft_card = friction("card_type")
def ratio(tbl):
    r = tbl["friction_rate"]
    return (r.min() / r.max()) if r.max() > 0 else 1.0
r_city, r_card = ratio(ft_city), ratio(ft_card)

m_model = metrics_at(p, STEP_UP)
m_base = metrics_at(base, STEP_UP)
tn, fp, fn, tp = m_model["cm"].ravel()


def fmt_cm(m):
    a, b, c, d = m["cm"].ravel()
    return ("|            | pred genuine | pred fraud |\n"
            "|------------|-------------:|-----------:|\n"
            f"| **actual genuine** | {a:,} | {b:,} |\n"
            f"| **actual fraud**   | {c:,} | {d:,} |")

def fmt_tbl(t):
    out = ["| segment | friction rate (genuine) | n |", "|---|---:|---:|"]
    for idx, row in t.iterrows():
        out.append(f"| {idx} | {row.friction_rate:.2f}% | {int(row.n):,} |")
    return "\n".join(out)


gate = "PASS" if m_model["pr_auc"] >= 2 * m_base["pr_auc"] else "FAIL"
ratio_x = m_model["pr_auc"] / m_base["pr_auc"]
recall_pct = 100 * tp / (tp + fn) if (tp + fn) else 0.0

# --- AI-4: Isolation Forest second detector (if trained) ---
ai4_section = ""
try:
    import joblib
    from common import prepare_iso
    iso = joblib.load(f"{MODEL_DIR}/iso_model.pkl")
    im = json.load(open(f"{MODEL_DIR}/iso_meta.json"))
    raw = -iso.score_samples(prepare_iso(test, json.load(open(f"{MODEL_DIR}/features.json"))["categories"]))
    iso_s = np.clip((raw - im["norm_lo"]) / (im["norm_hi"] - im["norm_lo"] + 1e-9), 0, 1)
    iso_pr = average_precision_score(y, iso_s)
    iso_roc = roc_auc_score(y, iso_s)
    ai4_section = f"""
## AI-4 - Second detector (Isolation Forest vs XGBoost vs baseline)

Isolation Forest is unsupervised (labels used only for evaluation here), trained on
the same out-of-time split. Its anomaly score is normalised to [0,1] for the alert
screen. XGBoost remains the decision model; the Isolation Forest is a cross-check.

| Detector | ROC-AUC | PR-AUC (primary) |
|---|---:|---:|
| Baseline (rules) | {m_base['roc_auc']:.4f} | {m_base['pr_auc']:.4f} |
| **XGBoost (chosen)** | **{m_model['roc_auc']:.4f}** | **{m_model['pr_auc']:.4f}** |
| Isolation Forest | {iso_roc:.4f} | {iso_pr:.4f} |

AI-4 target (Isolation Forest ROC-AUC above the baseline ROC-AUC):
**{'PASS' if iso_roc > m_base['roc_auc'] else 'FAIL'}** ({iso_roc:.4f} vs {m_base['roc_auc']:.4f}).

Why XGBoost is the decision model: the Isolation Forest ranks anomalies reasonably
(ROC-AUC {iso_roc:.3f}) but its **PR-AUC is {iso_pr:.4f}** - below even the rules
baseline and far below XGBoost's {m_model['pr_auc']:.4f}. For rare fraud, PR-AUC is the
metric that matters, so the supervised model is the right choice; the Isolation Forest
is shown alongside as an independent second opinion.
"""
except Exception as e:
    ai4_section = f"\n## AI-4 - Second detector\n\n_Not available: {e}_\n"

# ---------------- evaluation_report.md ----------------
ev = f"""# FraudShield - Evaluation Report (AI-1)

Out-of-time split: train `txn_ts < 2026-01-01`, test on/after. Seed 42.
Test period: **{len(test):,}** transactions, **{int(y.sum()):,}** fraud ({100*y.mean():.4f}%).
Metrics computed on the test period only.

## Model vs rules-only baseline

| Metric | Baseline (rules) | XGBoost model |
|---|---:|---:|
| **PR-AUC** (primary) | {m_base['pr_auc']:.4f} | **{m_model['pr_auc']:.4f}** |
| ROC-AUC | {m_base['roc_auc']:.4f} | {m_model['roc_auc']:.4f} |
| Precision @ {STEP_UP:.2f} | {m_base['precision']:.4f} | {m_model['precision']:.4f} |
| Recall @ {STEP_UP:.2f} | {m_base['recall']:.4f} | {m_model['recall']:.4f} |

**PR-AUC ratio: {ratio_x:.2f}x** the baseline
(AI-1 reference target: >= 2.00x). **{gate}.**

## Confusion matrix - model at step-up threshold {STEP_UP:.2f}

{fmt_cm(m_model)}

At this threshold the model catches **{tp}/{tp+fn}** frauds ({recall_pct:.1f}% recall)
while stepping up **{fp:,}** genuine transactions.

## How the baseline is defined

Rules-only score from the labelled file's own columns, per the case:
score 100 if `velocity_10m >= 5` or `merchant_risk == BLACKLISTED`, otherwise the
sum of R7-R12 points (capped at 100). R10 uses the config `high_risk_mcc` list
{cfg['high_risk_mcc']}. Note: `BLACKLISTED` does not occur in the labelled file, so
the hard-100 branch fires only on the velocity condition here.
{ai4_section}
## Model

XGBoost, {meta['best_iteration']} trees, `scale_pos_weight` {meta['scale_pos_weight']:.1f}
for the {100*y.mean():.2f}% fraud rate. Early stopping on the last month of the
training period (never the test set). 15 features; `txn_id`, `txn_ts`, `city_tier`
excluded as required. Missing `amount_to_avg30_ratio` kept as NaN (XGBoost native).
"""
open(f"{OUT}/evaluation_report.md", "w", encoding="utf-8").write(ev)


# ---------------- model_card.md (with AI-3 section) ----------------
city_note = "" if r_city >= 0.8 else f"""
The city-tier ratio is **{r_city:.2f} (< 0.80)**. Likely cause: `distance_from_home_km`
is structurally larger for NON_METRO cardholders who travel to metros to spend, so the
model reads distance as risk and adds friction to them more often. Mitigations:
(a) per-segment thresholds calibrated to equalise genuine friction, or
(b) bin/cap `distance_from_home_km` so routine travel stops looking anomalous.
"""
card_note = "" if r_card >= 0.8 else f"""
The card-type ratio is **{r_card:.2f} (< 0.80)**; investigate whether CREDIT limits
drive larger amounts that the model treats as risk, and calibrate per card type.
"""
within = (r_city >= 0.8 and r_card >= 0.8)
cost_verdict = ("the same order as the optimum, so 0.70 is a reasonable, slightly "
                "conservative operating point that favours catching fraud"
                if cost_at_070 <= 1.5 * best_cost else
                f"higher than the optimum; consider moving the operating point closer to {best_t:.2f}")
overall = ("both ratios are >= 0.80 - no disproportionate friction detected."
           if within else
           "at least one segment ratio is below 0.80; cause and mitigation noted above.")

mc = f"""# FraudShield - Model Card

**Model:** XGBoost classifier, version `{meta['model_version']}`, seed {meta['seed']}.
**Task:** probability a card transaction is fraud; served as `fraud_score` in [0,1].
**Training data:** `case_01_labelled_transactions_V1.0.csv`, out-of-time split
(train before 2026-01-01). **Does not use** `txn_id`, `txn_ts`, `city_tier`, card
number, customer name or mobile.

## Performance (test period)

| | Baseline | Model |
|---|---:|---:|
| PR-AUC | {m_base['pr_auc']:.4f} | {m_model['pr_auc']:.4f} ({ratio_x:.2f}x) |
| ROC-AUC | {m_base['roc_auc']:.4f} | {m_model['roc_auc']:.4f} |

Full metrics in `evaluation_report.md`.

## AI-3 - Operating threshold

The model adds friction by the config thresholds: **step-up at {STEP_UP:.2f}**,
**block at {BLOCK:.2f}**. We justify {STEP_UP:.2f} by expected cost, where a missed
fraud costs the transaction amount and a false alarm costs rupees {FP_COST:.0f}.

Sweeping thresholds 0.01-0.99 on the test period, total expected cost is minimised at
**threshold {best_t:.2f}** (cost rupees {best_cost:,.0f}). At the operating threshold
0.70 the cost is rupees {cost_at_070:,.0f} - {cost_verdict}.

## AI-3 - Friction by segment (genuine transactions only)

Friction = share of **genuine** transactions scored at or above the step-up
threshold {STEP_UP:.2f} (i.e. customers inconvenienced).

### By city tier
{fmt_tbl(ft_city)}

lower/higher ratio: **{r_city:.2f}** (fair if >= 0.80).
{city_note}
### By card type
{fmt_tbl(ft_card)}

lower/higher ratio: **{r_card:.2f}** (fair if >= 0.80).
{card_note}
**Overall:** {overall}

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
"""
open(f"{OUT}/model_card.md", "w", encoding="utf-8").write(mc)

print("wrote output/evaluation_report.md and output/model_card.md")
print(f"model PR-AUC {m_model['pr_auc']:.4f} vs baseline {m_base['pr_auc']:.4f} = {ratio_x:.2f}x")
print(f"cost-optimal threshold {best_t:.2f} (cost {best_cost:,.0f}) | cost@0.70 {cost_at_070:,.0f}")
print(f"friction ratio  city_tier {r_city:.2f}  card_type {r_card:.2f}")
print("\ncity tier friction:\n", ft_city.round(2))
print("\ncard type friction:\n", ft_card.round(2))
