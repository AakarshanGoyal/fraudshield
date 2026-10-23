# FraudShield ML service (Dev) - API Contract Section 8
FROM python:3.12-slim

WORKDIR /app

# deps first, for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# service code + the trained model artifacts
COPY common.py explain.py serve.py ./
COPY model/ ./model/

EXPOSE 8000

# one worker: the model + SHAP explainer load once at import
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "8000"]
