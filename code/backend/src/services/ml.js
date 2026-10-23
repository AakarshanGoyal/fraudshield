// Calls Dev's ML service (POST {ML_URL}/score). Never throws:
// on error or timeout (model_timeout_ms, default 150) it returns MODEL_UNAVAILABLE and the rules decision stands.
// If ML_URL is not set, a stub score is used so the backend can run before the model is ready.

async function score(features, cfg) {
  const base = process.env.ML_URL;
  if (!base) return { fraud_score: 0.1, top_factors: [], top_features: [], model_version: 'stub', model_status: 'OK' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.model_timeout_ms || 150);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(features),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ML service returned ${res.status}`);
    const body = await res.json();
    const s = Number(body.fraud_score);
    if (!Number.isFinite(s) || s < 0 || s > 1) throw new Error('fraud_score out of range');
    return {
      fraud_score: s,
      top_factors: Array.isArray(body.top_factors) ? body.top_factors.slice(0, 3).map(String) : [], // plain English (UI)
      top_features: Array.isArray(body.top_features) ? body.top_features.slice(0, 3).map(String) : [], // column names (CSV)
      model_version: body.model_version || null,
      model_status: 'OK',
    };
  } catch (e) {
    console.warn(`[ML] unavailable: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
    return { fraud_score: null, top_factors: [], top_features: [], model_version: null, model_status: 'MODEL_UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { score };
