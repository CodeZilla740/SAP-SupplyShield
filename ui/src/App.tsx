import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import * as L from "leaflet"
import "leaflet/dist/leaflet.css"
import {
  approvePlan,
  downloadJson,
  getAudit,
  getCompliance,
  getCurrentPlan,
  getDisruption,
  getDisruptionLocations,
  getHealth,
  getInventory,
  getNetwork,
  getOverview,
  getPorts,
  getShipment,
  getShipments,
  listDisruptions,
  rejectPlan,
  runAnalysis,
  type AgentStatus,
  type AuditData,
  type ComplianceData,
  type DisruptionDetail,
  type DisruptionLocation,
  type HealthInfo,
  type InventoryData,
  type NetworkData,
  type OverviewData,
  type PlanData,
  type PortItem,
  type ShipmentRow,
  type ShipmentsData,
} from "./api"
import type { AuthUser } from "./auth"

type Screen = "Overview" | "Disruption Monitor" | "Shipment Intelligence" | "Inventory & Stock Risk" | "AI Recovery Planning" | "Cold-Chain Compliance" | "Approval Centre" | "Execution & Audit Trail"
type GlobalSearchResult =
  | { key: string; kind: "shipment"; label: string; detail: string; shipment: ShipmentRow }
  | { key: string; kind: "medicine" | "facility"; label: string; detail: string }

type IconName = "overview" | "radar" | "truck" | "inventory" | "brain" | "snow" | "approval" | "audit" | "search" | "bell" | "sync" | "shield" | "alert" | "hospital" | "medicine" | "arrow" | "spark" | "check" | "close" | "clock" | "pin" | "route" | "temperature" | "box" | "chevron" | "menu" | "filter" | "plus" | "play" | "download" | "user" | "document"

const iconPaths: Record<IconName, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  radar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <path d="M12 12 18.5 5.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  truck: (
    <>
      <path d="M3 6h11v11H3z" />
      <path d="M14 10h4l3 3v4h-7z" />
      <circle cx="7" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
    </>
  ),
  inventory: (
    <>
      <path d="m4 7 8-4 8 4-8 4-8-4Z" />
      <path d="m4 7 8 4 8-4M4 7v10l8 4 8-4V7M12 11v10" />
    </>
  ),
  brain: (
    <>
      <path d="M9.5 4.5A3 3 0 0 0 5 7a3 3 0 0 0 .7 5.9A3.5 3.5 0 0 0 10 18v-4" />
      <path d="M14.5 4.5A3 3 0 0 1 19 7a3.5 3.5 0 0 1-.7 5.9A3.5 3.5 0 0 1 14 18v-4" />
      <path d="M10 6v14M14 6v14M8 10h2M14 10h2M8 15h2M14 15h2" />
    </>
  ),
  snow: (
    <>
      <path d="M12 2v20M4.2 6.5l15.6 11M4.2 17.5l15.6-11" />
      <path d="m9 4 3 3 3-3M9 20l3-3 3 3M4.5 9.5l4 .7-1.6-3.8M19.5 14.5l-4-.7 1.6 3.8M4.5 14.5l4-.7 1.6 3.8M19.5 9.5l-4 .7 1.6-3.8" />
    </>
  ),
  approval: (
    <>
      <path d="M6 3h12v18H6z" />
      <path d="m9 12 2 2 4-5M9 6h6M9 18h6" />
    </>
  ),
  audit: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2M5 3l-2 3 3 2" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  sync: (
    <>
      <path d="M20 7h-5V2M4 17h5v5" />
      <path d="M18.5 9A7 7 0 0 0 6 5.5L4 7M5.5 15A7 7 0 0 0 18 18.5l2-1.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4 6v5c0 5 3.3 8.4 8 10 4.7-1.6 8-5 8-10V6l-8-3Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.8 19a1.4 1.4 0 0 0 1.2 2h16a1.4 1.4 0 0 0 1.2-2L12 3Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  hospital: (
    <>
      <path d="M5 21V5h14v16M3 21h18" />
      <path d="M9 9h6M12 6v6M8 15h2M14 15h2M10 21v-3h4v3" />
    </>
  ),
  medicine: (
    <>
      <path d="M8 3h8v4H8zM7 7h10l2 3v11H5V10l2-3Z" />
      <path d="M9 14h6M12 11v6" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14M14 7l5 5-5 5" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3Z" />
      <path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  pin: (
    <>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  route: (
    <>
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="6" r="2" />
      <path d="M7 18h2a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h2" />
    </>
  ),
  temperature: (
    <>
      <path d="M10 14.8V5a2 2 0 0 1 4 0v9.8a4 4 0 1 1-4 0Z" />
      <path d="M12 9v8" />
    </>
  ),
  box: (
    <>
      <path d="M4 7h16v14H4zM8 3h8v4M9 12h6" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  filter: <path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" />,
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  download: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21a7 7 0 0 1 14 0" />
    </>
  ),
  document: (
    <>
      <path d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6M9 15h6" />
    </>
  ),
}

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  )
}

const navItems: { label: Screen; icon: IconName }[] = [
  { label: "Overview", icon: "overview" },
  { label: "Disruption Monitor", icon: "radar" },
  { label: "Shipment Intelligence", icon: "truck" },
  { label: "Inventory & Stock Risk", icon: "inventory" },
  { label: "AI Recovery Planning", icon: "brain" },
  { label: "Cold-Chain Compliance", icon: "snow" },
  { label: "Approval Centre", icon: "approval" },
  { label: "Execution & Audit Trail", icon: "audit" },
]

function StatusPill({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`status-pill ${tone}`}>
      <i />
      {children}
    </span>
  )
}

function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <div className="section-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <section className="panel" style={{ padding: 28 }}>
      <span className="panel-kicker">{label}</span>
      <p style={{ marginTop: 8, opacity: 0.7 }}>Fetching live data from the SupplyShield backend…</p>
    </section>
  )
}

function istTime(d: Date) {
  return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return now
}

interface DisruptionLocationItem {
  code: string
  name: string
  city: string
  defaultDisruptionType: string
}

const ALL_DISRUPTION_LOCATIONS: DisruptionLocationItem[] = [
  { code: "INMAA", name: "Chennai Port", city: "Chennai", defaultDisruptionType: "CYCLONE" },
  { code: "INBOM", name: "Mumbai Port", city: "Mumbai", defaultDisruptionType: "FLOOD" },
  { code: "INKOL", name: "Kolkata Port", city: "Kolkata", defaultDisruptionType: "PORT_CONGESTION" },
  { code: "INVIZ", name: "Visakhapatnam Port", city: "Visakhapatnam", defaultDisruptionType: "CYCLONE" },
  { code: "INHYD", name: "Hyderabad Hub", city: "Hyderabad", defaultDisruptionType: "DENSE_FOG" },
  { code: "INDEL", name: "Delhi NCR Facility", city: "Delhi NCR", defaultDisruptionType: "DEMAND_SURGE" },
  { code: "INPUN", name: "Pune DC", city: "Pune", defaultDisruptionType: "POWER_OUTAGE" },
  { code: "INBLR", name: "Bengaluru Logistics Hub", city: "Bengaluru", defaultDisruptionType: "TRANSIT_DELAY" },
]

