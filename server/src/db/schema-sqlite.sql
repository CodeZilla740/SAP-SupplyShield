-- SupplyShield schema - SQLite dialect (local development & tests).
-- The SAP HANA dialect lives in server/db/hana/schema.sql and is deployed
-- to SAP HANA Cloud in the production configuration.

CREATE TABLE IF NOT EXISTS medicines (
  sku          TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  min_temp     REAL NOT NULL,
  max_temp     REAL NOT NULL,
  unit         TEXT NOT NULL,
  case_size    INTEGER NOT NULL,
  unit_cost    REAL,
  batch        TEXT,
  manufactured TEXT,
  expiry       TEXT,
  gdp_class    TEXT
);

CREATE TABLE IF NOT EXISTS facilities (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT,
  type        TEXT NOT NULL,          -- HOSPITAL | WAREHOUSE | SUPPLIER | PORT
  priority    TEXT,                   -- P1 (life-critical) .. P3
  ward        TEXT,
  storage_loc TEXT
);

CREATE TABLE IF NOT EXISTS inventory (
  facility_code TEXT NOT NULL REFERENCES facilities(code),
  product_sku   TEXT NOT NULL REFERENCES medicines(sku),
  qty_on_hand   INTEGER NOT NULL,     -- available after reservations
  reserved_qty  INTEGER NOT NULL DEFAULT 0,
  daily_usage   INTEGER NOT NULL DEFAULT 0,
  safety_stock  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (facility_code, product_sku)
);

CREATE TABLE IF NOT EXISTS carriers (
  code                 TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  mode                 TEXT NOT NULL, -- ROAD | AIR
  cold_chain_certified INTEGER NOT NULL DEFAULT 0,
  min_temp             REAL,
  max_temp             REAL,
  base_cost            REAL NOT NULL,
  cost_per_km          REAL NOT NULL,
  avg_speed_kmh        REAL NOT NULL,
  handling_hours       REAL NOT NULL,
  telemetry_capable    INTEGER NOT NULL DEFAULT 0,
  vehicle              TEXT
);

CREATE TABLE IF NOT EXISTS lanes (
  id               INTEGER PRIMARY KEY,
  origin_code      TEXT NOT NULL REFERENCES facilities(code),
  destination_code TEXT NOT NULL REFERENCES facilities(code),
  mode             TEXT NOT NULL,
  distance_km      REAL NOT NULL,
  carrier_code     TEXT REFERENCES carriers(code)
);

-- S/4HANA-shaped purchase orders (EBELN numbering). SIMULATED master data;
-- replaceable by a live OData adapter when credentials are available.
CREATE TABLE IF NOT EXISTS purchase_orders (
  ebeln            TEXT PRIMARY KEY,
  supplier_name    TEXT,
  product_sku      TEXT NOT NULL REFERENCES medicines(sku),
  destination_code TEXT NOT NULL REFERENCES facilities(code),
  qty              INTEGER NOT NULL,
  port             TEXT,
  status           TEXT NOT NULL,     -- IN_TRANSIT | DELIVERED
  eta              TEXT
);

CREATE TABLE IF NOT EXISTS shipments (
  id                TEXT PRIMARY KEY,
  po_ebeln          TEXT REFERENCES purchase_orders(ebeln),
  product_sku       TEXT NOT NULL REFERENCES medicines(sku),
  batch             TEXT,
  origin_code       TEXT,
  origin_label      TEXT,
  destination_code  TEXT,
  destination_label TEXT,
  route             TEXT,
  status            TEXT NOT NULL,    -- Disrupted | Monitoring | On track
  risk              TEXT NOT NULL,    -- Critical | Medium | Low
  delay_hours       REAL NOT NULL DEFAULT 0,
  eta_text          TEXT,
  current_temp      REAL
);

CREATE TABLE IF NOT EXISTS temperature_readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id TEXT NOT NULL REFERENCES shipments(id),
  batch       TEXT,
  ts          TEXT NOT NULL,
  temp_c      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS disruptions (
  id                   TEXT PRIMARY KEY,
  type                 TEXT NOT NULL,
  title                TEXT NOT NULL,
  port                 TEXT,
  severity             TEXT NOT NULL, -- LOW | MEDIUM | HIGH | CRITICAL
  description          TEXT,
  status               TEXT NOT NULL, -- ACTIVE | MONITORING | ANALYSED | RESOLVED
  radius_km            REAL,
  wind_kmh             REAL,
  expected_delay_hours REAL,
  affected_shipments   INTEGER DEFAULT 0,
  affected_pos         INTEGER DEFAULT 0,
  verified             INTEGER NOT NULL DEFAULT 0, -- 1 = confirmed by operational source
  source               TEXT,
  created_at           TEXT
);

