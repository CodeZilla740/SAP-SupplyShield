// SupplyShield API client.
// The UI never computes business numbers - every figure comes from the
// backend, which persists state in SAP HANA Cloud (or the local fallback).
// Responses carry `demo: true` because the seeded records are simulated.

const EXPRESS_BASE = (import.meta.env.VITE_EXPRESS_API_BASE_URL || "/api").replace(/\/$/, "")

type ApiError = Error & { status?: number }

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") {
    return typeof body === "string" && body ? body : fallback
  }
  const record = body as Record<string, unknown>
  const error = record.error
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message
  }
  if (typeof record.message === "string") return record.message
  if (Array.isArray(record.reasons) && record.reasons.every((reason) => typeof reason === "string")) {
    return record.reasons.join("; ")
  }
  return fallback
}

function apiError(message: string, status?: number, fallbackable = false): ApiError {
  const error = new Error(message) as ApiError
  error.status = status
  error.fallbackable = fallbackable
  return error
}

async function responseBody(response: Response): Promise<{ body: unknown; text: string }> {
  const text = await response.text()
  if (!text) return { body: {}, text }
  try {
    return { body: JSON.parse(text), text }
  } catch {
    return { body: text, text }
  }
}

function withoutODataContext<T>(body: unknown): T {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const { "@odata.context": _context, ...data } = body as Record<string, unknown>
    return data as T
  }
  return body as T
}

async function send<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  const { body, text } = await responseBody(response)
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("supplyshield:unauthorized"))
    }
    throw apiError(
      errorMessage(body, `Request failed: HTTP ${response.status}`),
      response.status,
    )
  }
  return withoutODataContext<T>(body)
}

async function req<T>(
  _capPath: string,
  expressPath: string,
  _capInit?: RequestInit,
  expressInit: RequestInit = _capInit || {},
): Promise<T> {
  return send<T>(EXPRESS_BASE, expressPath, expressInit)
}

function odataString(value: string): string {
  return encodeURIComponent(`'${value.replace(/'/g, "''")}'`)
}

// ---------- types (mirror the backend payloads) ----------
export interface HealthInfo {
  status: string
  time: string
  db: { engine: string; label: string }
  llm: { configured: boolean; label: string }
  integrations: { s4hana: { configured: boolean; mode: string } }
  demo: boolean
}

export type Kpi = [string, string, string, string, string, string]
export type AlertRow = [string, string, string, string, string]

export interface AgentStatus {
  name: string
  icon: string
  status: string
  warning: boolean
}

export interface OverviewData {
  demo: boolean
  kpis: { label: string; value: string; trend: string; detail: string; icon: string; tone: string }[]
  health: {
    score: number
    status: string
    delta: string
    signals: { label: string; value: string; tone: string }[]
  }
  alerts: AlertRow[]
  agents: AgentStatus[]
  runId: string | null
  mapEvent: { title: string; meta: string }
  insight: string
}

export interface DisruptionDetail {
  demo: boolean
  disruption: {
    id: string
    type: string
    title: string
    severity: string
    description: string
    status: string
    radius_km: number
    wind_kmh: number
    expected_delay_hours: number
    affected_shipments: number
    affected_pos: number
    verified: number
    source: string
  }
  timeline: { ts: string; title: string; text: string; state: string }[]
  infrastructure: { label: string; status: string; tone: string; icon: string }[]
}

export interface ShipmentRow {
  id: string
  medicine: string
  batch: string
  origin: string
  destination: string
  route: string
  eta: string
  temp: string
  status: string
  risk: string
  po: string
}

export interface ShipmentsData {
  demo: boolean
  kpis: { value: string; label: string; icon: string }[]
  totalInTransit: number
  criticalCount: number
  shipments: ShipmentRow[]
}

export interface ShipmentDetail {
  demo: boolean
  shipment: ShipmentRow & { band: string }
  readings: number[]
  tempCompliance: { compliant: boolean; min: number; max: number; avg: number; excursions: number }
  recoveryNote: string
}

export interface InventoryData {
  demo: boolean
  critical: {
    medicine: string
    facility: string
    available: number
    unit: string
    demandPerDay: number
    coverDays: number
    coverHours: number
    delayHours: number
    stockoutHours: number
    gapHours: number
    transferQty: number
    donorFacility: string
    restoredCoverDays: number
    thresholdHours: number
  }
  priorities: { name: string; ward: string; priority: string; tone: string }[]
  rows: {
    facility: string
    medicine: string
    available: string
    demand: string
    cover: string
    replenishment: string
    risk: string
  }[]
}

export interface RecoveryOption {
  id: string
  code: string
  title: string
  qty: number
  cost_usd: number
  eta_hours: number
  compliant: number
  meets_deadline: number
  eligible: number
  recommended: number
  status: string
  reason: string
  checks: { label: string; pass: number | boolean; note: string }[]
  scores: { speed?: number; cost?: number; protection?: number; compliance?: number }
}

