// SupplyShield API client.
// The UI never computes business numbers - every figure comes from the
// backend, which persists state in SAP HANA Cloud (or the local fallback).
// Responses carry `demo: true` because the seeded records are simulated.

const CAP_BASE = (import.meta.env.VITE_CAP_SERVICE_URL || "/odata/v4/supply-shield").replace(/\/$/, "")
const EXPRESS_BASE = (import.meta.env.VITE_EXPRESS_API_BASE_URL || "/api").replace(/\/$/, "")
const EXPRESS_FALLBACK_ENABLED = import.meta.env.VITE_EXPRESS_FALLBACK !== "false"

type ApiError = Error & { status?: number; fallbackable?: boolean }

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

function canUseExpressFallback(status: number, body: unknown, text: string): boolean {
  if (status === 502 || status === 503 || status === 504) return true
  if (status === 500) return /proxy error|ECONNREFUSED|ECONNRESET|socket hang up/i.test(text)
  if (status === 404) {
    return typeof body === "string" || !body || typeof body !== "object" || !("error" in body)
  }
  return false
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
      canUseExpressFallback(response.status, body, text),
    )
  }
  if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    throw apiError("API endpoint returned the website page instead of JSON", response.status, true)
  }
  return withoutODataContext<T>(body)
}

const expressReq = <T>(path: string, init?: RequestInit) => send<T>(EXPRESS_BASE, path, init)

async function req<T>(
  capPath: string,
  expressPath: string,
  capInit?: RequestInit,
  expressInit: RequestInit = capInit || {},
): Promise<T> {
  try {
    return await send<T>(CAP_BASE, capPath, capInit)
  } catch (error) {
    const method = (capInit?.method || "GET").toUpperCase()
    const transportFailure = error instanceof TypeError && (method === "GET" || method === "HEAD")
    const proxyFailure = transportFailure || (error as ApiError).fallbackable === true
    if (!EXPRESS_FALLBACK_ENABLED || !proxyFailure) throw error
    // An ambiguous network failure must not replay a write against Express.
    return send<T>(EXPRESS_BASE, expressPath, expressInit)
  }
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

export interface PortItem {
  code: string
  name: string
  city: string
  lat: number
  lng: number
  facilityCode: string
  primaryDisruptionId: string
  defaultDisruptionType: string
  description: string
  activeDisruption: DisruptionDetail["disruption"] | null
  disruptedShipments: number
  linkedPOs: number
  plan: { id: string; status: string; score: number; recommended_option_id: string; run_id?: string } | null
}

export interface DisruptionLocation {
  code: string
  name: string
  primaryDisruptionId: string
  type: string
  severity: string
  status: string
}

export interface OverviewData {
  demo: boolean
  selectedPort?: string
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
  planId?: string | null
  disruptionId?: string | null
  mapEvent: {
    title: string
    meta: string
    city: string | null
    port?: string | null
    lat?: number
    lng?: number
    radiusKm: number | null
  }
  insight: string
  network: {
    facilities: { code: string; name: string; city: string; type: string; priority: string | null }[]
    lanes: {
      id: number
      mode: string
      distance_km: number
      origin_code: string
      destination_code: string
      origin_city: string
      destination_city: string
      carrier: string | null
      isAlternative?: boolean
      isDisrupted?: boolean
    }[]
  }
}

export interface NetworkData {
  demo: boolean
  dataSource: string
  facilities: Record<string, unknown>[]
  medicines: Record<string, unknown>[]
  suppliers: Record<string, unknown>[]
  inventory: Record<string, unknown>[]
  purchaseOrders: Record<string, unknown>[]
  shipments: Record<string, unknown>[]
  temperatureReadings: Record<string, unknown>[]
  shipmentTracking: Record<string, unknown>[]
  disruptions: Record<string, unknown>[]
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
  expressReq<HealthInfo>("/health")
export const getPorts = () =>
  expressReq<{ demo: boolean; ports: PortItem[] }>("/ports")

export const getDisruptionLocations = () =>
  expressReq<{ demo: boolean; locations: DisruptionLocation[] }>("/disruption-locations")
export const getOverview = (port?: string) =>
  expressReq<OverviewData>(`/overview${port ? `?port=${encodeURIComponent(port)}` : ""}`)
export const getNetwork = () =>
  expressReq<NetworkData>("/network")
export const getIntegrationStatus = () =>
  expressReq<Record<string, unknown>>("/integrations/status")
export const refreshWeather = () =>
  expressReq<Record<string, unknown>>("/integrations/weather/refresh", {
    method: "POST",
    body: "{}",
  })
export const listDisruptions = () =>
  expressReq<{ demo: boolean; disruptions: DisruptionDetail["disruption"][] }>("/disruptions")
export const getDisruption = (id: string) =>
  expressReq<DisruptionDetail>(`/disruptions/${encodeURIComponent(id)}`)
export const runAnalysis = (id: string) =>
  expressReq<{ message: string; planId: string; optionsGenerated: number }>(
    `/disruptions/${encodeURIComponent(id)}/run-analysis`, { method: "POST", body: "{}" },
  )
export const createDisruption = (body: {
  type: string
  location: string
  severity: string
  duration: string
  description: string
}) => expressReq<{ id: string; message: string }>(
  "/disruptions",
  { method: "POST", body: JSON.stringify(body) },
)
export const getShipments = (port?: string) =>
  expressReq<ShipmentsData>(`/shipments${port ? `?port=${encodeURIComponent(port)}` : ""}`)
export const getShipment = (id: string) =>
  expressReq<ShipmentDetail>(`/shipments/${encodeURIComponent(id)}`)
export const getInventory = (port?: string) =>
  expressReq<InventoryData>(`/inventory${port ? `?port=${encodeURIComponent(port)}` : ""}`)
export const getCurrentPlan = (port?: string) =>
  expressReq<PlanData>(`/recovery-plans/current${port ? `?port=${encodeURIComponent(port)}` : ""}`)
export const getRecoveryPlan = (id: string) =>
  expressReq<PlanData>(`/recovery-plans/${encodeURIComponent(id)}`)
export const approvePlan = (id: string, comment: string) =>
  expressReq<{ status: string; executionNote: string }>(
    `/recovery-plans/${encodeURIComponent(id)}/approve`,
    { method: "POST", body: JSON.stringify({ comment }) },
  )
export const rejectPlan = (id: string, comment: string) =>
  expressReq<{ status: string }>(
    `/recovery-plans/${encodeURIComponent(id)}/reject`,
    { method: "POST", body: JSON.stringify({ comment }) },
  )
export const approveOption = (optionId: string, comment: string) =>
  expressReq<{ status: string; executionNote: string }>(
    `/recovery-options/${encodeURIComponent(optionId)}/approve`,
    { method: "POST", body: JSON.stringify({ optionId, comment }) },
  )
export const getCompliance = (port?: string) =>
  expressReq<ComplianceData>(`/compliance${port ? `?port=${encodeURIComponent(port)}` : ""}`)
export const getAudit = (port?: string) =>
  expressReq<AuditData>(`/audit${port ? `?port=${encodeURIComponent(port)}` : ""}`)

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
