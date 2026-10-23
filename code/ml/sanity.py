import pandas as pd, sys
DATA = sys.argv[1]
df = pd.read_csv(f"{DATA}/case_01_labelled_transactions_V1.0.csv", dtype={"mcc": str})
print("shape:", df.shape)
print("columns:", list(df.columns))
print()
print("is_fraud rate: %.4f%%  (%d positives)" % (100*df.is_fraud.mean(), df.is_fraud.sum()))
print("txn_ts range:", df.txn_ts.min(), "->", df.txn_ts.max())
print()
ts = pd.to_datetime(df.txn_ts)
tr = ts < "2026-01-01"
print("train rows: %d  (fraud %.4f%%)" % (tr.sum(), 100*df.loc[tr,"is_fraud"].mean()))
print("test  rows: %d  (fraud %.4f%%)" % ((~tr).sum(), 100*df.loc[~tr,"is_fraud"].mean()))
print()
print("--- nulls per column ---")
n = df.isna().sum()
print(n[n > 0] if (n > 0).any() else "none")
print()
print("amount_to_avg30_ratio dtype:", df.amount_to_avg30_ratio.dtype,
      "| nulls:", int(df.amount_to_avg30_ratio.isna().sum()),
      "| zeros:", int((df.amount_to_avg30_ratio == 0).sum()))
print()
for c in ["card_type","channel","mcc","mcc_category","merchant_risk","city_tier",
          "is_international","country_risk_high","new_merchant_flag"]:
    v = df[c].unique()
    print(f"{c:24s} n={len(v):3d}  {sorted(map(str,v))[:10]}")
