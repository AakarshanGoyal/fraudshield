// OpenAPI 3 spec for the FraudShield backend. Served at /api/docs (Swagger UI) and /api/openapi.json.
// `npm run docs` also writes it to /output/design/openapi.json for the submission.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, example) => ({ content: { 'application/json': { schema, ...(example ? { example } : {}) } } });
const ok = (description, schema, example) => ({ description, ...json(schema, example) });
const err = (description) => ({ description, ...json(ref('Error')) });
const E = {
  400: err('Body is not valid JSON'), 401: err('Missing or invalid token / API key'), 403: err('Wrong role, not your data, or same maker and checker'),
  404: err('Not found'), 409: err('Already claimed / already changed by someone else'), 422: err('Validation failed; `fields` lists each problem'),
};
const pick = (...codes) => Object.fromEntries(codes.map((c) => [c, E[c]]));
const bearer = [{ bearerAuth: [] }];
const idParam = (name, description, example) => ({ name, in: 'path', required: true, description, schema: { type: 'string' }, example });

const TXN_EXAMPLE = {
  txn_id: 'T200000007', card_id: 'C1007', txn_ts: '2026-03-04T14:05:00+05:30', amount: 15000.0, currency: 'INR',
  merchant_id: 'M00451', mcc: '5732', channel: 'ECOM', txn_city: 'Mumbai', txn_country: 'IN',
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'FraudShield API',
    version: '1.0.0',
    description: [
      'Real-time card transaction fraud detection for Kaveri National Bank (HCL BFSI hackathon, use case 01).',
      '',
      '**Decision path:** validate → idempotency on `txn_id` → lock the card row → features → rules R1–R13 (thresholds from the config table) → ML fraud score (can only make a decision stricter; 150 ms timeout, falls back to rules) → save + audit → response.',
      '',
      '**Auth:** the gateway uses `x-api-key`; people log in with `POST /api/auth/login` and send `Authorization: Bearer <token>`.',
      'Demo users (password `demo123`): `analyst1`, `analyst2`, `manager1`, `manager2`, and every `username` in customers.csv (cardholders).',
      '',
      'All times are ISO-8601 with the IST offset (+05:30). Money is INR with 2 decimals. Full card numbers never appear anywhere.',
    ].join('\n'),
  },
  servers: [{ url: 'http://localhost:4000' }],
  tags: [
    { name: 'Gateway', description: 'Card network side (API key only)' },
    { name: 'Auth' },
    { name: 'Cardholder', description: 'Role CARDHOLDER, own data only' },
    { name: 'Alerts', description: 'Analyst queue and manager approvals' },
    { name: 'Manager', description: 'Dashboard, audit trail, rule configuration (role MANAGER)' },
    { name: 'Demo' },
    { name: 'System' },
  ],
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'GATEWAY_API_KEY from .env' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object', required: ['error'],
        properties: { error: { type: 'object', required: ['code', 'message'], properties: {
          code: { type: 'string', enum: ['VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'INTERNAL_ERROR'] },
          message: { type: 'string' },
          fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'field name → problem' },
        } } },
        example: { error: { code: 'VALIDATION_ERROR', message: 'Invalid input', fields: { amount: 'must be > 0' } } },
      },
      ReasonCode: { type: 'string', enum: [
        'CARD_NOT_ACTIVE', 'INTL_NOT_ENABLED', 'MERCHANT_BLACKLISTED', 'DAILY_LIMIT_EXCEEDED', 'VELOCITY_BURST', 'IMPOSSIBLE_TRAVEL',
        'HIGH_VELOCITY', 'AMOUNT_SPIKE', 'HIGH_RISK_GEO', 'HIGH_RISK_MCC', 'ODD_HOUR_HIGH_VALUE', 'NEW_MERCHANT_HIGH_VALUE',
        'MULTIPLE_RED_FLAGS', 'HIGH_FRAUD_SCORE_MODEL', 'STEP_UP_DENIED', 'STEP_UP_TIMEOUT'] },
      Decision: { type: 'string', enum: ['APPROVE', 'STEP_UP', 'BLOCK'] },
      TxnStatus: { type: 'string', enum: ['RECEIVED', 'STEP_UP_PENDING', 'APPROVED', 'BLOCKED'] },
      AlertStatus: { type: 'string', enum: ['OPEN', 'IN_REVIEW', 'PENDING_MANAGER_APPROVAL', 'CONFIRMED_FRAUD', 'FALSE_POSITIVE'] },
      Priority: { type: 'string', enum: ['HIGH', 'MEDIUM'] },
      TransactionRequest: {
        type: 'object',
        required: ['txn_id', 'card_id', 'txn_ts', 'amount', 'merchant_id', 'mcc', 'channel', 'txn_city', 'txn_country'],
        properties: {
          txn_id: { type: 'string', pattern: '^T[0-9]{9}$' },
          card_id: { type: 'string', description: 'Must exist' },
          txn_ts: { type: 'string', format: 'date-time', description: 'ISO-8601 with offset, e.g. 2026-03-04T14:05:00+05:30' },
          amount: { type: 'number', exclusiveMinimum: true, minimum: 0, maximum: 1000000, multipleOf: 0.01 },
          currency: { type: 'string', enum: ['INR'], default: 'INR' },
          merchant_id: { type: 'string', description: 'Must exist' },
          mcc: { type: 'string', pattern: '^[0-9]{4}$' },
          channel: { type: 'string', enum: ['POS', 'ECOM', 'ATM', 'CONTACTLESS'] },
          txn_city: { type: 'string', description: 'Must exist in cities' },
          txn_country: { type: 'string', description: "Must be the city's country" },
        },
        example: TXN_EXAMPLE,
      },
      DecisionResponse: {
        type: 'object',
        properties: {
          txn_id: { type: 'string' },
          decision: { ...ref('Decision'), description: 'Rules only' },
          final_decision: { ...ref('Decision'), description: 'After the ML score (never softer than `decision`)' },
          reason_codes: { type: 'array', items: ref('ReasonCode'), description: 'Rule order; MULTIPLE_RED_FLAGS last' },
          rule_risk_score: { type: 'integer', nullable: true, description: 'Empty on hard stops (R1/R2); 100 when R3–R6 fire' },
          status: ref('TxnStatus'),
          alert_id: { type: 'integer', nullable: true },
          processed_at: { type: 'string', format: 'date-time' },
          fraud_score: { type: 'number', nullable: true, minimum: 0, maximum: 1 },
          top_factors: { type: 'array', items: { type: 'string' }, description: 'Top 3 reasons in plain English' },
          model_status: { type: 'string', enum: ['OK', 'MODEL_UNAVAILABLE'] },
        },
        example: { txn_id: 'T200000007', decision: 'STEP_UP', final_decision: 'STEP_UP', reason_codes: ['AMOUNT_SPIKE'], rule_risk_score: 30,
          status: 'STEP_UP_PENDING', alert_id: null, processed_at: '2026-10-23T14:05:00+05:30', fraud_score: 0.412,
          top_factors: ["amount 6.3x the card's 30-day average", 'online payment', 'electronics merchant'], model_status: 'OK' },
      },
      User: {
        type: 'object',
        properties: {
          user_id: { type: 'string' }, username: { type: 'string' },
          role: { type: 'string', enum: ['CARDHOLDER', 'ANALYST', 'MANAGER'] },
          customer_id: { type: 'string', nullable: true }, display_name: { type: 'string' },
        },
        example: { user_id: 'U_A1', username: 'analyst1', role: 'ANALYST', customer_id: null, display_name: 'Analyst One' },
      },
      Card: {
        type: 'object',
        properties: {
          card_id: { type: 'string' }, masked_number: { type: 'string', example: 'XXXXXXXXXXXX4821' },
          card_type: { type: 'string', enum: ['DEBIT', 'CREDIT'] }, card_status: { type: 'string', enum: ['ACTIVE', 'BLOCKED', 'EXPIRED'] },
          expiry_date: { type: 'string', format: 'date' }, daily_limit: { type: 'number' }, international_enabled: { type: 'boolean' },
        },
      },
      CardholderTransaction: {
        type: 'object',
        properties: {
          txn_id: { type: 'string' }, card_id: { type: 'string' }, txn_ts: { type: 'string', format: 'date-time' }, amount: { type: 'number' },
          merchant_name: { type: 'string' }, channel: { type: 'string' }, txn_city: { type: 'string' }, status: ref('TxnStatus'),
          message: { type: 'string', description: 'Neutral text; rules and scores are never shown to cardholders' },
        },
      },
      PendingStepUp: {
        type: 'object',
        properties: {
          txn_id: { type: 'string' }, card_id: { type: 'string' }, amount: { type: 'number' }, merchant_name: { type: 'string' },
          txn_ts: { type: 'string', format: 'date-time' }, expires_at: { type: 'string', format: 'date-time' },
        },
      },
      AlertListItem: {
        type: 'object',
        properties: {
          alert_id: { type: 'integer' }, txn_id: { type: 'string' }, priority: ref('Priority'), status: ref('AlertStatus'),
          created_at: { type: 'string', format: 'date-time' }, sla_due_at: { type: 'string', format: 'date-time' },
          sla_breached: { type: 'boolean', description: 'Not closed and past sla_due_at' },
          amount: { type: 'number' }, card_id: { type: 'string' }, card_last4: { type: 'string' }, merchant_name: { type: 'string' },
          reason_codes: { type: 'array', items: ref('ReasonCode') }, fraud_score: { type: 'number', nullable: true },
          claimed_by: { type: 'string', nullable: true },
        },
      },
      AlertDetail: {
        type: 'object',
        properties: {
          alert: { type: 'object', properties: {
            alert_id: { type: 'integer' }, priority: ref('Priority'), status: ref('AlertStatus'), sla_due_at: { type: 'string', format: 'date-time' },
            sla_breached: { type: 'boolean' }, claimed_by: { type: 'string', nullable: true }, proposed_by: { type: 'string', nullable: true },
            comment: { type: 'string', nullable: true } } },
          transaction: { type: 'object', properties: {
            txn_id: { type: 'string' }, txn_ts: { type: 'string' }, amount: { type: 'number' }, channel: { type: 'string' },
            merchant_id: { type: 'string' }, merchant_name: { type: 'string' }, mcc: { type: 'string' }, txn_city: { type: 'string' },
            txn_country: { type: 'string' }, status: ref('TxnStatus'), decision: ref('Decision'), final_decision: ref('Decision'),
            reason_codes: { type: 'array', items: ref('ReasonCode') }, rule_risk_score: { type: 'integer', nullable: true } } },
          features: { type: 'object', description: 'Values used at decision time', properties: {
            velocity_10m: { type: 'integer', nullable: true }, approved_today: { type: 'number', nullable: true },
            avg_amount_30d: { type: 'number', nullable: true }, speed_kmph: { type: 'number', nullable: true },
            new_merchant: { type: 'boolean', nullable: true } } },
          ai: { type: 'object', properties: {
            fraud_score: { type: 'number', nullable: true }, top_factors: { type: 'array', items: { type: 'string' } },
            model_status: { type: 'string' }, model_version: { type: 'string', nullable: true } } },
          card: { type: 'object', properties: {
            card_id: { type: 'string' }, masked_number: { type: 'string' }, card_type: { type: 'string' }, card_status: { type: 'string' },
            home_city: { type: 'string' }, daily_limit: { type: 'number' } } },
          recent_transactions: { type: 'array', items: { type: 'object', properties: {
            txn_id: { type: 'string' }, txn_ts: { type: 'string' }, amount: { type: 'number' }, txn_city: { type: 'string' }, status: { type: 'string' } } } },
          narrative: { type: 'string', nullable: true, description: 'Optional AI-generated summary' },
        },
      },
      Comment: { type: 'string', minLength: 10 },
      AuditRow: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, entity: { type: 'string', enum: ['TRANSACTION', 'ALERT', 'CARD', 'CONFIG'] }, entity_id: { type: 'string' },
          actor: { type: 'string' }, role: { type: 'string' }, ts: { type: 'string', format: 'date-time' }, action: { type: 'string' },
          from_status: { type: 'string', nullable: true }, to_status: { type: 'string', nullable: true }, comment: { type: 'string', nullable: true },
          before: { type: 'object', nullable: true }, after: { type: 'object', nullable: true },
        },
      },
      Dashboard: {
        type: 'object',
        properties: {
          transactions_by_decision: { type: 'object', properties: { APPROVE: { type: 'integer' }, STEP_UP: { type: 'integer' }, BLOCK: { type: 'integer' } } },
          block_rate: { type: 'number' }, step_up_rate: { type: 'number' },
          open_alerts_by_priority: { type: 'object', properties: { HIGH: { type: 'integer' }, MEDIUM: { type: 'integer' } } },
          sla_breaches: { type: 'integer' },
          false_positive_rate: { type: 'number', description: 'FALSE_POSITIVE ÷ closed alerts' },
          top_reason_codes: { type: 'array', maxItems: 5, items: { type: 'object', properties: { code: ref('ReasonCode'), count: { type: 'integer' } } } },
        },
      },
      ConfigEntry: { type: 'object', properties: { key: { type: 'string' }, value: {}, updated_at: { type: 'string', format: 'date-time' } } },
    },
  },
  paths: {
    '/api/v1/authorisations': {
      post: {
        tags: ['Gateway'], summary: 'Decide a card transaction', security: [{ apiKey: [] }],
        description: 'Idempotent on `txn_id`: a repeat returns the original response and creates nothing. Transactions on the same card are serialised so velocity counts stay correct. STEP_UP writes a simulated OTP to the server log.',
        requestBody: { required: true, ...json(ref('TransactionRequest')) },
        responses: { 200: ok('Decision', ref('DecisionResponse')), ...pick(400, 401, 422) },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Log in',
        requestBody: { required: true, ...json({ type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' } } }, { username: 'analyst1', password: 'demo123' }) },
        responses: { 200: ok('JWT + user', { type: 'object', properties: { token: { type: 'string' }, user: ref('User') } }), ...pick(401, 422) },
      },
    },
    '/api/auth/me': {
      get: { tags: ['Auth'], summary: 'Current user', security: bearer, responses: { 200: ok('User', ref('User')), ...pick(401) } },
    },
    '/api/me/cards': {
      get: { tags: ['Cardholder'], summary: 'My cards', security: bearer, responses: { 200: ok('Cards', { type: 'array', items: ref('Card') }), ...pick(401, 403) } },
    },
    '/api/me/transactions': {
      get: {
        tags: ['Cardholder'], summary: 'My transactions, newest first', security: bearer,
        parameters: [
          { name: 'card_id', in: 'query', schema: { type: 'string' }, description: 'Optional; must be your card (else 403)' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
        responses: { 200: ok('Transactions', { type: 'array', items: ref('CardholderTransaction') }), ...pick(401, 403) },
      },
    },
    '/api/me/stepups/pending': {
      get: { tags: ['Cardholder'], summary: '"Was this you?" requests waiting for me', security: bearer,
        responses: { 200: ok('Pending step-ups', { type: 'array', items: ref('PendingStepUp') }), ...pick(401, 403) } },
    },
    '/api/me/stepups/{txn_id}/respond': {
      post: {
        tags: ['Cardholder'], summary: 'Answer a step-up', security: bearer,
        description: 'CONFIRM with the correct OTP within 15 minutes → APPROVED. NOT_ME → BLOCKED (STEP_UP_DENIED), card blocked, HIGH alert.',
        parameters: [idParam('txn_id', 'Transaction id', 'T200000007')],
        requestBody: { required: true, ...json({ type: 'object', required: ['response'], properties: {
          response: { type: 'string', enum: ['CONFIRM', 'NOT_ME'] }, otp: { type: 'string', pattern: '^[0-9]{6}$', description: 'Required for CONFIRM' } } },
        { response: 'CONFIRM', otp: '482913' }) },
        responses: {
          200: ok('New status', { type: 'object', properties: { txn_id: { type: 'string' }, status: ref('TxnStatus'), message: { type: 'string' } } }),
          ...pick(401, 403, 404), 409: err('Expired or already answered'), 422: err('Incorrect OTP or invalid response'),
        },
      },
    },
    '/api/me/cards/{card_id}/block': {
      post: { tags: ['Cardholder'], summary: 'Block my card', security: bearer, parameters: [idParam('card_id', 'Card id', 'C1007')],
        responses: { 200: ok('Blocked', { type: 'object', properties: { card_id: { type: 'string' }, card_status: { type: 'string' } } }), ...pick(401, 403) } },
    },
    '/api/alerts': {
      get: {
        tags: ['Alerts'], summary: 'Alert queue (HIGH first, then earliest SLA)', security: bearer, description: 'Roles ANALYST and MANAGER.',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' }, description: 'Comma-separated, e.g. OPEN,IN_REVIEW' },
          { name: 'priority', in: 'query', schema: { type: 'string' }, description: 'HIGH, MEDIUM or both' },
        ],
        responses: { 200: ok('Alerts', { type: 'array', items: ref('AlertListItem') }), ...pick(401, 403) },
      },
    },
    '/api/alerts/{alert_id}': {
      get: { tags: ['Alerts'], summary: 'Alert detail with features, AI score and card history', security: bearer,
        parameters: [idParam('alert_id', 'Alert id', '1')], responses: { 200: ok('Alert', ref('AlertDetail')), ...pick(401, 403, 404) } },
    },
    '/api/alerts/{alert_id}/claim': {
      post: { tags: ['Alerts'], summary: 'Claim an OPEN alert (ANALYST)', security: bearer, parameters: [idParam('alert_id', 'Alert id', '1')],
        description: 'Locks it to one analyst. If two analysts claim at once, exactly one succeeds; the other gets 409.',
        responses: { 200: ok('Claimed', { type: 'object', properties: { alert_id: { type: 'integer' }, status: ref('AlertStatus'), claimed_by: { type: 'string' } } }), ...pick(401, 403, 404, 409) } },
    },
    '/api/alerts/{alert_id}/close': {
      post: {
        tags: ['Alerts'], summary: 'Close a claimed alert (ANALYST)', security: bearer, parameters: [idParam('alert_id', 'Alert id', '1')],
        description: 'CONFIRMED_FRAUD blocks the card. FALSE_POSITIVE on an amount above ₹1,00,000 goes to PENDING_MANAGER_APPROVAL. Only the claiming analyst can close.',
        requestBody: { required: true, ...json({ type: 'object', required: ['outcome', 'comment'], properties: {
          outcome: { type: 'string', enum: ['CONFIRMED_FRAUD', 'FALSE_POSITIVE'] }, comment: ref('Comment') } },
        { outcome: 'FALSE_POSITIVE', comment: 'Customer confirmed by phone, genuine travel.' }) },
        responses: { 200: ok('New status', { type: 'object', properties: { alert_id: { type: 'integer' }, status: ref('AlertStatus') } }), ...pick(401, 403, 404, 409, 422) },
      },
    },
    '/api/alerts/{alert_id}/decision': {
      post: {
        tags: ['Alerts'], summary: 'Checker decision on a false-positive proposal (MANAGER)', security: bearer, parameters: [idParam('alert_id', 'Alert id', '1')],
        description: 'APPROVE → FALSE_POSITIVE; REJECT → CONFIRMED_FRAUD (card blocked). The proposer cannot decide (403).',
        requestBody: { required: true, ...json({ type: 'object', required: ['decision', 'comment'], properties: {
          decision: { type: 'string', enum: ['APPROVE', 'REJECT'] }, comment: ref('Comment') } },
        { decision: 'APPROVE', comment: 'Reviewed evidence, genuine payment.' }) },
        responses: { 200: ok('New status', { type: 'object', properties: { alert_id: { type: 'integer' }, status: ref('AlertStatus') } }), ...pick(401, 403, 404, 409, 422) },
      },
    },
    '/api/dashboard': {
      get: {
        tags: ['Manager'], summary: 'Fraud dashboard', security: bearer,
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, example: '2026-03-01' },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, example: '2026-03-05' },
        ],
        responses: { 200: ok('Figures', ref('Dashboard')), ...pick(401, 403, 422) },
      },
    },
    '/api/audit': {
      get: {
        tags: ['Manager'], summary: 'Audit trail of one entity, oldest first', security: bearer,
        description: 'Append-only: the database rejects any UPDATE or DELETE on audit rows.',
        parameters: [
          { name: 'entity', in: 'query', required: true, schema: { type: 'string', enum: ['TRANSACTION', 'ALERT', 'CARD', 'CONFIG'] } },
          { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' }, example: 'T200000007' },
        ],
        responses: { 200: ok('Rows', { type: 'array', items: ref('AuditRow') }), ...pick(401, 403, 422) },
      },
    },
    '/api/audit/export': {
      get: {
        tags: ['Manager'], summary: 'Audit trail as CSV', security: bearer,
        parameters: [
          { name: 'entity', in: 'query', required: true, schema: { type: 'string', enum: ['TRANSACTION', 'ALERT', 'CARD', 'CONFIG'] } },
          { name: 'entity_id', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string' } } } }, ...pick(401, 403, 422) },
      },
    },
    '/api/config': {
      get: { tags: ['Manager'], summary: 'All rule configuration values', security: bearer,
        responses: { 200: ok('Config', { type: 'array', items: ref('ConfigEntry') }), ...pick(401, 403) } },
    },
    '/api/config/{key}': {
      put: {
        tags: ['Manager'], summary: 'Change one configuration value', security: bearer,
        description: 'Takes effect on the next decision, no restart. Type and range are checked (e.g. MCCs must be 4-digit strings, AI thresholds 0–1). Audited with before/after values.',
        parameters: [idParam('key', 'Config key', 'velocity_burst_count')],
        requestBody: { required: true, ...json({ type: 'object', required: ['value'], properties: { value: {} } }, { value: 6 }) },
        responses: { 200: ok('Updated', { type: 'object', properties: { key: { type: 'string' }, value: {} } }), ...pick(401, 403, 404, 422) },
      },
    },
    '/api/simulate': {
      post: {
        tags: ['Demo'], summary: 'Simulate a transaction (ANALYST or MANAGER)', security: bearer,
        description: 'Same engine and response as the gateway API. `txn_id` and `txn_ts` may be omitted (generated / now).',
        requestBody: { required: true, ...json(ref('TransactionRequest')) },
        responses: { 200: ok('Decision', ref('DecisionResponse')), ...pick(401, 403, 422) },
      },
    },
    '/health': {
      get: { tags: ['System'], summary: 'Liveness', responses: { 200: ok('OK', { type: 'object', properties: { status: { type: 'string' } } }) } },
    },
  },
};

module.exports = { spec };
