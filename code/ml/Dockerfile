# Dev's ML service (FastAPI). Assumes code/ml has:
#   requirements.txt   (fastapi, uvicorn, xgboost, scikit-learn, shap, pandas, ...)
#   serve.py           with a FastAPI object named `app`
#   the saved model files that serve.py loads
# If the file or object names differ, change the CMD line only.
FROM python:3.11-slim

# libgomp is needed by xgboost / lightgbm wheels on slim images
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "8000"]