export interface PlanData {
  demo: boolean
  plan: {
    id: string
    status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED"
    run_id: string
    correlation_id: string
    score: number
    explanation: string
    explanation_source: string
    decided_at: string | null
    decided_by: string | null
    decision_comment: string | null
  }
  options: RecoveryOption[]
  recommended: RecoveryOption | null
  disruption: { title: string; severity: string }
  ribbon: AgentStatus[]
}

export interface ComplianceData {
  demo: boolean
  networkCompliance: number
  range: { min: number; max: number; label: string }
  appliesTo: string
  checks: string[]
  telemetry: {
    batch: string
    readings: { ts: string; temp_c: number }[]
    min: number
    max: number
    avg: number
    excursions: number
    current: number
    withinRange: boolean
  }
  batchRecord: {
    name: string
    batch: string
    manufactured: string
    expiry: string
    gdp: string
    range: string
    valid: boolean
    note: string
  }
  validations: {
    title: string
    status: string
    tone: string
    checks: { label: string; pass: boolean }[]
    reason: string
  }[]
}

export interface AuditData {
  demo: boolean
  plan: {
    id: string
    status: string
    correlationId: string
    recommendedTitle: string | null
    qty: number
    destination: string
    planner: string | null
    decidedAt: string | null
  } | null
  events: {
    time: string
    title: string
    actor: string
    text: string
    icon: string
    state: string
    hash: string | null
  }[]
  execution: {
    transferReference: string
    sourceStorage: string
    destination: string
    reefer: string
    expectedArrival: string
    simulated: boolean
  }
  integrity: { valid: boolean; events: number }
}

// ---------- endpoints ----------
export const getHealth = () =>
  req<HealthInfo>("/health()", "/health")
export const getOverview = () =>
  req<OverviewData>("/overview()", "/overview")
export const getIntegrationStatus = () =>
  req<Record<string, unknown>>("/integrationsStatus()", "/integrations/status")
export const refreshWeather = () =>
  req<Record<string, unknown>>("/refreshWeather", "/integrations/weather/refresh", {
    method: "POST",
    body: "{}",
  })
export const listDisruptions = () =>
  req<{ demo: boolean; disruptions: DisruptionDetail["disruption"][] }>(
    "/listDisruptions()",
    "/disruptions",
  )
export const getDisruption = (id: string) =>
  req<DisruptionDetail>(
    `/disruptionDetails(id=${odataString(id)})`,
    `/disruptions/${encodeURIComponent(id)}`,
  )
export const runAnalysis = (id: string) =>
  req<{ message: string; planId: string; optionsGenerated: number }>(
    "/runAnalysis",
    `/disruptions/${encodeURIComponent(id)}/run-analysis`,
    { method: "POST", body: JSON.stringify({ disruptionId: id }) },
    { method: "POST", body: "{}" },
  )
export const createDisruption = (body: {
  type: string
  location: string
  severity: string
  duration: string
  description: string
}) => req<{ id: string; message: string }>(
  "/createDisruption",
  "/disruptions",
  { method: "POST", body: JSON.stringify(body) },
)
export const getShipments = () =>
  req<ShipmentsData>("/shipmentOverview()", "/shipments")
export const getShipment = (id: string) =>
  req<ShipmentDetail>(
    `/shipmentDetails(id=${odataString(id)})`,
    `/shipments/${encodeURIComponent(id)}`,
  )
export const getInventory = () =>
  req<InventoryData>("/inventoryOverview()", "/inventory")
export const getCurrentPlan = () =>
  req<PlanData>("/currentRecoveryPlan()", "/recovery-plans/current")
export const getRecoveryPlan = (id: string) =>
  req<PlanData>(
    `/recoveryPlanDetails(id=${odataString(id)})`,
    `/recovery-plans/${encodeURIComponent(id)}`,
  )
export const approvePlan = (id: string, comment: string) =>
  req<{ status: string; executionNote: string }>(
    "/approveRecoveryPlan",
    `/recovery-plans/${encodeURIComponent(id)}/approve`,
    { method: "POST", body: JSON.stringify({ planId: id, comment }) },
    { method: "POST", body: JSON.stringify({ comment }) },
  )
export const rejectPlan = (id: string, comment: string) =>
  req<{ status: string }>(
    "/rejectRecoveryPlan",
    `/recovery-plans/${encodeURIComponent(id)}/reject`,
    { method: "POST", body: JSON.stringify({ planId: id, comment }) },
    { method: "POST", body: JSON.stringify({ comment }) },
  )
export const approveOption = (optionId: string, comment: string) =>
  req<{ status: string; executionNote: string }>(
    "/approveRecoveryOption",
    `/recovery-options/${encodeURIComponent(optionId)}/approve`,
    { method: "POST", body: JSON.stringify({ optionId, comment }) },
  )
export const getCompliance = () =>
  req<ComplianceData>("/complianceOverview()", "/compliance")
export const getAudit = () =>
  req<AuditData>("/auditHistory()", "/audit")

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