CREATE TABLE IF NOT EXISTS disruption_timeline (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  disruption_id TEXT NOT NULL REFERENCES disruptions(id),
  ts            TEXT,
  title         TEXT,
  text          TEXT,
  state         TEXT                  -- done | critical | active
);

CREATE TABLE IF NOT EXISTS infrastructure_status (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  disruption_id TEXT NOT NULL REFERENCES disruptions(id),
  label         TEXT,
  status        TEXT,
  tone          TEXT,
  icon          TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  severity TEXT,
  location TEXT,
  medicine TEXT,
  message  TEXT,
  ago      TEXT
);

CREATE TABLE IF NOT EXISTS recovery_plans (
  id                    TEXT PRIMARY KEY,
  disruption_id         TEXT NOT NULL REFERENCES disruptions(id),
  run_id                TEXT NOT NULL,
  correlation_id        TEXT NOT NULL,
  status                TEXT NOT NULL, -- PENDING_APPROVAL | APPROVED | REJECTED | EXECUTED_SIMULATED
  recommended_option_id TEXT,
  score                 REAL,
  explanation           TEXT,
  explanation_source    TEXT,
  created_at            TEXT,
  decided_at            TEXT,
  decided_by            TEXT,
  decision_comment      TEXT
);

CREATE TABLE IF NOT EXISTS recovery_options (
  id             TEXT PRIMARY KEY,
  plan_id        TEXT NOT NULL REFERENCES recovery_plans(id),
  code           TEXT NOT NULL,       -- OPT-A | OPT-B | OPT-C
  title          TEXT NOT NULL,
  source_code    TEXT,
  carrier_code   TEXT,
  qty            INTEGER DEFAULT 0,
  cost_usd       REAL DEFAULT 0,
  eta_hours      REAL DEFAULT 0,
  feasible       INTEGER DEFAULT 1,   -- logistics stage
  compliant      INTEGER DEFAULT 1,   -- R1/R2 hard rules
  meets_deadline INTEGER DEFAULT 1,   -- R3
  eligible       INTEGER DEFAULT 0,   -- feasible AND compliant AND meets_deadline
  rank           INTEGER DEFAULT 0,
  recommended    INTEGER DEFAULT 0,
  status         TEXT DEFAULT 'PROPOSED', -- PROPOSED | APPROVED | REJECTED | NOT_SELECTED
  reason         TEXT,
  checks_json    TEXT,                -- compliance checks performed (evidence)
  scores_json    TEXT                 -- normalized sub-scores
);

CREATE TABLE IF NOT EXISTS approvals (
  id             TEXT PRIMARY KEY,
  plan_id        TEXT NOT NULL REFERENCES recovery_plans(id),
  option_id      TEXT REFERENCES recovery_options(id),
  decision       TEXT NOT NULL,       -- APPROVED | REJECTED
  actor          TEXT NOT NULL,
  comment        TEXT,
  created_at     TEXT,
  execution_note TEXT
);

-- Tamper-evident, hash-chained audit trail. Each row stores the SHA-256 of
-- (prevHash | seq | runId | actor | step | payload | ts).
CREATE TABLE IF NOT EXISTS audit_log (
  seq       INTEGER PRIMARY KEY,
  run_id    TEXT,
  ts        TEXT NOT NULL,
  actor     TEXT NOT NULL,
  step      TEXT NOT NULL,
  payload   TEXT,
  prev_hash TEXT NOT NULL,
  hash      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_state (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT OR IGNORE INTO pipeline_state (name, value) VALUES ('RUN_COUNTER', 941);
INSERT OR IGNORE INTO pipeline_state (name, value) VALUES ('AUDIT_LOCK', 0);

CREATE TABLE IF NOT EXISTS network_stats (
  metric TEXT PRIMARY KEY,
  value  REAL NOT NULL,
  unit   TEXT,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS auth_users (
  email        TEXT PRIMARY KEY,
  full_name    TEXT NOT NULL,
  organisation TEXT NOT NULL,
  designation  TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('viewer', 'planner', 'admin')),
  password_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_invitations (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('viewer', 'planner', 'admin')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id         TEXT PRIMARY KEY,
  user_email TEXT NOT NULL REFERENCES auth_users(email),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_temp_shipment ON temperature_readings(shipment_id);
CREATE INDEX IF NOT EXISTS idx_options_plan ON recovery_options(plan_id);
CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_log(run_id);
