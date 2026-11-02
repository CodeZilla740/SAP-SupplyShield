# SupplyShield — Agentic Control Tower for Resilient Medical Cold-Chains

**SAP Hackfest Bengaluru 2026 · Track 1**

SupplyShield watches a hospital medicine supply network, detects disruptions,
computes their impact, generates recovery scenarios with a five-agent pipeline,
validates every option against deterministic pharmaceutical compliance rules,
and hands the final decision to a human planner. Every step is written to a
hash-chained audit trail.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ React 19 + Vite + Tailwind UI (9 screens, existing visual identity)  │
│ Overview · Network Records · Disruption Monitor · Shipment Intelligence│
│ Inventory & Stock Risk · AI Recovery Planning · Cold-Chain Compliance · │
│ Approval Centre · Execution & Audit Trail                            │
└──────────────────────────────▲───────────────────────────────────────┘
                               │ REST /api/* (vite proxy in dev)
┌──────────────────────────────┴───────────────────────────────────────┐
│ Node.js 20 + Express backend (server/)                               │
│                                                                      │
│  Five-agent orchestrator (server/src/agents/), fixed sequence:       │
│    1 Sensing    — validate & classify disruption events              │
│    2 Impact     — affected shipments/POs, stock cover, shortfall     │
│    3 Scenario   — recovery options (reroute / transfer / wait)       │
│    4 Logistics  — cost + ETA per option from carrier & lane records  │
│    5 Compliance — deterministic rule gate (LLM cannot override)      │
│                                                                      │
│  Rules engine (server/src/rules/):                                   │
│    R1 cold-chain   carrier certified + temperature band matches      │
│    R2 safety stock donor keeps ≥ safety stock after transfer         │
│    R3 deadline     ETA before projected stockout                     │
│                                                                      │
│  Human approval (server/src/services/approval.js):                   │
│    Approve/reject re-validates R1–R3 against live data on the        │
│    server. A failing rule blocks the decision with HTTP 409 —        │
│    even if the AI recommended the option.                            │
│                                                                      │
│  Audit trail (server/src/utils/audit.js):                            │
│    SHA-256 hash-chained, append-only, verifiable via /api/audit.     │
└──────────────────────────────▲───────────────────────────────────────┘
                               │ single async DB facade (all/get/run/exec)
┌──────────────────────────────┴───────────────────────────────────────┐
│ SAP HANA Cloud + HDI (production)        SQLite (ephemeral dev only) │
│ db/schema.cds + db/data/*.csv            CAP development profile     │
│ Existing Express DB facade uses the bound HANA container in prod    │
└──────────────────────────────────────────────────────────────────────┘
```

## Quick start

Requires Node.js ≥ 20.

Before starting the server, generate a unique authentication-signing secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Save the output as `SUPPLYSHIELD_AUTH_SECRET` in `server/.env` (do not commit
that file). Use the same secret for the Express and CAP processes. For local
development, the Vite UI proxies `/api` requests to `http://localhost:4004` by
default. Set `API_PROXY_TARGET` if your backend uses another local address.

```bash
npm run setup        # installs CAP, server, and UI dependencies
npm run build        # builds the React UI into ui/dist
npm start            # serves API + built UI on http://localhost:4004
```

First boot seeds the canonical and regional demo scenarios (clearly labelled
as simulated) and runs the five-agent pipeline for each supported location.
Existing local SQLite databases receive the missing regional rows through an
idempotent seed migration; recovery options are calculated from the linked
inventory, shipment, lane, carrier, and compliance data.

Development mode (hot reload):

```bash
npm run dev:server   # API on :4004
npm run dev:ui       # UI on :5173, proxies /api to :4004
```

## Authorized access

The public landing page is at `/`; the existing control tower is served at
`/app` and requires an authenticated session. Anyone can create a demo account
with a name, email address, and password; no invitation or email verification
is required. New demo accounts receive planner access so the operational
workflow can be demonstrated. To revoke a user's active sessions:

```bash
npm --prefix server run auth -- revoke planner@example.org
```

New passwords are stored as bcrypt hashes. Existing scrypt password hashes
remain verifiable. Sessions use signed, `HttpOnly`, `SameSite=Lax` cookies and
are persisted for revocation; they expire after 12 hours. Production cookies
are `Secure`. The API and CAP service both validate the signed session and
enforce planner authorization for write operations. In local development,
authentication records use a separate SQLite file at
`~/.supplyshield/auth.sqlite`, even though the demo business database is
ephemeral. Set `SUPPLYSHIELD_AUTH_SQLITE_FILE` to change that location.

Run the automated test suite:

```bash
npm test
```

Reset the demo to its initial state at any time:

```bash
curl -X POST http://localhost:4004/api/admin/reseed
```

## CAP data model and HANA deployment

The CAP model in [db/schema.cds](./db/schema.cds) describes the business
entities used by the application plus `pipeline_state`, which coordinates
run-ID allocation and hash-chain appends across CAP and Express writers. The
checked-in files in `db/data/` are
generated from the canonical demo seed and its normal initial analysis,
including the recovery plan and hash-chained audit events. The CSV generator
uses an in-memory SQLite database and never connects to HANA.

CAP is configured to use in-memory SQLite in development and SAP HANA in
production. HANA production requires a binding to the existing Hackfest HDI
container service; this project does not provision a HANA instance or HDI
container. Once the service binding and deployment approval are in place, run
`cds deploy --to hana` from the repository root. CAP compiles the CDS model,
packages the CSV files as HDI table-data artifacts, and deploys the schema and
seed rows through the bound HDI container. Do not run that command against a
container with existing data until its contents have been backed up and the
target migration has been reviewed.

Validate the model and regenerate the canonical CSV snapshot locally with:

```bash
npm run cap:validate
npm run cap:validate:data
npm run cap:seed:generate
```

`cap:validate:data` imports every CSV into an explicitly in-memory SQLite
database, leaving no local database file behind.

## Additional synthetic datasets

The separate [`synthetic-data/`](./synthetic-data/README.md) module generates
a reproducible, validated 136-row snapshot from the canonical simulated seed
and a small set of explicitly labelled scenario assumptions. Agent decisions
remain runtime-derived; the generator does not fabricate recovery outcomes.
See its README for sources, validation, and the insert-only non-production
API import.

The Express application remains the runtime entry point; its production
database facade requires the bound HANA credentials and fails startup rather
than falling back if HANA is unavailable. Its development fallback is an
in-memory SQLite database.

## Configuration

Copy `.env.example` to `server/.env`. Everything is optional — with no
configuration the app runs fully locally. **No credentials are stored in the
repository.**

| Setting | Without it | With it |
| --- | --- | --- |
| `HANA_HOST`, `HANA_USER`, `HANA_PASSWORD` | Ephemeral SQLite, labelled "Local demo database (SQLite fallback – SAP HANA not configured)" | Persists to the bound SAP HANA Cloud HDI container |
| `AICORE_SERVICE_KEY` | Deterministic rule-based briefing, labelled "Rule-based template (SAP Generative AI Hub not configured)" | Explanations via SAP Generative AI Hub orchestration service |
| `S4HANA_BASE_URL`, `S4HANA_API_KEY` | MOCK adapter: EBELN-shaped PO records in the database | Read-only PO verification against live S/4HANA OData |
| `WEATHER_PROVIDER=open-meteo` (default) | Live Open-Meteo feed (no key needed) producing **UNVERIFIED** advisory alerts only | `off` disables it |

On SAP BTP Cloud Foundry the HANA connection is picked up automatically from
`VCAP_SERVICES` — see `deployment/`. The service must be the existing HDI
container binding, not a newly created HANA database instance.

## Honesty labels (what is simulated)

- **All demo records are simulated.** Every API response carries `demo: true`
  while seed data is in use, and the UI footer states which database is active.
- **Weather alerts are advisory.** The Open-Meteo integration can only raise
  *unverified* alerts — a weather alert is never treated as proof that a port
  is closed. The verified demo disruption is a seeded record.
- **Execution is simulated.** Approving a plan records a `TR-SIM-xxxxx`
  reference and an explicit "SIMULATED EXECUTION" note. No real S/4HANA
  inventory or logistics transaction is ever posted.
- **S/4HANA is a mock adapter unless configured** — reported as such by
  `GET /api/integrations/status`.
- **The AI explains, it never overrides.** Compliance rules R1–R3 are pure
  deterministic functions. The LLM (when configured) only writes the
  human-readable briefing and is re-validated like everything else.

## API overview

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Status incl. active database engine and LLM mode |
| `GET /api/integrations/status` | Honest per-integration status |
| `GET /api/overview` | KPIs, network health, alerts, agent ribbon |
| `GET/POST /api/disruptions` · `GET /api/disruptions/:id` | Disruption records |
| `POST /api/disruptions/:id/run-analysis` | Runs the five-agent pipeline |
| `GET /api/shipments` · `GET /api/shipments/:id` | Shipment list + telemetry |
| `GET /api/inventory` | Stock positions, cover hours, transfer math |
| `GET /api/recovery-plans/current?port=...&disruptionId=...` · `GET /api/recovery-plans/:id` | Selected-context plans + scored options (no cross-port fallback) |
| `POST /api/recovery-plans/:id/approve` · `.../reject` | Human decision (server re-validates R1–R3) |
| `GET /api/compliance` | Network compliance, telemetry, batch record, rule results |
| `GET /api/audit` | Hash-chained event log + integrity verification |
| `POST /api/admin/reseed` | Restore the canonical demo scenario |

## The canonical demo scenario

Cyclone Varun closes Chennai Port for 48 h. Shipment SS-2048 with Human
Insulin for St. Martha Hospital is delayed; the hospital has 120 vials against
100 vials/day demand → 28.8 h of cover versus a 48 h delay → 80-vial shortfall.
The pipeline generates three options:

- **Option A — Air rerouting**: 8 h, $4,200 — **rejected by R1** (carrier
  cold-chain certification unverified).
- **Option B — Transfer 240 vials from Bengaluru Warehouse**: 6 h, $1,100 —
  passes R1–R3, donor keeps 1,180 ≥ 1,000 safety stock → **recommended**
  (score 85/100 from the documented weighting).
- **Option C — Wait**: stockout ~19 h before replenishment → high risk.

All figures (cover hours, shortfall, transfer quantity, costs, ETAs, scores)
are computed by the backend from database records — the UI renders what the
API returns.

## Project layout

```
server/            Express backend
  src/agents/      sensing · impact · scenario · logistics · compliance
  src/rules/       deterministic rule engine + option scoring
  src/db/          HANA & SQLite clients, schema, canonical seed
  src/llm/         SAP Generative AI Hub adapter (+template fallback)
  src/integrations/ weather (Open-Meteo) + S/4HANA mock/live adapters
  src/services/    human approval with server-side revalidation
  test/            node:test suites (28 tests)
ui/                React 19 + Vite + Tailwind frontend (9 screens)
server/db/hana/    SAP HANA DDL (17 tables)
deployment/        SAP BTP / HANA Cloud deployment assets
DEMO_SCRIPT.md     5-minute presentation walkthrough
```

## Tests

`npm test` runs 33 tests with the built-in `node:test` runner:

- **rules.test.js** — R1/R2/R3, stock-cover math, shortfall, transfer
  quantity, batch validity, scoring weights.
- **agents.test.js** — agent execution order, canonical figures
  (28.8 h cover, 80 shortfall, 240 transfer, score 85), hash-chain integrity,
  idempotent re-runs.
- **api.test.js** — endpoint contracts, additive synthetic import and agent
  analysis, 409 block when compliance fails, validation errors, audit integrity.

The Python generator also has reproducibility and data-integrity tests:

```powershell
python -m unittest discover -s synthetic-data -p "test_*.py"
```
