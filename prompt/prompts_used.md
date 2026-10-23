# Prompts used — FraudShield

## ML: Dev

**Building**
- "Build my ML side for Section 8: the FastAPI /score service, the XGBoost model, and the AI reports."
- "Work out the exact parameters /score should take straight from the case document."
- "Integrate our team's GitHub repo and push my ML code into code/ml."
- "Create a balanced synthetic dataset of similar size and test the model on it."
- "Stress-test the model on brand-new, from-scratch transactions and compare against the evaluation report."

**How I verified the output**
- Trained XGBoost (out-of-time split, seed 42): test PR-AUC 0.6474 vs rules baseline 0.1329 = 4.87x, beating the 2x target; ROC-AUC 0.9186.
- Measured /score latency at p95 ~41 ms against the 150 ms budget, and added a startup warm-up so the first request is 36 ms.
- Caught and fixed a bug: the backend sends null mcc_category/merchant_risk/distance, which made /score return 422/500; made those fields optional and null-safe, so every payload returns 200.
- Verified end-to-end with the backend: batch run matched 150/150 decisions and 24/24 alerts, with 7 correct model ratchet decisions and zero ML-unavailable warnings.
