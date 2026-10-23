"""Turn the top SHAP contributors into analyst-readable phrases.

Only features that PUSH the score UP (positive SHAP) are worth naming to an
analyst; a phrase is chosen per feature from the raw value the backend sent.
"""


def _hour_phrase(v):
    try:
        h = int(round(float(v)))
    except (TypeError, ValueError):
        return "unusual transaction hour"
    return f"transaction at {h:02d}:00, outside normal hours" if (0 <= h <= 4) \
        else f"transaction at {h:02d}:00"


# Neutral fallback when the backend could not resolve a value (null).
_UNKNOWN = {
    "distance_from_home_km": "distance from home unknown",
    "merchant_risk": "merchant risk unknown",
    "mcc_category": "merchant category unknown",
    "amount_to_avg30_ratio": "no 30-day spending history on this card",
}


def phrase(feature, value):
    v = value
    if v is None:
        return _UNKNOWN.get(feature, feature)
    if feature == "amount_to_avg30_ratio":
        return f"amount {float(v):.1f}x the card's 30-day average"
    if feature == "amount":
        return f"transaction amount rupees {float(v):,.0f}"
    if feature == "velocity_10m":
        return f"{int(float(v))} payments in the last 10 minutes"
    if feature == "velocity_24h":
        return f"{int(float(v))} payments in the last 24 hours"
    if feature == "distance_from_home_km":
        return f"{float(v):,.0f} km from the card's home city"
    if feature == "local_hour":
        return _hour_phrase(v)
    if feature == "is_international":
        return "international transaction" if float(v) == 1 else "domestic transaction"
    if feature == "country_risk_high":
        return "high-risk country" if float(v) == 1 else "low-risk country"
    if feature == "new_merchant_flag":
        return "first use of this merchant in 90 days" if float(v) == 1 \
            else "a merchant the card has used before"
    if feature == "card_age_days":
        return f"card issued {int(float(v))} days ago"
    if feature == "merchant_risk":
        return f"{str(v).lower()}-risk merchant"
    if feature == "mcc_category":
        return f"{str(v).replace('_', ' ').lower()} merchant category"
    if feature == "channel":
        return {"ECOM": "online payment", "ATM": "ATM withdrawal",
                "POS": "in-store payment",
                "CONTACTLESS": "contactless payment"}.get(str(v), str(v).lower())
    if feature == "card_type":
        return f"{str(v).lower()} card"
    if feature == "mcc":
        return f"merchant category code {v}"
    return feature
