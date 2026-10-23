# FraudShield – Frontend

React + Vite + TypeScript screens for API_CONTRACT.md sections 3–7 (owner: Manish).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
```

Copy `.env.example` to `.env` if it is missing.

| Variable | Meaning |
|---|---|
| `VITE_API_URL` | **Required.** Backend base URL, e.g. `http://localhost:4000`. Read only from `import.meta.env` (see `src/config.ts`); no hard-coded fallback. Inlined at build time |
| `VITE_USE_MOCKS` | `true`: in-browser mock backend (MSW) built from the contract. `false`: call the real backend |

Switching to Aakarshan's backend: set `VITE_USE_MOCKS=false` and restart `npm run dev`. No code changes.

## Docker

The image installs with `npm ci`, so `package-lock.json` must stay committed and in sync with `package.json`
(after changing dependencies, run `npm install` and commit both files).

The full stack (db, ml, backend, frontend) runs from `code/`:

```bash
docker compose up --build    # app on http://localhost:5173
```

`code/docker-compose.yml` passes `VITE_API_URL` as a build arg; the Dockerfile has no default and always builds with
`VITE_USE_MOCKS=false`. `VITE_API_URL` is the URL the **browser** calls, so use the host-reachable backend address,
not a Docker service name.

## Demo logins (password `demo123`)

`analyst1`, `analyst2`, `manager1`, `manager2`, and any cardholder `username` from customers.csv.
In mock mode the cardholder is `ravi.sharma` (cards C1007, C1005) and `priya.nair` (C1009, C1010, C1002).

## Screens → APIs

| Route | Role | Calls |
|---|---|---|
| `/login` | all | `POST /api/auth/login`, `GET /api/auth/me` |
| `/cardholder` | CARDHOLDER | `GET /api/me/cards`, `GET /api/me/transactions`, `GET /api/me/stepups/pending` (poll 5 s), `POST /api/me/stepups/:txn_id/respond`, `POST /api/me/cards/:card_id/block` |
| `/analyst` | ANALYST, MANAGER (read) | `GET /api/alerts` (poll 5 s) |
| `/analyst/alerts/:id` | ANALYST, MANAGER | `GET /api/alerts/:id`, `POST …/claim`, `POST …/close`, `POST …/decision` (manager) |
| `/manager` | MANAGER | `GET /api/dashboard` |
| `/manager/approvals` | MANAGER | `GET /api/alerts?status=PENDING_MANAGER_APPROVAL`, `POST /api/alerts/:id/decision` |
| `/manager/audit` | MANAGER | `GET /api/audit`, `GET /api/audit/export` |
| `/manager/config` | MANAGER | `GET /api/config`, `PUT /api/config/:key` |
| `/simulate` | ANALYST, MANAGER | `POST /api/simulate` |

## Layout

```
src/
  api/        types.ts (contract types) · client.ts (axios, JWT, error format) · endpoints.ts (one fn per API)
  auth/       AuthContext (login, /me on reload, logout on 401) · RoleGuard
  components/ ui.tsx · badges.tsx · SlaTimer.tsx · Toast.tsx · Layout.tsx
  lib/        format.ts (₹, IST dates) · configRules.ts (config checks the backend doesn't do yet)
  mocks/      MSW mock backend: db.ts (seed data) · engine.ts (rules R1–R13 copy) · handlers.ts
  pages/      Login · cardholder/ · analyst/ · manager/ · Simulate
```

## Notes

- Cardholders only ever see `status` and `message`, never reason codes or scores.
- `sla_breached` comes from the backend; the UI only shows the countdown.
- In mock mode the step-up OTP is printed in the **browser** console (the seeded step-up uses `123456`).
  With the real backend it is in the **backend** console log.
- Mock data resets on every page reload.
