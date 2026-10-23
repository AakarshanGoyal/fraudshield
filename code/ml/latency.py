"""p95 latency of /score, and parity against real labelled rows (Aakarshan's check)."""
import json, sys, time
import numpy as np, pandas as pd, requests
from sklearn.metrics import average_precision_score
from common import load_labelled, split_out_of_time, FEATURES

URL = "http://127.0.0.1:8000/score"
df = split_out_of_time(load_labelled(sys.argv[1]))[1]       # test period only
sample = df.sample(300, random_state=42)

def payload(r):
    d = {}
    for f in FEATURES:
        v = r[f]
        if f == "amount_to_avg30_ratio" and (pd.isna(v)):
            d[f] = None
        elif f in ("mcc",):
            d[f] = str(v)
        elif f in ("card_type","channel","mcc_category","merchant_risk"):
            d[f] = str(v)
        elif f in ("amount","distance_from_home_km","amount_to_avg30_ratio"):
            d[f] = float(v)
        else:
            d[f] = int(v)
    return d

# warm up (first SHAP call JITs)
requests.post(URL, json=payload(sample.iloc[0]))

lat, scores = [], []
for _, r in sample.iterrows():
    t = time.perf_counter()
    resp = requests.post(URL, json=payload(r))
    lat.append((time.perf_counter() - t) * 1000)
    scores.append(resp.json()["fraud_score"])

lat = np.array(lat)
print(f"requests        : {len(lat)}")
print(f"latency  mean   : {lat.mean():6.1f} ms")
print(f"         p50    : {np.percentile(lat,50):6.1f} ms")
print(f"         p95    : {np.percentile(lat,95):6.1f} ms   (budget 150 ms, incl. HTTP)")
print(f"         p99/max : {np.percentile(lat,99):6.1f} / {lat.max():6.1f} ms")
pr = average_precision_score(sample.is_fraud.values, scores)
print(f"served PR-AUC on these 300 rows: {pr:.4f}  (sanity: scores track is_fraud)")
