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

## Frontend: Manish

**Building**
- "Build the frontend for every API assigned to me in API contract sections 3 to 7, but first check the strategy and execution plan."
- "Start building the frontend."
- "Read the backend URL from import.meta.env.VITE_API_URL instead of hard-coding it, and commit package-lock.json, since Docker uses npm ci."
- "Push the whole frontend codebase to code/frontend in the team repo."
- "Fix the hard-coded ₹1,00,000 limit and the mock config key names, verify, and push to the frontend branch."
- "Generate an ER diagram."

**How I verified the output**
- Typecheck and production build passed; a clean `npm ci` installed 205 packages from the lockfile; a build with a different VITE_API_URL contained no `localhost:4000`.
- Mock-mode browser checks: a ₹1,20,000 false positive went to PENDING_MANAGER_APPROVAL; a wrong OTP showed "Incorrect OTP"; Simulate Ex 7 gave STEP_UP (score 30) and Ex 10 gave BLOCK (score 80).
- Fixed: logged-out users saw a blank page instead of the login redirect.
- Fixed: the hard-coded ₹1,00,000 limit. With `false_positive_manager_limit` set to 150000, a ₹1,20,000 false positive closed directly. Mock config matched the real rules JSON (22 keys).