function App({ user }: { user: AuthUser }) {
  const [screen, setScreen] = useState<Screen>("Overview")
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedShipment, setSelectedShipment] = useState<ShipmentRow | null>(null)
  const [globalSearchQuery, setGlobalSearchQuery] = useState("")
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [globalSearchError, setGlobalSearchError] = useState("")
  const [globalSearchData, setGlobalSearchData] = useState<{
    shipments: ShipmentRow[]
    inventory: InventoryData["rows"]
  } | null>(null)
  const globalSearchRef = useRef<HTMLDivElement>(null)
  const globalSearchInputRef = useRef<HTMLInputElement>(null)
  const globalSearchRequest = useRef<Promise<void> | null>(null)
  const [assessmentRunning, setAssessmentRunning] = useState(false)
  const [planStatus, setPlanStatus] = useState<"PENDING_APPROVAL" | "APPROVED" | "REJECTED" | null>(null)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [selectedPort, setSelectedPort] = useState<string>("INMAA")
  const [ports, setPorts] = useState<PortItem[]>([])
  const [disruptionLocations, setDisruptionLocations] = useState<DisruptionLocation[] | null>(null)
  const [selectedDisruptionId, setSelectedDisruptionId] = useState("INC-2026-1104-03")
  const [selectedDisruptionPort, setSelectedDisruptionPort] = useState("INMAA")
  const [toast, setToast] = useState("")
  const [dataVersion, setDataVersion] = useState(0)
  const now = useClock()

  const navigate = (next: Screen) => {
    setScreen(next)
    setMenuOpen(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(""), 3200)
  }

  const refresh = useCallback(() => setDataVersion((v) => v + 1), [])

  const loadGlobalSearchData = useCallback(() => {
    if (globalSearchData || globalSearchRequest.current) return
    setGlobalSearchLoading(true)
    setGlobalSearchError("")
    const request = Promise.all([getShipments(), getInventory()])
      .then(([shipments, inventory]) => {
        setGlobalSearchData({ shipments: shipments.shipments, inventory: inventory.rows })
      })
      .catch((error: unknown) => {
        setGlobalSearchError(
          `Unable to search live data: ${error instanceof Error ? error.message : "Unknown error"}`,
        )
      })
      .finally(() => {
        globalSearchRequest.current = null
        setGlobalSearchLoading(false)
      })
    globalSearchRequest.current = request
  }, [globalSearchData])

  const globalSearchResults: GlobalSearchResult[] = (() => {
    const query = globalSearchQuery.trim().toLocaleLowerCase()
    if (!query || !globalSearchData) return []

    const matches = (value: string) => value.toLocaleLowerCase().includes(query)
    const results: GlobalSearchResult[] = []
    const seen = new Set<string>()

    for (const shipment of globalSearchData.shipments) {
      if (
        matches(shipment.id) ||
        matches(shipment.medicine) ||
        matches(shipment.origin) ||
        matches(shipment.destination)
      ) {
        results.push({
          key: `shipment:${shipment.id}`,
          kind: "shipment",
          label: shipment.id,
          detail: `${shipment.medicine} · ${shipment.origin} → ${shipment.destination}`,
          shipment,
        })
      }
    }

    const medicines = new Set(globalSearchData.inventory.map((row) => row.medicine))
    globalSearchData.shipments.forEach((shipment) => medicines.add(shipment.medicine))
    for (const medicine of medicines) {
      const key = medicine.toLocaleLowerCase()
      if (matches(medicine) && !seen.has(`medicine:${key}`)) {
        seen.add(`medicine:${key}`)
        results.push({
          key: `medicine:${key}`,
          kind: "medicine",
          label: medicine,
          detail: "Medicine · Inventory",
        })
      }
    }

    const facilities = new Set([
      ...globalSearchData.inventory.map((row) => row.facility),
      ...globalSearchData.shipments.flatMap((shipment) => [shipment.origin, shipment.destination]),
    ])
    for (const facility of facilities) {
      const key = facility.toLocaleLowerCase()
      if (matches(facility) && !seen.has(`facility:${key}`)) {
        seen.add(`facility:${key}`)
        results.push({
          key: `facility:${key}`,
          kind: "facility",
          label: facility,
          detail: "Facility / location · Inventory",
        })
      }
    }

    return results.slice(0, 8)
  })()

  const selectGlobalSearchResult = (result: GlobalSearchResult) => {
    setGlobalSearchOpen(false)
    setGlobalSearchQuery("")
    if (result.kind === "shipment") {
      setSelectedShipment(result.shipment)
      navigate("Shipment Intelligence")
      return
    }
    navigate("Inventory & Stock Risk")
  }

  useEffect(() => {
    if (!globalSearchOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !globalSearchRef.current?.contains(event.target)) {
        setGlobalSearchOpen(false)
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideClick)
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick)
  }, [globalSearchOpen])

  useEffect(() => {
    const openSearchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        globalSearchInputRef.current?.focus()
        setGlobalSearchOpen(true)
      }
    }
    document.addEventListener("keydown", openSearchShortcut)
    return () => document.removeEventListener("keydown", openSearchShortcut)
  }, [])

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null))
  }, [dataVersion])

  useEffect(() => {
    getPorts().then((res) => {
      const codes = new Set(res.ports.map((p) => p.code))
      const extra: PortItem[] = ALL_DISRUPTION_LOCATIONS.filter((l: DisruptionLocationItem) => !codes.has(l.code)).map((l: DisruptionLocationItem) => ({
        code: l.code,
        name: l.name,
        city: l.city,
        lat: 0,
        lng: 0,
        facilityCode: "",
        primaryDisruptionId: "",
        defaultDisruptionType: l.defaultDisruptionType,
        description: "",
        activeDisruption: null,
        disruptedShipments: 0,
        linkedPOs: 0,
        plan: null,
      }))
      setPorts([...res.ports, ...extra])
    }).catch(() => setPorts(ALL_DISRUPTION_LOCATIONS.map((l: DisruptionLocationItem) => ({
      code: l.code,
      name: l.name,
      city: l.city,
      lat: 0,
      lng: 0,
      facilityCode: "",
      primaryDisruptionId: "",
      defaultDisruptionType: l.defaultDisruptionType,
      description: "",
      activeDisruption: null,
      disruptedShipments: 0,
      linkedPOs: 0,
      plan: null,
    }))))
  }, [dataVersion])

  useEffect(() => {
    getDisruptionLocations()
      .then((result) => setDisruptionLocations(result.locations))
      .catch(() => setDisruptionLocations([]))
  }, [dataVersion])

  useEffect(() => {
    if (!disruptionLocations || selectedDisruptionPort === selectedPort) return
    const location = disruptionLocations.find((item) => item.code === selectedPort)
    setSelectedDisruptionId(location?.primaryDisruptionId || "")
    setSelectedDisruptionPort(selectedPort)
  }, [selectedPort, disruptionLocations, selectedDisruptionPort])

  useEffect(() => {
    getCurrentPlan(selectedPort, selectedDisruptionId)
      .then((p) => setPlanStatus(p.plan.status))
      .catch(() => setPlanStatus(null))
  }, [dataVersion, selectedPort, selectedDisruptionId])

  const runAssessment = async (disruptionId: string) => {
    setAssessmentRunning(true)
    try {
      const result = await runAnalysis(disruptionId)
      refresh()
      notify(result.message || "Impact assessment complete — recovery scenarios generated.")
      if (result.planId) navigate("AI Recovery Planning")
    } catch (e) {
      notify(`Assessment failed: ${(e as Error).message}`)
    } finally {
      setAssessmentRunning(false)
    }
  }

  const approval: "pending" | "approved" | "rejected" =
    planStatus === "APPROVED" ? "approved" : planStatus === "REJECTED" ? "rejected" : "pending"

  const profileName = user.fullName?.trim() || user.email?.trim() || "Supply planner"
  const profileInitial = profileName.charAt(0).toLocaleUpperCase() || "S"

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-symbol">
            <svg viewBox="0 0 42 42" aria-hidden="true">
              <path d="M21 3 35 9v10c0 9-5.8 15.2-14 19-8.2-3.8-14-10-14-19V9l14-6Z" />
              <circle cx="21" cy="13" r="2.7" />
              <circle cx="14" cy="21" r="2.7" />
              <circle cx="28" cy="21" r="2.7" />
              <path d="m21 15.7-5 3.6M21 15.7l5 3.6M16.7 22.8l4.3 5 4.3-5" />
            </svg>
          </div>
          <div>
            <strong>SUPPLYSHIELD</strong>
            <span>Resilient medical supply network</span>
          </div>
        </div>
        <div className="nav-label">COMMAND CENTRE</div>
        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              key={item.label}
              className={`nav-item ${screen === item.label ? "active" : ""}`}
              onClick={() => navigate(item.label)}
            >
              <span className="nav-icon">
                <Icon name={item.icon} size={18} />
              </span>
              <span>{item.label}</span>
              {item.label === "Disruption Monitor" && <b>3</b>}
              {item.label === "Approval Centre" && approval === "pending" && (
                <i className="nav-pulse" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="user-card">
          <div className="avatar">{profileInitial}</div>
          <div>
            <strong>{profileName}</strong>
            <span>{user.designation || "Supply-chain planner"}</span>
          </div>
          <Icon name="chevron" size={15} />
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button
            className="icon-button menu-button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Open navigation"
          >
            <Icon name="menu" />
          </button>
          <div className="global-search-wrap" ref={globalSearchRef}>
            <div className="global-search">
              <Icon name="search" size={17} />
              <input
                ref={globalSearchInputRef}
                aria-label="Global search"
                aria-autocomplete="list"
                aria-controls="global-search-results"
                aria-expanded={globalSearchOpen && Boolean(globalSearchQuery.trim())}
                placeholder="Search shipments, medicines, hospitals..."
                value={globalSearchQuery}
                onFocus={() => setGlobalSearchOpen(true)}
                onChange={(event) => {
                  const query = event.target.value
                  setGlobalSearchQuery(query)
                  setGlobalSearchOpen(true)
                  if (query.trim()) loadGlobalSearchData()
                  else setGlobalSearchError("")
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setGlobalSearchOpen(false)
                }}
              />
              {globalSearchQuery && (
                <button
                  className="global-search-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setGlobalSearchQuery("")
                    setGlobalSearchError("")
                    setGlobalSearchOpen(true)
                    globalSearchInputRef.current?.focus()
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
              <kbd>⌘ K</kbd>
            </div>
            {globalSearchOpen && Boolean(globalSearchQuery.trim()) && (
              <div className="global-search-results" id="global-search-results" role="listbox">
                {globalSearchLoading ? (
                  <div className="global-search-message" role="status">Searching live records…</div>
                ) : globalSearchError ? (
                  <div className="global-search-message search-error" role="alert">
                    <span>{globalSearchError}</span>
                    <button onClick={loadGlobalSearchData}>Retry</button>
                  </div>
                ) : globalSearchResults.length ? (
                  globalSearchResults.map((result) => (
                    <button
                      className="global-search-result"
                      key={result.key}
                      role="option"
                      aria-selected="false"
                      onClick={() => selectGlobalSearchResult(result)}
                    >
                      <span className={`global-search-result-icon ${result.kind}`}>
                        <Icon
                          name={result.kind === "shipment" ? "truck" : result.kind === "medicine" ? "medicine" : "hospital"}
                          size={15}
                        />
                      </span>
                      <span className="global-search-result-copy">
                        <b>{result.label}</b>
                        <small>{result.detail}</small>
                      </span>
                      <Icon name="chevron" size={14} />
                    </button>
                  ))
                ) : (
                  <div className="global-search-message">No results found</div>
                )}
              </div>
            )}
          </div>
          <div className="topbar-right">
            <div
              className="port-context-badge"
              title="Active Port Context for multi-port disruption analysis"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(15, 23, 42, 0.75)",
                padding: "4px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255, 255, 255, 0.12)",
              }}
            >
              <Icon name="pin" size={14} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted, #94a3b8)", textTransform: "uppercase" }}>
                Port:
              </span>
              <select
                aria-label="Active port context"
                value={selectedPort}
                onChange={(e) => {
                  const newPort = e.target.value
                  setSelectedPort(newPort)
                  notify(`Active context: ${ports.find((p) => p.code === newPort)?.name || newPort}`)
                }}
                style={{
                  background: "transparent",
                  color: "#f8fafc",
                  border: "none",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {(ports.length > 0
                  ? ports
                  : ALL_DISRUPTION_LOCATIONS
                ).map((p) => (
                  <option key={p.code} value={p.code} style={{ background: "#0f172a", color: "#f8fafc" }}>
                    {p.name} ({p.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="sync-label">
              <Icon name="sync" size={14} />
              <span>
                <b>SYNCED</b>
                <small>{istTime(now)} IST</small>
              </span>
            </div>
            <button
              className="icon-button notification"
              aria-label="Notifications"
              onClick={() => notify("3 critical alerts are listed on the Overview priority queue.")}
            >
              <Icon name="bell" size={18} />
            </button>
            <div className="top-avatar" aria-label={profileName} title={profileName}>{profileInitial}</div>
          </div>
        </header>

        <div className="page-content">
          {screen === "Overview" && (
            <Overview
              navigate={navigate}
              version={dataVersion}
              selectedPort={selectedPort}
              onSelectPort={setSelectedPort}
              ports={ports}
            />
          )}
          {screen === "Disruption Monitor" && (
            <DisruptionMonitor
              running={assessmentRunning}
              runAssessment={runAssessment}
              version={dataVersion}
              selectedPort={selectedPort}
              selectedDisruptionId={selectedDisruptionId}
              onSelectDisruption={(id, port) => {
                setSelectedDisruptionId(id)
                setSelectedDisruptionPort(port || selectedPort)
                if (port) setSelectedPort(port)
              }}
            />
          )}
          {screen === "Shipment Intelligence" && (
            <ShipmentIntelligence
              selectShipment={setSelectedShipment}
              version={dataVersion}
              selectedPort={selectedPort}
            />
          )}
          {screen === "Inventory & Stock Risk" && (
            <InventoryRisk
              navigate={navigate}
              version={dataVersion}
              selectedPort={selectedPort}
            />
          )}
          {screen === "AI Recovery Planning" && (
            <RecoveryPlanning
              navigate={navigate}
              version={dataVersion}
              selectedPort={selectedPort}
              selectedDisruptionId={selectedDisruptionId}
            />
          )}
          {screen === "Cold-Chain Compliance" && (
            <Compliance
              version={dataVersion}
              selectedPort={selectedPort}
              selectedDisruptionId={selectedDisruptionId}
            />
          )}
          {screen === "Approval Centre" && (
            <ApprovalCentre
              approval={approval}
              onDecision={(status) => {
                setPlanStatus(status)
                refresh()
                notify(
                  status === "APPROVED"
                    ? "Recovery plan approved and added to the audit trail."
                    : "Plan rejected and returned for replanning.",
                )
              }}
              onBlocked={(message) => notify(message)}
              navigate={navigate}
              version={dataVersion}
              selectedPort={selectedPort}
            />
          )}
          {screen === "Execution & Audit Trail" && (
            <AuditTrail
              version={dataVersion}
              selectedPort={selectedPort}
              selectedDisruptionId={selectedDisruptionId}
            />
          )}
          <footer>
            <span>SUPPLYSHIELD / SAP HACKFEST BENGALURU 2026</span>
            <span>
              <i className="live-dot" />
              {health ? health.db.label : "Connecting to backend…"}
            </span>
          </footer>
        </div>
      </main>

      {selectedShipment && (
        <ShipmentDrawer
          shipment={selectedShipment}
          close={() => setSelectedShipment(null)}
          navigate={navigate}
        />
      )}
      {menuOpen && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      {toast && (
        <div className="toast">
          <Icon name="check" size={17} />
          {toast}
        </div>
      )}
    </div>
  )
}

function Overview({
  navigate,
  version,
  selectedPort,
  onSelectPort,
  ports,
}: {
  navigate: (screen: Screen) => void
  version: number
  selectedPort: string
  onSelectPort: (port: string) => void
  ports: PortItem[]
}) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [mapView, setMapView] = useState<"street" | "satellite">("street")
  useEffect(() => {
    getOverview(selectedPort).then(setData).catch(() => setData(null))
  }, [version, selectedPort])
  if (!data) return <Loading label="EXECUTIVE CONTROL TOWER" />
  return (
    <>
      <SectionHeader
        eyebrow="EXECUTIVE CONTROL TOWER"
        title="Your Supply Chain, Under Control."
        description="Your medical supply network, intelligently protected."
        actions={
          <button
            className="button primary"
            onClick={() => navigate("Disruption Monitor")}
          >
            <Icon name="radar" size={16} />
            Investigate disruption <Icon name="arrow" size={15} />
          </button>
        }
      />

      <section className="health-strip">
        <div className="health-score">
          <div className="score-ring">
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="26" />
              <circle
                className="score-progress"
                cx="32"
                cy="32"
                r="26"
                style={{
                  strokeDasharray: `${(163.36 * Math.min(100, Math.max(0, data.health.score))) / 100} 163.36`,
                }}
              />
            </svg>
            <span>
              <b>{data.health.score}</b>
              <small>/100</small>
            </span>
          </div>
          <div>
            <span>TELEMETRY IN-RANGE</span>
            <strong>{data.health.status}</strong>
            <small>{data.health.delta}</small>
          </div>
        </div>
        <div className="health-divider" />
        {data.health.signals.map((s) => (
          <div className="health-signal" key={s.label}>
            <i className={s.tone} />
            <span>
              <small>{s.label}</small>
              <b>{s.value}</b>
            </span>
          </div>
        ))}
        <div className="health-updated">
          <Icon name="sync" size={14} />
          Live network model
        </div>
      </section>

      <section className="kpi-grid">
        {data.kpis.map(({ label, value, trend, detail, icon, tone }) => (
          <article className="kpi-card" key={label}>
            <div className={`kpi-icon ${tone}`}>
              <Icon name={icon as IconName} size={20} />
            </div>
            <span>{label}</span>
            <div className="kpi-value">
              <strong>{value}</strong>
              {label === "Critical Medicine Stock" && <small>DAYS</small>}
            </div>
            <div className={`kpi-trend ${tone}`}>
              <b>{trend}</b>
              <span>{detail}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="command-grid">
        <article className="panel map-panel">
          <div className="panel-heading" style={{ flexWrap: "wrap", gap: 12 }}>
            <div>
              <span className="panel-kicker">LIVE NETWORK TOPOLOGY</span>
              <h2>India medical supply network</h2>
            </div>
            <div className="map-heading-actions" style={{ flexWrap: "wrap", gap: 10 }}>
              <div className="port-selection-box" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted, #94a3b8)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Disruption Focus:
                </span>
                <select
                  aria-label="Select active port for disruption analysis"
                  value={selectedPort}
                  onChange={(e) => onSelectPort(e.target.value)}
                  style={{
                    background: "rgba(15, 23, 42, 0.9)",
                    color: "#f8fafc",
                    border: "1px solid #3b82f6",
                    borderRadius: 6,
                    padding: "5px 10px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {(ports.length > 0
                    ? ports
                    : ALL_DISRUPTION_LOCATIONS
                  ).map((p: PortItem | DisruptionLocationItem) => (
                    <option key={p.code} value={p.code}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="map-legend">
                <span>
                  <i style={{ background: "#10b981", width: 12, height: 3, borderRadius: 2, display: "inline-block" }} />
                  Road
                </span>
                <span>
                  <i style={{ background: "#8b5cf6", width: 12, height: 3, borderRadius: 2, display: "inline-block" }} />
                  Air
                </span>
                <span>
                  <i className="alternate" />
                  Alternative
                </span>
                <span>
                  <i className="disrupted" />
                  Disrupted
                </span>
              </div>
              <div className="map-view-toggle" role="group" aria-label="Map layer">
                <button
                  type="button"
                  aria-pressed={mapView === "street"}
                  onClick={() => setMapView("street")}
                >
                  Street
                </button>
                <button
                  type="button"
                  aria-pressed={mapView === "satellite"}
                  onClick={() => setMapView("satellite")}
                >
                  Satellite
                </button>
              </div>
            </div>
          </div>
          <div className="port-pill-bar" style={{ display: "flex", gap: 8, padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(15, 23, 42, 0.5)", overflowX: "auto" }}>
            {(ports.length > 0
              ? ports
              : ALL_DISRUPTION_LOCATIONS
            ).map((p: PortItem | DisruptionLocationItem) => {
              const active = p.code === selectedPort
              return (
                <button
                  key={p.code}
                  type="button"
                  onClick={() => onSelectPort(p.code)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 20,
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    background: active ? "#2563eb" : "rgba(30, 41, 59, 0.7)",
                    color: active ? "#ffffff" : "#94a3b8",
                    border: active ? "1px solid #60a5fa" : "1px solid rgba(255,255,255,0.1)",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.15s ease",
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: active ? "#ffffff" : (p.code === "INMAA" ? "#ef4444" : "#f59e0b") }} />
                  <b>{p.name}</b>
                  <small style={{ opacity: 0.8, fontSize: 10 }}>({p.code})</small>
                </button>
              )
            })}
          </div>
          <NetworkMap
            view={mapView}
            mapEvent={data.mapEvent}
            network={data.network}
            onOpenDisruption={() => navigate("Disruption Monitor")}
          />
          {data.network.lanes.some((l) => l.isAlternative) && (
            <div
              className="alternative-lanes-summary"
              style={{
                margin: "12px 16px 16px",
                padding: "12px 14px",
                background: "rgba(245, 158, 11, 0.08)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Active Alternative Logistics Lanes · {selectedPort} Rerouting Analysis
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)" }}>
                  Feasible alternative carrier lanes identified
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                {data.network.lanes.filter((l) => l.isAlternative).map((lane) => (
                  <div
                    key={lane.id}
                    style={{
                      background: "rgba(15, 23, 42, 0.7)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: 6,
                      padding: "8px 12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong style={{ fontSize: 12, color: "#f8fafc" }}>
                        {lane.origin_city} → {lane.destination_city}
                      </strong>
                      <span className="status-pill alternate" style={{ fontSize: 10, padding: "2px 6px" }}>
                        {lane.mode}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)", display: "flex", justifyContent: "space-between" }}>
                      <span>Carrier: {lane.carrier || "Dedicated Carrier"}</span>
                      <span>{lane.distance_km} km</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="panel alerts-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">PRIORITY QUEUE</span>
            <h2>Critical alerts</h2>
          </div>
          <button
            className="text-button"
            onClick={() => navigate("Disruption Monitor")}
          >
            View all intelligence <Icon name="arrow" size={14} />
          </button>
        </div>
        <div className="alerts-table">
          {data.alerts.map(([severity, location, medicine, message, time]) => (
            <div className="alert-row" key={message}>
              <span className={`severity ${severity.toLowerCase()}`}>
                {severity}
              </span>
              <div className="alert-location">
                <b>{location}</b>
                <small>{medicine}</small>
              </div>
              <p>{message}</p>
              <time>{time}</time>
              <button aria-label="View alert" onClick={() => navigate("Disruption Monitor")}>
                <Icon name="chevron" size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

const mapTiles = {
  street: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles © Esri — Esri, HERE, Garmin, (c) OpenStreetMap contributors, and the GIS user community",
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
} as const

function escapeMapHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character)
}

function NetworkMap({
  view,
  mapEvent,
  network,
  onOpenDisruption,
}: {
  view: "street" | "satellite"
  mapEvent: OverviewData["mapEvent"]
  network: OverviewData["network"]
  onOpenDisruption: () => void
}) {
  const mapElement = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const tileLayers = useRef<Record<"street" | "satellite", L.TileLayer> | null>(null)
  const [zoom, setZoom] = useState(6)
  const [tileError, setTileError] = useState(false)

  useEffect(() => {
    if (!mapElement.current) return

    const initialZoom = mapElement.current.clientWidth < 600 ? 5 : 6
    const map = L.map(mapElement.current, {
      center: [16.4, 77.3],
      zoom: initialZoom,
      minZoom: 4,
      maxZoom: 18,
      zoomControl: false,
      scrollWheelZoom: true,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
    })
    const layers = {
      street: L.tileLayer(mapTiles.street.url, {
        maxZoom: 18,
        attribution: mapTiles.street.attribution,
      }),
      satellite: L.tileLayer(mapTiles.satellite.url, {
        maxZoom: 18,
        attribution: mapTiles.satellite.attribution,
      }),
    }
    layers[view].addTo(map)
    mapInstance.current = map
    tileLayers.current = layers
    setZoom(initialZoom)

    const handleTileError = () => setTileError(true)
    layers.street.on("tileerror", handleTileError)
    layers.satellite.on("tileerror", handleTileError)
    map.on("zoomend", () => setZoom(map.getZoom()))

    const cityCoordinates: Record<string, L.LatLngTuple> = {
      Mumbai: [19.076, 72.8777],
      Chennai: [13.0827, 80.2707],
      Hyderabad: [17.385, 78.4867],
      Bengaluru: [12.9716, 77.5946],
      "Delhi NCR": [28.6139, 77.209],
      Kolkata: [22.5726, 88.3639],
      Pune: [18.5204, 73.8567],
      Visakhapatnam: [17.6868, 83.2185],
    }
    const routeStyle = {
      weight: 4,
      opacity: 0.88,
      dashArray: "7 8",
      lineCap: "round" as const,
      interactive: true,
    }
    const facilityCoordinates: Record<string, L.LatLngTuple> = {
      "PORT-MAA": [13.085, 80.298],
      "HOS-APO": [13.060, 80.252],
      "PORT-BOM": [18.950, 72.860],
      "WH-MUM": [19.220, 72.980],
      "PORT-KOL": [22.540, 88.310],
      "WH-KOL": [22.600, 88.300],
      "HOS-KOL": [22.570, 88.410],
      "PORT-VIZ": [17.695, 83.295],
      "WH-BLR": [13.040, 77.490],
      "HOS-STM": [12.965, 77.595],
      "HOS-MAN": [12.960, 77.650],
      "WH-HYD": [17.240, 78.430],
      "HOS-CITY": [17.420, 78.450],
      "WH-DEL": [28.680, 77.100],
      "HOS-DEL": [28.580, 77.260],
      "WH-PUN": [18.650, 73.800],
      "HOS-PUN": [18.520, 73.860],
    }

    for (const lane of network.lanes) {
      let origin = facilityCoordinates[lane.origin_code] || cityCoordinates[lane.origin_city]
      let destination = facilityCoordinates[lane.destination_code] || cityCoordinates[lane.destination_city]
      if (!origin || !destination) continue
      if (origin[0] === destination[0] && origin[1] === destination[1]) {
        destination = [destination[0] - 0.08, destination[1] + 0.08]
      }
      const isAlt = Boolean((lane as any).isAlternative)
      const isDisrupted = Boolean((lane as any).isDisrupted)
      // High contrast colors: vivid purple for AIR, emerald green for ROAD
      const color = isDisrupted ? "#ef4444" : isAlt ? "#f59e0b" : lane.mode === "AIR" ? "#8b5cf6" : "#10b981"
      L.polyline([origin, destination], {
        ...routeStyle,
        color,
        weight: isAlt || isDisrupted ? 5 : 4,
        dashArray: isAlt ? "10 5" : isDisrupted ? "4 4" : "7 8",
      })
        .bindPopup(
          `${escapeMapHtml(lane.origin_city)} → ${escapeMapHtml(lane.destination_city)} · ${escapeMapHtml(lane.mode)} · ${lane.distance_km} km · ${escapeMapHtml(lane.carrier || "carrier unavailable")}${isAlt ? "<br><strong style=\"color:#f59e0b\">[Alternative Feasible Route]</strong>" : ""}${isDisrupted ? "<br><strong style=\"color:#ef4444\">[Disrupted Lane]</strong>" : ""}`
        )
        .addTo(map)
    }

    const cities = new Map<string, typeof network.facilities>()
    for (const facility of network.facilities) {
      if (!facility.city || !cityCoordinates[facility.city]) continue
      cities.set(facility.city, [...(cities.get(facility.city) || []), facility])
    }
    for (const [city, facilities] of cities) {
      const position = cityCoordinates[city]
      const names = facilities.map((facility) => facility.name).join(", ")
      const affected = mapEvent.city === city
      const tone = affected ? "critical" : facilities.some((facility) => facility.type === "WAREHOUSE") ? "alternate" : "safe"
      L.marker(position, {
        icon: L.divIcon({
          className: "network-map-marker-icon",
          iconSize: [1, 1],
          iconAnchor: [8, 12],
          html: `<span class="network-map-pin ${tone} label-right"><i></i><span><b>${city}</b><small>${facilities.length} facilities</small></span></span>`,
        }),
        title: city,
        keyboard: true,
      })
        .bindPopup(`<strong>${escapeMapHtml(city)}</strong><br>${escapeMapHtml(names)}`)
        .addTo(map)
    }

    for (const facility of network.facilities.filter((f) => f.type === "HOSPITAL")) {
      const pos = facilityCoordinates[facility.code]
      if (!pos) continue
      L.marker(pos, {
        icon: L.divIcon({
          className: "hospital-pin",
          iconSize: [1, 1],
          iconAnchor: [6, 6],
          html: `<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(15,23,42,0.92);color:#38bdf8;border:1px solid #0284c7;border-radius:12px;padding:2px 7px;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.5)">🏥 ${facility.name}</span>`,
        }),
        title: facility.name,
      })
        .bindPopup(`<strong>🏥 ${escapeMapHtml(facility.name)}</strong><br>City: ${escapeMapHtml(facility.city)}<br>Priority: ${facility.priority}<br>Ward: ${escapeMapHtml((facility as any).ward || "General")}`)
        .addTo(map)
    }
    const coveragePoints = [...cities.keys()].map((city) => cityCoordinates[city])
    if (mapEvent.city && cityCoordinates[mapEvent.city]) {
      map.setView(cityCoordinates[mapEvent.city], 6, { animate: true })
    } else if (coveragePoints.length > 1) {
      map.fitBounds(L.latLngBounds(coveragePoints), { padding: [40, 40], maxZoom: 5 })
    }
    if (mapEvent.city && cityCoordinates[mapEvent.city] && mapEvent.radiusKm) {
      L.circle(cityCoordinates[mapEvent.city], {
        radius: mapEvent.radiusKm * 1000,
        color: "#ef5350",
        weight: 2,
        dashArray: "5 7",
        fillColor: "#ef5350",
        fillOpacity: 0.12,
      }).bindPopup(escapeMapHtml(mapEvent.title)).addTo(map)
    }

    let compactViewport = initialZoom === 5
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false })
      const nextCompactViewport = mapElement.current!.clientWidth < 600
      if (nextCompactViewport !== compactViewport) {
        compactViewport = nextCompactViewport
        if (nextCompactViewport && map.getZoom() > 5) {
          map.setZoom(5, { animate: true })
        } else if (!nextCompactViewport && map.getZoom() === 5) {
          map.setZoom(6, { animate: true })
        }
      }
    })
    resizeObserver.observe(mapElement.current)

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapInstance.current = null
      tileLayers.current = null
    }
  }, [mapEvent.city, mapEvent.radiusKm, mapEvent.title, network])

  useEffect(() => {
    const map = mapInstance.current
    const layers = tileLayers.current
    if (!map || !layers) return
    const nextLayer = layers[view]
    for (const layer of Object.values(layers)) {
      if (map.hasLayer(layer) && layer !== nextLayer) map.removeLayer(layer)
    }
    if (!map.hasLayer(nextLayer)) nextLayer.addTo(map)
    setTileError(false)
  }, [view])

  return (
    <div className="network-map">
      <div
        ref={mapElement}
        className="network-map-canvas"
        aria-label={`Interactive India medical supply network map, zoom level ${zoom}`}
        data-zoom={zoom}
      />
      <div className="map-zoom" role="group" aria-label="Map zoom controls">
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={zoom >= 18}
          onClick={() => mapInstance.current?.zoomIn(1, { animate: true })}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={zoom <= 4}
          onClick={() => mapInstance.current?.zoomOut(1, { animate: true })}
        >
          −
        </button>
      </div>
      {tileError && (
        <div className="map-tile-error" role="status">
          Some map tiles could not load. Check your connection and try again.
        </div>
      )}
      <a
        className="map-event-card"
        href="#disruption-monitor"
        onClick={(event) => {
          event.preventDefault()
          onOpenDisruption()
        }}
      >
        <span className="event-radar"><Icon name="radar" /></span>
        <span className="map-event-copy">
          <span>ACTIVE DISRUPTION</span>
          <b>{mapEvent.title}</b>
          <small>{mapEvent.meta}</small>
        </span>
        <Icon name="arrow" size={16} />
      </a>
    </div>
  )
}

function DisruptionMonitor({
  running,
  runAssessment,
  version,
  selectedPort,
  selectedDisruptionId,
  onSelectDisruption,
}: {
  running: boolean
  runAssessment: (id: string) => void
  version: number
  selectedPort?: string
  selectedDisruptionId: string
  onSelectDisruption: (id: string, port: string) => void
}) {
  const [data, setData] = useState<DisruptionDetail | null>(null)
  const [disruptions, setDisruptions] = useState<DisruptionDetail["disruption"][]>([])
  const [loadError, setLoadError] = useState("")

  const portToIncident: Record<string, string> = {
    INMAA: "INC-2026-1104-03",
    INBOM: "INC-2026-1104-08",
    INKOL: "INC-2026-1104-09",
    INVIZ: "INC-2026-1104-10",
    INHYD: "INC-2026-1104-02",
    INDEL: "INC-2026-1104-05",
    INPUN: "INC-2026-1104-06",
    INBLR: "INC-2026-1104-03",
  }

  useEffect(() => {
    if (selectedPort && portToIncident[selectedPort]) {
      setSelectedId(portToIncident[selectedPort])
    }
  }, [selectedPort])

  useEffect(() => {
    listDisruptions()
      .then((result) => {
        setDisruptions(result.disruptions)
        const selected = result.disruptions.find((item) => item.id === selectedDisruptionId)
        const target = selected && (!selected.port || selected.port === selectedPort)
          ? selected
          : result.disruptions.find((item) => item.port === selectedPort)
        if (target) {
          onSelectDisruption(target.id, target.port)
        } else {
          onSelectDisruption("", selectedPort || "")
        }
      })
      .catch((cause: unknown) => setLoadError(cause instanceof Error ? cause.message : "Unable to load disruptions"))
  }, [version, selectedPort])

  useEffect(() => {
    if (!selectedDisruptionId) {
      setData(null)
      setLoadError("")
      return
    }
    let active = true
    setData(null)
    setLoadError("")
    getDisruption(selectedDisruptionId)
      .then((result) => {
        if (active) {
          setData(result)
          setLoadError("")
        }
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Unable to load disruption details")
      })
    return () => { active = false }
  }, [selectedDisruptionId, version])

  if (!selectedDisruptionId && !loadError) {
    return <section className="panel" role="status">No disruption data is linked to the selected facility.</section>
  }
  if (loadError && !data) return <section className="panel"><p role="alert">Disruptions could not be loaded: {loadError}</p></section>
  if (!data) return <Loading label="DISRUPTION MONITOR" />
  const d = data.disruption
  const impactSummary = data.impact
    ? `${data.impact.medicine} at ${data.impact.facility_name}: ${data.impact.available} ${data.impact.unit} available, ${data.impact.cover_hours}h cover against ${data.impact.delay_hours}h delay.`
    : "No stockout risk is identified from linked inventory data."
  const shipmentSummary = data.affectedShipments.length
    ? data.affectedShipments.map((shipment) =>
      `${shipment.id} to ${shipment.destination_label} · ${shipment.status} · ${shipment.eta_text}`,
    ).join("; ")
    : "No linked in-transit shipment records."
  const selectedDisruption = disruptions.find((item) => item.id === selectedDisruptionId)
  return (
    <>
      <SectionHeader
        eyebrow="DISRUPTION MONITOR"
        title="Disruption Intelligence"
        description="Detect, classify and assess external threats across the medical supply network."
      />
      {disruptions.length > 0 && (
        <section className="panel disruption-select-panel">
          <label className="disruption-select-field">
            Select disruption
            <span className="disruption-select-control">
              <select
                value={selectedDisruptionId}
                onChange={(event) => {
                  const item = disruptions.find((disruption) => disruption.id === event.target.value)
                  if (item) onSelectDisruption(item.id, item.port)
                }}
              >
                {disruptions.map((item) => (
                  <option key={item.id} value={item.id}>{item.title} · {item.id}</option>
                ))}
              </select>
            </span>
            {selectedDisruption && (
              <small className="disruption-select-id">{selectedDisruption.id}</small>
            )}
          </label>
          <span className="panel-kicker">{d.verified ? "Verified source" : "Simulated / unverified"}</span>
        </section>
      )}
      <section className="incident-hero">
        <div className="incident-copy">
          <div className="incident-tags">
            <StatusPill tone="critical">{d.severity} SEVERITY</StatusPill>
            <span className="incident-id">{d.id}</span>
          </div>
          <span className="panel-kicker">FEATURED INCIDENT</span>
          <h2>{d.title}</h2>
          <p>{d.description}</p>
          <p className="incident-context">
            <b>Inventory impact:</b> {impactSummary}<br />
            <b>Linked shipments:</b> {shipmentSummary}
          </p>
          <div className="incident-metrics">
            <div>
              <Icon name="clock" />
              <span>
                <small>Estimated duration</small>
                <b>{d.expected_delay_hours} hours</b>
              </span>
            </div>
            <div>
              <Icon name="truck" />
              <span>
                <small>Affected shipments</small>
                <b>{d.affected_shipments} active</b>
              </span>
            </div>
            <div>
              <Icon name="document" />
              <span>
                <small>Purchase orders</small>
                <b>{d.affected_pos} affected</b>
              </span>
            </div>
            <div>
              <Icon name="pin" />
              <span>
                <small>Impact radius</small>
                <b>{d.radius_km} km</b>
              </span>
            </div>
          </div>
          <button
            className="button primary large"
            onClick={() => runAssessment(d.id)}
            disabled={running}
          >
            <Icon name={running ? "sync" : "spark"} size={18} />
            {running ? "Agents assessing network…" : "Run AI impact assessment"}
            <Icon name="arrow" size={16} />
          </button>
        </div>
        <div className="storm-visual">
          <div className="storm-grid" />
          <div className="storm-rings">
            <i />
            <i />
            <i />
            <span>
              <Icon name="radar" size={25} />
            </span>
          </div>
          <div className="storm-stat top">
            <small>{d.type.replace(/_/g, " ")}</small>
            <b>{d.wind_kmh == null ? "Not reported" : `${d.wind_kmh} km/h`}</b>
          </div>
          <div className="storm-stat bottom">
            <small>EVENT STATUS</small>
            <b>{d.status}</b>
          </div>
          <div className="storm-caption">
            <i />
            <span>
              {d.source}
              <br />
              <b>{d.verified ? "Verified operational source" : "Simulated / unverified event"}</b>
            </span>
          </div>
        </div>
      </section>
      <section className="two-column">
        <article className="panel timeline-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">EVENT PROGRESSION</span>
              <h2>Disaster timeline</h2>
            </div>
            <StatusPill tone="live">LIVE</StatusPill>
          </div>
          <div className="event-timeline">
            {data.timeline.map(({ ts, title, text, state }) => (
              <div className={`timeline-event ${state}`} key={ts}>
                <time>{ts}</time>
                <i />
                <div>
                  <b>{title}</b>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </article>
        <article className="panel infrastructure-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">INFRASTRUCTURE IMPACT</span>
              <h2>Transport network status</h2>
            </div>
          </div>
          <div className="infra-list">
            {data.infrastructure.map(({ label, status, tone, icon }) => (
              <div key={label}>
                <span className={`infra-icon ${tone}`}>
                  <Icon name={icon as IconName} size={17} />
                </span>
                <b>{label}</b>
                <StatusPill tone={tone}>{status}</StatusPill>
              </div>
            ))}
          </div>
        </article>
      </section>
    </>
  )
}

function ShipmentIntelligence({
  selectShipment,
  version,
  selectedPort,
}: {
  selectShipment: (shipment: ShipmentRow) => void
  version: number
  selectedPort?: string
}) {
  const [data, setData] = useState<ShipmentsData | null>(null)
  const [query, setQuery] = useState("")
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState<ShipmentFilters>(emptyShipmentFilters)
  const [draftFilters, setDraftFilters] = useState<ShipmentFilters>(emptyShipmentFilters)
  useEffect(() => {
    getShipments(selectedPort).then(setData).catch(() => setData(null))
  }, [version, selectedPort])
  if (!data) return <Loading label="SHIPMENT INTELLIGENCE" />
  const q = query.trim().toLowerCase()
  const activeFilterCount = countShipmentFilters(filters)
  const origins = [...new Set(data.shipments.map((shipment) => shipment.origin))].sort()
  const destinations = [...new Set(data.shipments.map((shipment) => shipment.destination))].sort()
  const statuses = [...new Set(data.shipments.map((shipment) => shipment.status))].sort()
  const risks = [...new Set(data.shipments.map((shipment) => shipment.risk))].sort()
  const visible = data.shipments.filter((shipment) => {
    const matchesSearch = !q || [
      shipment.id,
      shipment.medicine,
      shipment.destination,
      shipment.origin,
      shipment.batch,
    ].join(" ").toLowerCase().includes(q)
    const temperature = Number.parseFloat(shipment.temp)
    const matchesTemperature = (
      (!filters.tempMin || (Number.isFinite(temperature) && temperature >= Number(filters.tempMin))) &&
      (!filters.tempMax || (Number.isFinite(temperature) && temperature <= Number(filters.tempMax)))
    )
    return matchesSearch &&
      shipment.id.toLowerCase().includes(filters.shipmentId.trim().toLowerCase()) &&
      (!filters.origin || shipment.origin === filters.origin) &&
      (!filters.destination || shipment.destination === filters.destination) &&
      (!filters.status || shipment.status === filters.status) &&
      (!filters.risk || shipment.risk === filters.risk) &&
      (!filters.disruption || (filters.disruption === "affected"
        ? shipment.status === "Disrupted"
        : shipment.status !== "Disrupted")) &&
      matchesTemperature
  })
  return (
    <>
      <SectionHeader
        eyebrow="SHIPMENT INTELLIGENCE"
        title="Shipment Intelligence"
        description="Live journey, condition and disruption visibility for every critical medical consignment."
        actions={
          <>
            <div className="shipment-filter-wrap">
              <button
                className="button secondary"
                type="button"
                aria-expanded={filtersOpen}
                aria-controls="shipment-filter-panel"
                onClick={() => {
                  setDraftFilters(filters)
                  setFiltersOpen((open) => !open)
                }}
              >
                <Icon name="filter" size={16} />
                Filters
                {activeFilterCount > 0 && (
                  <span className="filter-count">{activeFilterCount}</span>
                )}
              </button>
              {filtersOpen && (
                <div
                  className="shipment-filter-panel"
                  id="shipment-filter-panel"
                  role="dialog"
                  aria-label="Filter shipments"
                >
                  <div className="shipment-filter-heading">
                    <div>
                      <b>Filter shipments</b>
                      <small>Combine criteria to narrow the shipment list.</small>
                    </div>
                    <button
                      type="button"
                      className="shipment-filter-close"
                      aria-label="Close filters"
                      onClick={() => setFiltersOpen(false)}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                  <div className="shipment-filter-fields">
                    <label>
                      Shipment ID
                      <input
                        value={draftFilters.shipmentId}
                        placeholder="Search shipment ID"
                        onChange={(event) => setDraftFilters({ ...draftFilters, shipmentId: event.target.value })}
                      />
                    </label>
                    <label>
                      Origin
                      <select
                        value={draftFilters.origin}
                        onChange={(event) => setDraftFilters({ ...draftFilters, origin: event.target.value })}
                      >
                        <option value="">All origins</option>
                        {origins.map((origin) => <option key={origin}>{origin}</option>)}
                      </select>
                    </label>
                    <label>
                      Destination
                      <select
                        value={draftFilters.destination}
                        onChange={(event) => setDraftFilters({ ...draftFilters, destination: event.target.value })}
                      >
                        <option value="">All destinations</option>
                        {destinations.map((destination) => <option key={destination}>{destination}</option>)}
                      </select>
                    </label>
                    <label>
                      Shipment status
                      <select
                        value={draftFilters.status}
                        onChange={(event) => setDraftFilters({ ...draftFilters, status: event.target.value })}
                      >
                        <option value="">All statuses</option>
                        {statuses.map((status) => <option key={status}>{status}</option>)}
                      </select>
                    </label>
                    <label>
                      Risk level
                      <select
                        value={draftFilters.risk}
                        onChange={(event) => setDraftFilters({ ...draftFilters, risk: event.target.value })}
                      >
                        <option value="">All risk levels</option>
                        {risks.map((risk) => <option key={risk}>{risk}</option>)}
                      </select>
                    </label>
                    <label>
                      Disruption status
                      <select
                        value={draftFilters.disruption}
                        onChange={(event) => setDraftFilters({ ...draftFilters, disruption: event.target.value as ShipmentFilters["disruption"] })}
                      >
                        <option value="">All shipments</option>
                        <option value="affected">Affected by disruption</option>
                        <option value="unaffected">Not affected</option>
                      </select>
                    </label>
                    <fieldset className="shipment-temperature-filter">
                      <legend>Temperature range (°C)</legend>
                      <label>
                        <span className="sr-only">Minimum temperature in Celsius</span>
                        <input
                          type="number"
                          step="0.1"
                          value={draftFilters.tempMin}
                          placeholder="Min"
                          onChange={(event) => setDraftFilters({ ...draftFilters, tempMin: event.target.value })}
                        />
                      </label>
                      <span>to</span>
                      <label>
                        <span className="sr-only">Maximum temperature in Celsius</span>
                        <input
                          type="number"
                          step="0.1"
                          value={draftFilters.tempMax}
                          placeholder="Max"
                          onChange={(event) => setDraftFilters({ ...draftFilters, tempMax: event.target.value })}
                        />
                      </label>
                    </fieldset>
                  </div>
                  <div className="shipment-filter-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setFilters(emptyShipmentFilters)
                        setDraftFilters(emptyShipmentFilters)
                      }}
                    >
                      Clear all
                    </button>
                    <div>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setFiltersOpen(false)}
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        className="button primary"
                        onClick={() => {
                          setFilters(draftFilters)
                          setFiltersOpen(false)
                        }}
                      >
                        Apply filters
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button className="button secondary" onClick={() => downloadJson("supplyshield-shipments.json", data.shipments)}>
              <Icon name="download" size={16} />
              Export
            </button>
          </>
        }
      />
      <section className="sub-kpis">
        {data.kpis.map(({ value, label, icon }) => (
          <div key={label}>
            <span>
              <Icon name={icon as IconName} size={17} />
            </span>
            <b>{value}</b>
            <small>{label}</small>
          </div>
        ))}
      </section>
      <section className="panel data-panel">
        <div className="table-toolbar">
          <div className="table-search">
            <Icon name="search" size={16} />
            <input
              placeholder="Search shipment, medicine or destination"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div>
            <StatusPill tone="critical">{data.criticalCount} CRITICAL</StatusPill>
            <span className="result-count">
              Showing {visible.length} of {data.totalInTransit} shipments
            </span>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Shipment</th>
                <th>Medicine / batch</th>
                <th>Journey</th>
                <th>Current route</th>
                <th>ETA</th>
                <th>Temperature</th>
                <th>Status</th>
                <th>Risk</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td className="shipment-empty-state" colSpan={9} role="status">
                    No shipments match the selected filters.
                  </td>
                </tr>
              ) : visible.map((shipment) => (
                <tr key={shipment.id} onClick={() => selectShipment(shipment)}>
                  <td>
                    <b className="shipment-id">{shipment.id}</b>
                  </td>
                  <td>
                    <div className="medicine-cell">
                      <span>
                        <Icon name="medicine" size={16} />
                      </span>
                      <div>
                        <b>{shipment.medicine}</b>
                        <small>{shipment.batch}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="journey">
                      <span>{shipment.origin}</span>
                      <i>
                        <Icon name="arrow" size={12} />
                      </i>
                      <span>{shipment.destination}</span>
                    </div>
                  </td>
                  <td>{shipment.route}</td>
                  <td
                    className={
                      shipment.eta.includes("delayed") ? "red-text" : ""
                    }
                  >
                    {shipment.eta}
                  </td>
                  <td>
                    <span className="temp-reading">
                      <i />
                      {shipment.temp}
                    </span>
                  </td>
                  <td>
                    <StatusPill
                      tone={
                        shipment.status === "Disrupted"
                          ? "critical"
                          : shipment.status === "Monitoring"
                            ? "warning"
                            : "success"
                      }
                    >
                      {shipment.status}
                    </StatusPill>
                  </td>
                  <td>
                    <span className={`risk-tag ${shipment.risk.toLowerCase()}`}>
                      {shipment.risk}
                    </span>
                  </td>
                  <td>
                    <button
                      className="row-open"
                      aria-label={`Open ${shipment.id}`}
                    >
                      <Icon name="chevron" size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

interface ShipmentFilters {
  shipmentId: string
  origin: string
  destination: string
  status: string
  risk: string
  disruption: "" | "affected" | "unaffected"
  tempMin: string
  tempMax: string
}

const emptyShipmentFilters: ShipmentFilters = {
  shipmentId: "",
  origin: "",
  destination: "",
  status: "",
  risk: "",
  disruption: "",
  tempMin: "",
  tempMax: "",
}

function countShipmentFilters(filters: ShipmentFilters) {
  return [
    filters.shipmentId.trim(),
    filters.origin,
    filters.destination,
    filters.status,
    filters.risk,
    filters.disruption,
    filters.tempMin || filters.tempMax,
  ].filter(Boolean).length
}

function ShipmentDrawer({
  shipment,
  close,
  navigate,
}: {
  shipment: ShipmentRow
  close: () => void
  navigate: (screen: Screen) => void
}) {
  const [note, setNote] = useState("")
  const [compliant, setCompliant] = useState(true)
  useEffect(() => {
    getShipment(shipment.id)
      .then((d) => {
        setNote(d.recoveryNote)
        setCompliant(d.tempCompliance.compliant)
      })
      .catch(() => setNote(""))
  }, [shipment.id])
  return (
    <div className="drawer-layer" onMouseDown={close}>
      <aside
        className="shipment-drawer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <div>
            <span className="panel-kicker">SHIPMENT DETAIL</span>
            <h2>{shipment.id}</h2>
          </div>
          <button onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-hero">
          <div className="medicine-badge">
            <Icon name="medicine" size={22} />
          </div>
          <div>
            <b>{shipment.medicine}</b>
            <span>Batch {shipment.batch}</span>
          </div>
          <span className={`risk-tag ${shipment.risk.toLowerCase()}`}>
            {shipment.risk} risk
          </span>
        </div>
        <div className="route-card">
          <div>
            <i className="origin-dot" />
            <span>
              <small>ORIGIN</small>
              <b>{shipment.origin}</b>
            </span>
          </div>
          <div className="route-path">
            <i />
            <span>
              <Icon name="truck" size={15} />
            </span>
          </div>
          <div>
            <i className="destination-dot" />
            <span>
              <small>DESTINATION</small>
              <b>{shipment.destination}</b>
            </span>
          </div>
        </div>
        <div className="detail-grid">
          <div>
            <small>Purchase order</small>
            <b>{shipment.po}</b>
          </div>
          <div>
            <small>Current ETA</small>
            <b className="red-text">{shipment.eta}</b>
          </div>
          <div>
            <small>Current route</small>
            <b>{shipment.route}</b>
          </div>
          <div>
            <small>Temperature</small>
            <b>{shipment.temp}</b>
          </div>
        </div>
        <div className="temperature-card">
          <div>
            <span>
              <Icon name="temperature" size={17} />
              Temperature history
            </span>
            <StatusPill tone={compliant ? "success" : "critical"}>
              {compliant ? "COMPLIANT" : "EXCURSION"}
            </StatusPill>
          </div>
          <div className="temp-chart">
            <svg viewBox="0 0 340 100">
              <path className="safe-zone" d="M0 28H340V78H0z" />
              <path className="grid-line" d="M0 28h340M0 53h340M0 78h340" />
              <path
                className="temp-line"
                d="M5 59 C45 56 58 58 85 52 S125 49 150 56 205 44 235 54 285 58 335 53"
              />
            </svg>
            <span className="limit high">8°C</span>
            <span className="limit low">2°C</span>
          </div>
        </div>
        <div className="drawer-note">
          <Icon name="spark" size={17} />
          <p>
            <b>SupplyShield intelligence</b>
            {note ||
              "This shipment is included in recovery scenario B. Transfer stock is available in Bengaluru while the original consignment remains protected at Chennai."}
          </p>
        </div>
        <button
          className="button primary full"
          onClick={() => {
            close()
            navigate("AI Recovery Planning")
          }}
        >
          Open recovery scenario <Icon name="arrow" size={15} />
        </button>
      </aside>
    </div>
  )
}

function InventoryRisk({
  navigate,
  version,
  selectedPort,
}: {
  navigate: (screen: Screen) => void
  version: number
  selectedPort?: string
}) {
  const [data, setData] = useState<InventoryData | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState<InventoryFilters>(emptyInventoryFilters)
  const [draftFilters, setDraftFilters] = useState<InventoryFilters>(emptyInventoryFilters)
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const filterPanelRef = useRef<HTMLDivElement>(null)
  const [filterPanelPosition, setFilterPanelPosition] = useState({ top: 12, left: 12 })
  useEffect(() => {
    getInventory(selectedPort).then(setData).catch(() => setData(null))
  }, [version, selectedPort])
  useEffect(() => {
    if (!filtersOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [filtersOpen])
  useLayoutEffect(() => {
    if (!filtersOpen) return
    const button = filterButtonRef.current
    const panel = filterPanelRef.current
    if (!button || !panel) return
    const positionPanel = () => {
      const anchor = button.getBoundingClientRect()
      const panelBounds = panel.getBoundingClientRect()
      const margin = 12
      if (window.innerWidth <= 600) {
        setFilterPanelPosition({
          top: Math.max(margin, (window.innerHeight - panelBounds.height) / 2),
          left: Math.max(margin, (window.innerWidth - panelBounds.width) / 2),
        })
        return
      }
      setFilterPanelPosition({
        top: Math.max(margin, Math.min(anchor.bottom + 8, window.innerHeight - panelBounds.height - margin)),
        left: Math.max(margin, Math.min(anchor.right - panelBounds.width, window.innerWidth - panelBounds.width - margin)),
      })
    }
    positionPanel()
    window.addEventListener("resize", positionPanel)
    return () => window.removeEventListener("resize", positionPanel)
  }, [filtersOpen])
  if (!data) return <Loading label="INVENTORY INTELLIGENCE" />
  const c = data.critical
  const actionUrgency = getInventoryActionUrgency(c)
  const activeFilterCount = countInventoryFilters(filters)
  const facilities = [...new Set(data.rows.map((row) => row.facility))].sort()
  const medicines = [...new Set(data.rows.map((row) => row.medicine))].sort()
  const riskStates = [...new Set(data.rows.map((row) => row.risk))].sort()
  const replenishments = [...new Set(data.rows.map((row) => row.replenishment))].sort()
  const visibleRows = data.rows.filter((row) => {
    const available = parseInventoryNumber(row.available)
    const cover = parseInventoryNumber(row.cover)
    return (!filters.facility || row.facility === filters.facility) &&
      (!filters.medicine || row.medicine === filters.medicine) &&
      (!filters.risk || row.risk === filters.risk) &&
      (!filters.replenishment || row.replenishment === filters.replenishment) &&
      (!filters.availableMin || (available !== null && available >= Number(filters.availableMin))) &&
      (!filters.availableMax || (available !== null && available <= Number(filters.availableMax))) &&
      (!filters.coverMin || (cover !== null && cover >= Number(filters.coverMin))) &&
      (!filters.coverMax || (cover !== null && cover <= Number(filters.coverMax)))
  })
  return (
    <>
      <SectionHeader
        eyebrow="INVENTORY INTELLIGENCE"
        title="Medicine Availability Intelligence"
        description="Predict stockouts before they occur and coordinate inventory across hospitals and warehouses."
      />
      <section className="inventory-layout">
        <article className="critical-stock-card">
          <div className="critical-glow" />
          <div className="critical-stock-header">
            <div>
              <StatusPill tone="critical">CRITICAL STOCKOUT RISK</StatusPill>
              <h2>
                {c.medicine} · {c.facility}
              </h2>
              <p>
                Projected inventory exhaustion occurs {c.gapHours} hours before
                replenishment arrives.
              </p>
            </div>
            <span className="medicine-large">
              <Icon name="medicine" size={29} />
            </span>
          </div>
          <div className="stock-numbers">
            <div>
              <small>Available stock</small>
              <b>{c.available}</b>
              <span>{c.unit}</span>
            </div>
            <div>
              <small>Daily demand</small>
              <b>{c.demandPerDay}</b>
              <span>{c.unit} / day</span>
            </div>
            <div>
              <small>Stock cover</small>
              <b className="critical-value">{c.coverDays}</b>
              <span>days remaining</span>
            </div>
            <div>
              <small>Replenishment delay</small>
              <b className="critical-value">{c.delayHours}</b>
              <span>hours</span>
            </div>
          </div>
          <div className="stock-forecast">
            <div className="forecast-labels">
              <span>
                NOW · {c.available} {c.unit.toUpperCase()}
              </span>
              <span className="stockout-label">STOCKOUT · {c.stockoutHours}H</span>
              <span>REPLENISHMENT · {c.delayHours}H</span>
            </div>
            <div className="forecast-track">
              <div className="stock-fill" />
              <div className="danger-gap" />
              <i className="now-pin" />
              <i className="stockout-pin" />
              <i className="replenish-pin" />
            </div>
            <div className="forecast-axis">
              <span>0h</span>
              <span>12h</span>
              <span>24h</span>
              <span>36h</span>
              <span>48h</span>
            </div>
          </div>
          <div className="critical-action">
            <div>
              <Icon name="alert" size={18} />
              <p>
                <b>{actionUrgency}</b>
                {Number.isFinite(c.transferQty) &&
                  c.transferQty > 0 &&
                  c.donorFacility !== "No donor recommended" && (
                    <>
                      Transfer {c.transferQty} {c.unit} from {c.donorFacility}{" "}
                      to restore {c.restoredCoverDays} days of cover.
                    </>
                  )}
              </p>
            </div>
            <button
              className="button light"
              onClick={() => navigate("AI Recovery Planning")}
            >
              Review recovery plan <Icon name="arrow" size={15} />
            </button>
          </div>
        </article>
        <article className="panel priority-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">CARE CRITICALITY</span>
              <h2>Hospital priority</h2>
            </div>
          </div>
          {data.priorities.map(({ name, ward, priority, tone }) => (
            <div className="priority-row" key={name}>
              <span className={`priority-badge ${tone}`}>{priority}</span>
              <div>
                <b>{name}</b>
                <small>{ward}</small>
              </div>
              <div className="priority-bars">
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
          ))}
        </article>
      </section>
      <section className="panel inventory-table">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">NETWORK INVENTORY</span>
            <h2>Stock-cover overview</h2>
          </div>
          <div className="inventory-table-actions">
            <div className="shipment-filter-wrap">
              <button
                ref={filterButtonRef}
                type="button"
                className="button secondary"
                aria-expanded={filtersOpen}
                aria-controls="inventory-filter-panel"
                onClick={() => {
                  setDraftFilters(filters)
                  setFiltersOpen((open) => !open)
                }}
              >
                <Icon name="filter" size={14} />
                Filter medicines
                {activeFilterCount > 0 && (
                  <span className="filter-count">{activeFilterCount}</span>
                )}
              </button>
              {filtersOpen && (
                <div
                  ref={filterPanelRef}
                  className="shipment-filter-panel inventory-filter-panel"
                  id="inventory-filter-panel"
                  role="dialog"
                  aria-label="Filter inventory"
                  style={{ top: filterPanelPosition.top, left: filterPanelPosition.left }}
                >
                  <div className="shipment-filter-heading">
                    <div>
                      <b>Filter inventory</b>
                      <small>Combine criteria to narrow stock records.</small>
                    </div>
                    <button
                      type="button"
                      className="shipment-filter-close"
                      aria-label="Close inventory filters"
                      onClick={() => setFiltersOpen(false)}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                  <div className="shipment-filter-fields inventory-filter-scroll">
                    <label>
                      Facility
                      <select
                        value={draftFilters.facility}
                        onChange={(event) => setDraftFilters({ ...draftFilters, facility: event.target.value })}
                      >
                        <option value="">All facilities</option>
                        {facilities.map((facility) => <option key={facility}>{facility}</option>)}
                      </select>
                    </label>
                    <label>
                      Medicine
                      <select
                        value={draftFilters.medicine}
                        onChange={(event) => setDraftFilters({ ...draftFilters, medicine: event.target.value })}
                      >
                        <option value="">All medicines</option>
                        {medicines.map((medicine) => <option key={medicine}>{medicine}</option>)}
                      </select>
                    </label>
                    <fieldset className="shipment-temperature-filter">
                      <legend>Available stock quantity</legend>
                      <label>
                        <span className="sr-only">Minimum available stock quantity</span>
                        <input
                          type="number"
                          min="0"
                          value={draftFilters.availableMin}
                          placeholder="Min"
                          onChange={(event) => setDraftFilters({ ...draftFilters, availableMin: event.target.value })}
                        />
                      </label>
                      <span>to</span>
                      <label>
                        <span className="sr-only">Maximum available stock quantity</span>
                        <input
                          type="number"
                          min="0"
                          value={draftFilters.availableMax}
                          placeholder="Max"
                          onChange={(event) => setDraftFilters({ ...draftFilters, availableMax: event.target.value })}
                        />
                      </label>
                    </fieldset>
                    <fieldset className="shipment-temperature-filter">
                      <legend>Stock cover (days)</legend>
                      <label>
                        <span className="sr-only">Minimum stock cover in days</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={draftFilters.coverMin}
                          placeholder="Min"
                          onChange={(event) => setDraftFilters({ ...draftFilters, coverMin: event.target.value })}
                        />
                      </label>
                      <span>to</span>
                      <label>
                        <span className="sr-only">Maximum stock cover in days</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          value={draftFilters.coverMax}
                          placeholder="Max"
                          onChange={(event) => setDraftFilters({ ...draftFilters, coverMax: event.target.value })}
                        />
                      </label>
                    </fieldset>
                    <label>
                      Risk state
                      <select
                        value={draftFilters.risk}
                        onChange={(event) => setDraftFilters({ ...draftFilters, risk: event.target.value })}
                      >
                        <option value="">All risk states</option>
                        {riskStates.map((risk) => <option key={risk}>{risk}</option>)}
                      </select>
                    </label>
                    <label>
                      Replenishment
                      <select
                        value={draftFilters.replenishment}
                        onChange={(event) => setDraftFilters({ ...draftFilters, replenishment: event.target.value })}
                      >
                        <option value="">All replenishment statuses</option>
                        {replenishments.map((replenishment) => (
                          <option key={replenishment}>{replenishment}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="shipment-filter-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setFilters(emptyInventoryFilters)
                        setDraftFilters(emptyInventoryFilters)
                      }}
                    >
                      Clear all
                    </button>
                    <div>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setFiltersOpen(false)}
                      >
                        Close
                      </button>
                      <button
                        type="button"
                        className="button primary"
                        onClick={() => {
                          setFilters(draftFilters)
                          setFiltersOpen(false)
                        }}
                      >
                        Apply filters
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              className="button secondary"
              onClick={() => downloadJson("supplyshield-inventory.json", data.rows)}
            >
              <Icon name="download" size={14} />
              Export
            </button>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Facility</th>
                <th>Medicine</th>
                <th>Available</th>
                <th>Demand</th>
                <th>Stock cover</th>
                <th>Replenishment</th>
                <th>Risk state</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td className="shipment-empty-state" colSpan={7} role="status">
                    No inventory records match the selected filters.
                  </td>
                </tr>
              ) : visibleRows.map((row) => (
                <tr key={row.facility}>
                  <td>
                    <b>{row.facility}</b>
                  </td>
                  <td>
                    <b>{row.medicine}</b>
                  </td>
                  <td>{row.available}</td>
                  <td>{row.demand}</td>
                  <td>{row.cover}</td>
                  <td>{row.replenishment}</td>
                  <td>
                    <StatusPill
                      tone={
                        row.risk === "Critical"
                          ? "critical"
                          : row.risk === "High"
                            ? "warning"
                            : "success"
                      }
                    >
                      {row.risk}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

interface InventoryFilters {
  facility: string
  medicine: string
  availableMin: string
  availableMax: string
  coverMin: string
  coverMax: string
  risk: string
  replenishment: string
}

const emptyInventoryFilters: InventoryFilters = {
  facility: "",
  medicine: "",
  availableMin: "",
  availableMax: "",
  coverMin: "",
  coverMax: "",
  risk: "",
  replenishment: "",
}

function parseInventoryNumber(value: string) {
  const parsed = Number.parseFloat(value.replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function countInventoryFilters(filters: InventoryFilters) {
  return [
    filters.facility,
    filters.medicine,
    filters.availableMin || filters.availableMax,
    filters.coverMin || filters.coverMax,
    filters.risk,
    filters.replenishment,
  ].filter(Boolean).length
}

function getInventoryActionUrgency(critical: InventoryData["critical"]) {
  const available = Number(critical.available)
  const dailyDemand = Number(critical.demandPerDay)
  const replenishmentHours = Number(critical.delayHours)
  if (
    !Number.isFinite(available) || available < 0 ||
    !Number.isFinite(dailyDemand) || dailyDemand <= 0 ||
    !Number.isFinite(replenishmentHours) || replenishmentHours < 0 ||
    !critical.priority
  ) {
    return "Stock risk assessment requires updated inventory information."
  }

  const stockoutHours = (available / dailyDemand) * 24
  const formatHours = (hours: number) => {
    const rounded = Math.round(hours * 10) / 10
    if (rounded < 1) return "less than 1 hour"
    return `${rounded} ${rounded === 1 ? "hour" : "hours"}`
  }

  if (replenishmentHours >= stockoutHours) {
    if (critical.priority === "P1") {
      return `Immediate action required — stockout is expected in ${formatHours(stockoutHours)}, before replenishment arrives.`
    }
    return `Action required within ${formatHours(stockoutHours)} — stockout is expected before replenishment arrives.`
  }

  const remainingCover = stockoutHours - replenishmentHours
  if (critical.priority === "P1" && remainingCover < stockoutHours / 4) {
    return `Monitor inventory closely — replenishment is expected in ${formatHours(replenishmentHours)}, near the stockout deadline.`
  }
  return `Inventory is currently sufficient — replenishment is expected in ${formatHours(replenishmentHours)}, before stockout in ${formatHours(stockoutHours)}.`
}

function RecoveryPlanning({
  navigate,
  version,
  selectedPort,
  selectedDisruptionId,
}: {
  navigate: (screen: Screen) => void
  version: number
  selectedPort?: string
  selectedDisruptionId: string
}) {
  const [data, setData] = useState<PlanData | null>(null)
  const [loadError, setLoadError] = useState("")
  useEffect(() => {
    let active = true
    setData(null)
    setLoadError("")
    getCurrentPlan(selectedPort, selectedDisruptionId)
      .then((result) => {
        if (active) setData(result)
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Unable to load the selected recovery plan.")
      })
    return () => { active = false }
  }, [version, selectedPort, selectedDisruptionId])

  if (!data && !loadError) return <Loading label="AGENTIC RECOVERY" />
  if (!data) {
    return (
      <>
        <SectionHeader
          eyebrow="AGENTIC RECOVERY"
          title="AI Recovery Command"
          description="Recovery recommendations are scoped to the selected disruption and facility."
        />
        <section className="panel" role="status">
          <p>{loadError}</p>
          <button className="button secondary" onClick={() => navigate("Disruption Monitor")}>
            Open Disruption Monitor
          </button>
        </section>
      </>
    )
  }
  const recommended = data.recommended
  const ribbon = data.ribbon

  const toneOf = (o: PlanData["options"][number]) =>
    o.recommended ? "recommended" : !o.eligible ? "rejected" : "high-risk"
  const statusOf = (o: PlanData["options"][number]) =>
    o.recommended ? "RECOMMENDED" : !o.eligible ? "REJECTED" : "HIGH RISK"
  const riskOf = (o: PlanData["options"][number]) =>
    o.recommended ? "Lowest risk" : o.code === "WAIT" ? "Stockout likely" : !o.eligible ? "Not feasible" : "Low service risk"
  const scoreOf = (value: number | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
  const barsOf = (o: PlanData["options"][number]) => [
    o.scores.speed ?? 0,
    o.scores.cost ?? 0,
    o.scores.protection ?? 0,
    o.scores.compliance ?? 0,
  ]
  const comparisonTone: Record<string, string> = { "OPT-A": "red", "OPT-B": "cyan", "OPT-C": "amber" }

  return (
    <>
      <SectionHeader
        eyebrow="AGENTIC RECOVERY"
        title="AI Recovery Command"
        description="Multi-agent analysis of recovery strategies, operational trade-offs and pharmaceutical constraints."
        actions={<StatusPill tone="live">ANALYSIS COMPLETE</StatusPill>}
      />
      <section className="workflow-ribbon">
        {ribbon.map((agent, index) => (
          <div className={`workflow-stage ${agent.warning ? "warning" : ""}`} key={agent.name}>
            <span>
              <Icon name={agent.icon as IconName} size={17} />
            </span>
            <div>
              <small>0{index + 1}</small>
              <b>{agent.name.replace(" Agent", "")}</b>
              <p>{agent.status}</p>
            </div>
            {index < ribbon.length - 1 && (
              <i className="stage-connector">
                <Icon name="arrow" size={13} />
              </i>
            )}
          </div>
        ))}
      </section>
      <section className="recommendation-banner">
        <div className="recommendation-mark">
          <Icon name="spark" size={25} />
        </div>
        <div>
          <span>{recommended ? "SUPPLYSHIELD RECOMMENDS" : "NO FEASIBLE RECOVERY OPTION"}</span>
          <h2>{recommended ? recommended.title : "Manual intervention required"}</h2>
          <p>
            {recommended
              ? recommended.reason
              : "No recovery scenario passed all inventory, logistics, deadline, and compliance checks."}
          </p>
        </div>
        <div className="recommendation-score">
          <small>RECOMMENDATION SCORE</small>
          <b>{data.plan.score}</b>
          <span>/100</span>
        </div>
        {recommended && (
          <button className="button light" onClick={() => navigate("Approval Centre")}>
            Review for approval <Icon name="arrow" size={15} />
          </button>
        )}
      </section>
      <section className="scenario-grid">
        {data.options.map((o) => (
          <ScenarioCard
            key={o.id}
            option={o.code.replace("OPT-", "OPTION ")}
            title={o.title}
            status={statusOf(o)}
            tone={toneOf(o)}
            eta={o.eta_hours >= 48 ? "48+ hours" : `${o.eta_hours} hours`}
            cost={`$${Number(o.cost_usd).toLocaleString("en-US")}`}
            risk={riskOf(o)}
            compliance={o.compliant ? "Passed" : "Failed"}
            reason={recoveryOptionExplanation(o.reason, o.checks, Boolean(o.eligible))}
            bars={barsOf(o)}
          />
        ))}
      </section>
      <section className="panel comparison-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">NORMALIZED TRADE-OFF ANALYSIS</span>
            <h2>Scenario comparison</h2>
          </div>
          <span className="model-note">Values computed by the scoring engine from database records</span>
        </div>
        <div className="comparison-chart">
          <div className="comparison-labels">
            <span>Speed</span>
            <span>Cost efficiency</span>
            <span>Service protection</span>
            <span>Compliance</span>
          </div>
          {data.options.map((o) => (
            <div className="comparison-row" key={o.id}>
              <b>{o.code === "OPT-C" ? "Wait" : o.title}</b>
              <div>
                {barsOf(o).map((value, i) => (
                  <span key={i}>
                    <i className={comparisonTone[o.code] || "cyan"} style={{ width: `${value}%` }} />
                    <small>{value}</small>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

function recoveryOptionExplanation(
  reason: string,
  checks: { label: string; pass: number | boolean; note: string }[] = [],
  eligible = false,
) {
  if (eligible) {
    return "An alternative recovery strategy offers better delivery reliability and lower supply interruption risk."
  }

  const failedEvidence = checks
    .filter((check) => !check.pass)
    .map((check) => `${check.label}: ${check.note}`)
    .join(" ")
  const evidence = `${failedEvidence} ${reason}`.toLocaleLowerCase()

  if (/no inventory record/.test(evidence)) {
    return "The proposed source cannot meet the required medicine quantity, so this recovery option is not recommended."
  }
  if (/insufficient transferable stock|safety stock|safety-stock|below.*reserve|below safety/.test(evidence)) {
    return "The selected distribution centre does not have sufficient transferable stock while maintaining its required safety inventory."
  }
  if (/deadline|projected stockout|stock cover|stockout|replenishment arrives|eta .* after/.test(evidence)) {
    return "This option is not recommended because the estimated delivery time exceeds the medicine replenishment deadline."
  }
  if (/batch validity|batch .*expired|expiry|expired/.test(evidence)) {
    return "This recovery option does not meet the required medicine batch validity conditions."
  }
  if (/reefer vehicle|vehicle is assigned|vehicle available|no qualified reefer/.test(evidence)) {
    return "This option is not recommended because suitable temperature-controlled transportation is unavailable."
  }
  if (/route|corridor|road access|transportation route/.test(evidence)) {
    return "This option is not recommended because the proposed transportation route is affected by the current disruption."
  }
  if (/temperature|cold.chain|carrier|warehouse qualification|storage.temperature|power outage/.test(evidence)) {
    return "This option cannot be recommended because the required temperature-controlled storage or transportation conditions cannot be guaranteed."
  }
  if (/compliance|mandatory|hard rule|not compliant/.test(evidence)) {
    return "This recovery option does not satisfy all mandatory pharmaceutical safety and compliance requirements."
  }
  return "This option cannot currently be recommended because its operational feasibility has not been established."
}

function ScenarioCard({
  option,
  title,
  status,
  tone,
  eta,
  cost,
  risk,
  compliance,
  reason,
  bars,
}: {
  option: string
  title: string
  status: string
  tone: string
  eta: string
  cost: string
  risk: string
  compliance: string
  reason: string
  bars: (number | null)[]
}) {
  return (
    <article className={`scenario-card ${tone}`}>
      <div className="scenario-top">
        <span>{option}</span>
        <StatusPill
          tone={tone === "recommended" ? "success" : tone === "rejected" ? "critical" : "warning"}
        >
          {status}
        </StatusPill>
      </div>
      <h2>{title}</h2>
      <div className="scenario-stats">
        <div>
          <Icon name="clock" size={15} />
          <span>
            <small>ETA</small>
            <b>{eta}</b>
          </span>
        </div>
        <div>
          <Icon name="document" size={15} />
          <span>
            <small>EST. COST</small>
            <b>{cost}</b>
          </span>
        </div>
      </div>
      <div className="scenario-bars">
        {["Speed", "Cost efficiency", "Service protection", "Compliance"].map((label, index) => (
          <div key={label}>
            <span>{label}</span>
            <i>
              <b style={{ width: `${bars[index]}%` }} />
            </i>
            <small>{bars[index] === null ? "N/A" : bars[index]}</small>
          </div>
        ))}
      </div>
      <div className="scenario-result">
        <span>
          <small>RISK</small>
          <b>{risk}</b>
        </span>
        <span>
          <small>COMPLIANCE</small>
          <b>{compliance}</b>
        </span>
      </div>
      <p>
        <Icon
          name={tone === "rejected" ? "close" : tone === "recommended" ? "check" : "alert"}
          size={15}
        />
        {reason}
      </p>
    </article>
  )
}

function Compliance({
  version,
  selectedPort,
  selectedDisruptionId,
}: {
  version: number
  selectedPort?: string
  selectedDisruptionId: string
}) {
  const [data, setData] = useState<ComplianceData | null>(null)
  useEffect(() => {
    let active = true
    setData(null)
    getCompliance(selectedPort, selectedDisruptionId)
      .then((result) => { if (active) setData(result) })
      .catch(() => { if (active) setData(null) })
    return () => { active = false }
  }, [version, selectedPort, selectedDisruptionId])

  if (!data) return <Loading label="PHARMACEUTICAL GOVERNANCE" />
  const t = data.telemetry
  const b = data.batchRecord

  return (
    <>
      <SectionHeader
        eyebrow="PHARMACEUTICAL GOVERNANCE"
        title="Cold-Chain Safety & Compliance"
        description={data.plan
          ? `Plan ${data.plan.id} · disruption ${data.plan.disruptionId} · validate temperature integrity, carrier eligibility and batch controls before any recovery action.`
          : "Validate temperature integrity, carrier eligibility and batch controls before any recovery action."}
      />
      <section className="compliance-summary">
        <div className="compliance-gauge">
          <svg viewBox="0 0 120 70">
            <path d="M15 60a45 45 0 0 1 90 0" />
            <path
              className="gauge-progress"
              d="M15 60a45 45 0 0 1 90 0"
              style={{ strokeDasharray: `${(data.networkCompliance / 100) * 141.4} 142` }}
            />
          </svg>
          <span>
            <b>{data.networkCompliance}%</b>
            <small>Network compliance</small>
          </span>
        </div>
        <div>
          <span className="panel-kicker">REQUIRED STORAGE RANGE</span>
          <b className="temp-range">
            +{data.range.min}°C <i>to</i> +{data.range.max}°C
          </b>
          <p>{data.appliesTo}</p>
        </div>
        <div className="summary-divider" />
        <div className="compliance-checks">
          {data.checks.map((check) => (
            <span key={check}>
              <Icon name="check" size={15} />
              {check}
            </span>
          ))}
        </div>
      </section>
      <section className="compliance-layout">
        <article className="panel temperature-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">LIVE SENSOR TELEMETRY</span>
              <h2>Temperature history · {t.batch}</h2>
            </div>
            <StatusPill tone={t.withinRange ? "success" : "critical"}>
              {t.withinRange ? "WITHIN RANGE" : "EXCURSION"}
            </StatusPill>
          </div>
          <div className="large-temp-chart">
            <div className="chart-y">
              <span>10°</span>
              <span>8°</span>
              <span>6°</span>
              <span>4°</span>
              <span>2°</span>
              <span>0°</span>
            </div>
            <svg viewBox="0 0 650 220" preserveAspectRatio="none">
              <path className="compliance-zone" d="M0 45h650v130H0z" />
              <path className="chart-grid" d="M0 45h650M0 88h650M0 131h650M0 175h650" />
              <path
                className="temperature-line"
                d={telemetryPath(t.readings.map((r) => r.temp_c))}
              />
              <path
                className="temperature-area"
                d={`${telemetryPath(t.readings.map((r) => r.temp_c))}V220H0Z`}
              />
            </svg>
            <div className="chart-x">
              {t.readings.length > 0 && (
                <>
                  <span>{shortTime(t.readings[0].ts)}</span>
                  <span>{shortTime(t.readings[Math.floor(t.readings.length / 4)]?.ts)}</span>
                  <span>{shortTime(t.readings[Math.floor(t.readings.length / 2)]?.ts)}</span>
                  <span>{shortTime(t.readings[Math.floor((t.readings.length * 3) / 4)]?.ts)}</span>
                  <span>Now</span>
                </>
              )}
            </div>
            <div className="current-temp">
              <i />
              {t.current.toFixed(1)}°C
            </div>
          </div>
          <div className="sensor-stats">
            <div>
              <small>MINIMUM</small>
              <b>{t.min.toFixed(1)}°C</b>
            </div>
            <div>
              <small>MAXIMUM</small>
              <b>{t.max.toFixed(1)}°C</b>
            </div>
            <div>
              <small>AVERAGE</small>
              <b>{t.avg.toFixed(1)}°C</b>
            </div>
            <div>
              <small>EXCURSIONS</small>
              <b>{t.excursions}</b>
            </div>
          </div>
        </article>
        <article className="panel batch-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">PRODUCT RECORD</span>
              <h2>Batch & certification</h2>
            </div>
          </div>
          <div className="batch-hero">
            <span>
              <Icon name="medicine" size={24} />
            </span>
            <div>
              <b>{b.name}</b>
              <small>Batch {b.batch}</small>
            </div>
          </div>
          <div className="batch-details">
            <div>
              <span>Manufactured</span>
              <b>{b.manufactured}</b>
            </div>
            <div>
              <span>Expiry</span>
              <b>{b.expiry}</b>
            </div>
            <div>
              <span>GDP classification</span>
              <b>{b.gdp}</b>
            </div>
            <div>
              <span>Required range</span>
              <b>{b.range}</b>
            </div>
          </div>
          <div className="certificate">
            <Icon name="shield" size={20} />
            <div>
              <b>{b.valid ? "Quality record verified" : "Quality record issue"}</b>
              <small>{b.note}</small>
            </div>
            <StatusPill tone={b.valid ? "success" : "critical"}>
              {b.valid ? "VALID" : "REVIEW"}
            </StatusPill>
          </div>
        </article>
      </section>
      <section className="validation-grid">
        {data.validations.map((v) => (
          <ValidationCard
            key={v.id}
            title={v.title}
            detail={`Option ${v.id} · ${v.medicine} · ${v.qty} ${v.unit} from ${v.donorWarehouse} · ETA ${v.etaHours}h · $${v.costUsd.toLocaleString("en-US")}`}
            status={v.status}
            tone={v.tone}
            recommendationStatus={v.id === data.plan?.recommendedOptionId
              && v.recommendationStatus === "RECOMMENDED"
              ? "AI RECOMMENDED"
              : v.recommendationStatus}
            recommendationTone={v.recommendationTone}
            checks={v.checks.map((check) => ({
              ...check,
              note: check.pass ? check.note : recoveryOptionExplanation(check.note, [check]),
            }))}
            reason={recoveryOptionExplanation(
              v.reason,
              v.checks,
              v.recommendationStatus === "HIGH RISK",
            )}
          />
        ))}
      </section>
    </>
  )
}

function telemetryPath(values: number[]) {
  if (values.length === 0) return "M0 131"
  const minV = 0
  const maxV = 10
  const step = 650 / Math.max(values.length - 1, 1)
  const points = values.map((v, i) => {
    const x = Math.round(i * step)
    const y = Math.round(220 - ((Math.min(Math.max(v, minV), maxV) - minV) / (maxV - minV)) * 220)
    return [x, y] as const
  })
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ")
}

function shortTime(ts: string | undefined) {
  if (!ts) return ""
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
}

function ValidationCard({
  title,
  detail,
  status,
  tone,
  recommendationStatus,
  recommendationTone,
  checks,
  reason,
}: {
  title: string
  detail: string
  status: string
  tone: string
  recommendationStatus: string
  recommendationTone: string
  checks: { label: string; pass: boolean; note: string }[]
  reason: string
}) {
  return (
    <article className={`validation-card ${tone}`}>
      <div className="validation-header">
        <div>
          <span className="panel-kicker">RECOVERY OPTION</span>
          <h2>{title}</h2>
          <small className="validation-option-detail">{detail}</small>
        </div>
        <div className="validation-verdicts">
          <span className="validation-status">
            <Icon name={tone === "passed" ? "check" : "close"} size={18} />
            {status}
          </span>
          <span className={`option-recommendation ${recommendationTone}`}>
            {recommendationStatus}
          </span>
        </div>
      </div>
      <div className="validation-checks">
        {checks.map(({ label, pass, note }) => (
          <div key={label}>
            <span className={pass ? "pass" : "fail"}>
              <Icon name={pass ? "check" : "close"} size={14} />
            </span>
            <b>{label}</b>
            <small>{pass ? "Verified" : note || "Not verified"}</small>
          </div>
        ))}
      </div>
      <p>
        <Icon name={tone === "passed" ? "shield" : "alert"} size={16} />
        <span>
          <small>VALIDATION RESULT</small>
          <b>{reason}</b>
        </span>
      </p>
    </article>
  )
}

function ApprovalCentre({
  approval,
  onDecision,
  onBlocked,
  navigate,
  version,
  selectedPort,
}: {
  approval: "pending" | "approved" | "rejected"
  onDecision: (status: "APPROVED" | "REJECTED") => void
  onBlocked: (message: string) => void
  navigate: (screen: Screen) => void
  version: number
  selectedPort?: string
}) {
  const [data, setData] = useState<PlanData | null>(null)
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let active = true
    setData(null)
    setLoadError("")
    getCurrentPlan(selectedPort, selectedDisruptionId)
      .then((result) => {
        if (active) setData(result)
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Unable to load the selected recovery plan.")
      })
    return () => { active = false }
  }, [version, selectedPort, selectedDisruptionId])

  if (!data && !loadError) return <Loading label="HUMAN GOVERNANCE" />
  if (!data) {
    return (
      <>
        <SectionHeader
          eyebrow="HUMAN GOVERNANCE"
          title="Recovery Plan Approval"
          description="Only a plan generated for the selected disruption can be reviewed or approved."
        />
        <section className="panel" role="status">
          <p>{loadError}</p>
          <button className="button secondary" onClick={() => navigate("Disruption Monitor")}>
            Open Disruption Monitor
          </button>
        </section>
      </>
    )
  }
  const rec = data.recommended
  const passedChecks = rec ? rec.checks.filter((c) => c.pass).length : 0
  const totalChecks = rec ? rec.checks.length : 0

  const decide = async (decision: "approved" | "rejected") => {
    if (busy || approval !== "pending") return
    setBusy(true)
    try {
      if (decision === "approved") {
        if (!rec) throw new Error("The selected recovery plan has no recommended option.")
        await approvePlan(data.plan.id, rec.id, comment)
        onDecision("APPROVED")
      } else {
        if (!rec) throw new Error("The selected recovery plan has no recommended option.")
        await rejectPlan(data.plan.id, rec.id, comment)
        onDecision("REJECTED")
      }
    } catch (e) {
      onBlocked(`Decision blocked by server-side compliance revalidation: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const donorFrom = rec?.title.match(/from\s+(.+)$/i)?.[1] || "Donor Warehouse"
  const medicineName = inventory?.critical.medicine || "units"
  const facts: [string, string, IconName][] = [
    ["Disruption", data.disruption.title, "alert"],
    [
      "Medicine urgency",
      impact ? `Critical · stockout in ${Math.round(impact.cover_hours)}h` : "Unavailable",
      "medicine",
    ],
    ["Transfer quantity", rec ? `${rec.qty} ${impact?.unit || "units"}` : "—", "box"],
    ["Donor warehouse", donorFrom, "inventory"],
    ["Estimated delivery", rec ? `${rec.eta_hours} hours` : "—", "clock"],
    ["Estimated cost", rec ? `$${Number(rec.cost_usd).toLocaleString("en-US")}` : "—", "document"],
  ]

  return (
    <>
      <SectionHeader
        eyebrow="HUMAN GOVERNANCE"
        title="Recovery Plan Approval"
        description="SupplyShield recommends. An authorized planner reviews evidence and makes the final decision."
        actions={
          approval !== "pending" && (
            <StatusPill tone={approval === "approved" ? "success" : "critical"}>
              PLAN {approval.toUpperCase()}
            </StatusPill>
          )
        }
      />
      <section className="human-control-banner">
        <div className="human-icon">
          <Icon name="user" size={22} />
        </div>
        <div>
          <span>HUMAN-IN-THE-LOOP CONTROL</span>
          <p>
            AI has completed analysis and compliance validation. No downstream action occurs until
            you authorize this recovery plan.
          </p>
        </div>
        <div className="decision-progress">
          <span className="done">AI analysis</span>
          <i />
          <span className={approval === "pending" ? "active" : "done"}>Human decision</span>
          <i />
          <span className={approval !== "pending" ? "active" : ""}>Execution</span>
        </div>
      </section>
      <section className="approval-layout">
        <article className="approval-main">
          <div className="approval-title">
            <div>
              <span className="panel-kicker">RECOMMENDED RECOVERY PLAN · {data.plan.id}</span>
              <h2>Bengaluru stock transfer</h2>
              <p>Emergency inventory transfer to protect insulin continuity at St. Martha Hospital.</p>
            </div>
            <div className="score-chip">
              <Icon name="spark" size={18} />
              <span>
                <small>AI SCORE</small>
                <b>{data.plan.score}/100</b>
              </span>
            </div>
          </div>
          <div className="approval-facts">
            {facts.map(([label, value, icon]) => (
              <div key={label}>
                <span>
                  <Icon name={icon} size={17} />
                </span>
                <div>
                  <small>{label}</small>
                  <b>{value}</b>
                </div>
              </div>
            ))}
          </div>
          <div className="explanation-block">
            <div className="explanation-head">
              <span>
                <Icon name="spark" size={17} />
              </span>
              <div>
                <b>SupplyShield Recommendation</b>
              </div>
            </div>
            <div className="recommendation-summary">
              <section>
                <h3><Icon name="alert" size={13} /> 1. Disruption</h3>
                <p>{data.disruption.title}{data.disruption.severity ? ` · ${data.disruption.severity} severity` : ""}</p>
              </section>
              <section>
                <h3><Icon name="medicine" size={13} /> 2. Medicine Risk</h3>
                {inventory && (
                  <p>
                    <strong>{inventory.critical.medicine}</strong>
                    {urgency && <> · <strong>{urgency}</strong></>}
                    {stockoutHours != null && <> · stockout expected in <strong>{formatHours(stockoutHours)} hours</strong></>}
                  </p>
                )}
              </section>
              <section>
                <h3><Icon name="truck" size={13} /> 3. Recommended Action</h3>
                {rec && (
                  <p>
                    Transfer <strong>{rec.qty}{inventory?.critical.unit ? ` ${inventory.critical.unit}` : ""}</strong>
                    {medicineName !== "units" && <> of <strong>{medicineName}</strong></>}
                    {donorFrom && <> from <strong>{donorFrom}</strong></>}
                    {rec.eta_hours != null && <> · delivery in <strong>{formatHours(rec.eta_hours)} hours</strong></>}
                  </p>
                )}
              </section>
              <section>
                <h3><Icon name="spark" size={13} /> 4. Why This Recommendation?</h3>
                {recommendationReasons.length > 0 && (
                  <ul>
                    {recommendationReasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                )}
              </section>
              <section>
                <h3><Icon name="check" size={13} /> 5. Expected Outcome</h3>
                <p>{expectedOutcome}</p>
              </section>
            </div>
          </div>
          <label className="comments-field">
            Planner comments <span>Optional</span>
            <textarea
              placeholder="Add decision context for the immutable audit trail..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={approval !== "pending"}
            />
          </label>
          <div className="approval-actions">
            <button
              className="button reject"
              disabled={approval !== "pending" || busy || !rec}
              onClick={() => decide("rejected")}
            >
              <Icon name="close" size={17} />
              Reject plan
            </button>
            <button
              className="button approve"
              disabled={approval !== "pending" || busy || !rec}
              onClick={() => decide("approved")}
            >
              <Icon name="check" size={17} />
              Approve recovery plan
            </button>
          </div>
          {approval !== "pending" && (
            <div className={`decision-confirmation ${approval}`}>
              <Icon name={approval === "approved" ? "check" : "close"} size={20} />
              <div>
                <b>Recovery plan {approval}</b>
                <span>
                  {approval === "approved"
                    ? "Decision recorded. Simulated execution is ready to begin."
                    : "Decision recorded. Scenario returned to the AI Recovery Command."}
                </span>
              </div>
              <button onClick={() => navigate("Execution & Audit Trail")}>
                View audit trail <Icon name="arrow" size={14} />
              </button>
            </div>
          )}
        </article>
        <aside className="approval-evidence">
          <div className="evidence-header">
            <span className="panel-kicker">VALIDATION EVIDENCE</span>
            <h2>Decision assurance</h2>
          </div>
          <div className="assurance-score">
            <div className="assurance-ring">
              <span>
                {passedChecks}/{totalChecks}
              </span>
            </div>
            <div>
              <b>Mandatory controls passed</b>
              <small>
                Compliance Agent · Run {data.plan.run_id}
              </small>
            </div>
          </div>
          <div className="evidence-list">
            {rec &&
              rec.checks.map((c) => (
                <div key={c.label}>
                  <span>
                    <Icon name={c.pass ? "check" : "close"} size={13} />
                  </span>
                  <div>
                    <small>{c.label}</small>
                    <b>{c.note}</b>
                  </div>
                </div>
              ))}
          </div>
          <div className="assumptions">
            <b>Key assumptions</b>
            <ul>
              <li>Departure within 90 minutes</li>
              <li>NH48 remains operational</li>
              <li>Demand remains at 100 vials/day</li>
            </ul>
          </div>
          <button className="text-button full-width" onClick={() => navigate("Cold-Chain Compliance")}>
            Inspect calculation details <Icon name="arrow" size={14} />
          </button>
        </aside>
      </section>
    </>
  )
}

function AuditTrail({
  version,
  selectedPort,
  selectedDisruptionId,
}: {
  version: number
  selectedPort?: string
  selectedDisruptionId: string
}) {
  const [data, setData] = useState<AuditData | null>(null)
  useEffect(() => {
    let active = true
    setData(null)
    getAudit(selectedPort, selectedDisruptionId)
      .then((result) => { if (active) setData(result) })
      .catch(() => { if (active) setData(null) })
    return () => { active = false }
  }, [version, selectedPort, selectedDisruptionId])

  if (!data) return <Loading label="TRACEABILITY" />
  const plan = data.plan
  const exportData = {
    disruptionId: data.disruptionId,
    plan,
    agentHistory: data.agentHistory,
    humanReview: data.humanReview,
  }

  return (
    <>
      <SectionHeader
        eyebrow="TRACEABILITY"
        title="Execution & Audit Trail"
        description={`Five-agent execution and human review history for disruption ${selectedDisruptionId || "not selected"}.`}
        actions={
          <button className="button secondary" onClick={() => downloadJson("supplyshield-audit-trail.json", exportData)}>
            <Icon name="download" size={16} />
            Export history
          </button>
        }
      />
      <section className="audit-layout">
        <article className="panel audit-timeline-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">AGENT EXECUTION HISTORY</span>
              <h2>Five-agent pipeline</h2>
            </div>
            <StatusPill tone="live">{plan ? `PLAN ${plan.id}` : "NO PLAN"}</StatusPill>
          </div>
          <div className="audit-timeline">
            {data.agentHistory.length ? data.agentHistory.map((event) => (
              <div className="audit-event complete" key={event.id}>
                <time>{formatIst(event.timestamp)}</time>
                <span className="audit-icon"><Icon name="check" size={16} /></span>
                <div>
                  <div><b>{event.name}</b><span>{event.status}</span></div>
                  <p>{event.action} {event.result}</p>
                </div>
              </div>
            )) : (
              <p className="audit-history-empty">No execution history available for this disruption yet.</p>
            )}
          </div>
        </article>
        <article className="panel audit-timeline-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">HUMAN REVIEW HISTORY</span>
              <h2>Planner decisions</h2>
            </div>
            <StatusPill tone={data.humanReview.some((review) => review.decision === "PENDING") ? "warning" : "live"}>
              {data.humanReview.some((review) => review.decision === "PENDING") ? "AWAITING REVIEW" : "REVIEW RECORDS"}
            </StatusPill>
          </div>
          <div className="audit-timeline">
            {data.humanReview.length ? data.humanReview.map((review) => (
              <div
                className={`audit-event ${review.decision === "APPROVED" ? "approved" : review.decision === "PENDING" ? "active" : "critical"}`}
                key={review.id}
              >
                <time>{review.timestamp ? formatIst(review.timestamp) : "Pending"}</time>
                <span className="audit-icon">
                  <Icon name={review.decision === "APPROVED" ? "check" : review.decision === "PENDING" ? "clock" : "close"} size={16} />
                </span>
                <div>
                  <div>
                    <b>{review.decision === "PENDING" ? "Awaiting human review" : `Plan ${review.decision.toLocaleLowerCase()}`}</b>
                    <span>{review.reviewer || "No reviewer yet"}</span>
                  </div>
                  <p>Recovery plan {review.planId} · {review.comment || "No planner comment recorded."}</p>
                </div>
              </div>
            )) : (
              <p className="audit-history-empty">No human review history is available for this disruption yet.</p>
            )}
          </div>
        </article>
      </section>
    </>
  )
}

function formatIst(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" })
  const time = d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
  return `${date} · ${time} IST`
}

export default App
