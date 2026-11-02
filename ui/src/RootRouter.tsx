import { useEffect, useState } from "react"
import App from "./App"
import AuthPage from "./AuthPage"
import { getSession, logout, type AuthUser } from "./auth"
import LandingPage from "./LandingPage"
import "./RootRouter.css"

type AuthStatus = "checking" | "signed-in" | "signed-out" | "error"

function DashboardAccountMenu({
  user,
  busy,
  error,
  onLogout,
}: {
  user: AuthUser
  busy: boolean
  error: string
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="dashboard-auth-control">
      {open && (
        <div className="dashboard-auth-menu" role="dialog" aria-label="Account options">
          <strong>{user.fullName}</strong>
          <span>{user.role} access</span>
          <button type="button" onClick={onLogout} disabled={busy}>
            {busy ? "Signing out..." : "Log out"}
          </button>
          {error && <span className="dashboard-auth-error" role="alert">{error}</span>}
        </div>
      )}
      <button
        className="dashboard-auth-trigger"
        type="button"
        aria-label={open ? "Close account menu" : "Open account menu"}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${user.fullName} · ${user.role}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 21a7 7 0 0 1 14 0" />
        </svg>
      </button>
    </div>
  )
}

export default function RootRouter() {
  const [route, setRoute] = useState(() => `${window.location.pathname}${window.location.search}`)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking")
  const [authError, setAuthError] = useState("")
  const [logoutBusy, setLogoutBusy] = useState(false)
  const [logoutError, setLogoutError] = useState("")

  const navigate = (path: string, replace = false) => {
    if (replace) window.history.replaceState({}, "", path)
    else window.history.pushState({}, "", path)
    setRoute(`${window.location.pathname}${window.location.search}`)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  useEffect(() => {
    const handlePopState = () => setRoute(`${window.location.pathname}${window.location.search}`)
    const handleUnauthorized = () => {
      setUser(null)
      setAuthStatus("signed-out")
      navigate("/login?next=%2Fapp")
    }
    window.addEventListener("popstate", handlePopState)
    window.addEventListener("supplyshield:unauthorized", handleUnauthorized)
    return () => {
      window.removeEventListener("popstate", handlePopState)
      window.removeEventListener("supplyshield:unauthorized", handleUnauthorized)
    }
  }, [])

  const pathname = route.split("?")[0].replace(/\/+$/, "") || "/"
  const needsSession = pathname === "/app" || pathname === "/login" || pathname === "/signup"
  const knownRoute = pathname === "/" || pathname === "/login" || pathname === "/signup" || pathname === "/app"

  useEffect(() => {
    if (!needsSession) {
      setAuthStatus("signed-out")
      return
    }

    let active = true
    setAuthStatus("checking")
    setAuthError("")
    getSession().then((sessionUser) => {
      if (!active) return
      setUser(sessionUser)
      setAuthStatus(sessionUser ? "signed-in" : "signed-out")
      if (pathname === "/app" && !sessionUser) {
        navigate("/login?next=%2Fapp", true)
      } else if ((pathname === "/login" || pathname === "/signup") && sessionUser) {
        navigate("/app", true)
      }
    }).catch((error: unknown) => {
      if (!active) return
      setAuthError(error instanceof Error ? error.message : "Unable to verify your session.")
      setAuthStatus("error")
    })
    return () => {
      active = false
    }
  }, [pathname, needsSession])

  useEffect(() => {
    if (!knownRoute) {
      window.history.replaceState({}, "", "/")
      setRoute("/")
    }
  }, [pathname, knownRoute])

  const completeLogin = (authenticatedUser: AuthUser) => {
    setUser(authenticatedUser)
    setAuthStatus("signed-in")
    navigate("/app", true)
  }

  const signOut = async () => {
    if (logoutBusy) return
    setLogoutBusy(true)
    setLogoutError("")
    try {
      await logout()
      window.location.replace("/")
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Unable to sign out.")
    } finally {
      setLogoutBusy(false)
    }
  }

  if (pathname === "/") {
    return <LandingPage onLogin={() => navigate("/login")} onSignUp={() => navigate("/signup")} />
  }

  if (pathname === "/login" || pathname === "/signup") {
    if (authStatus === "checking") return <div className="route-loading" role="status">Verifying secure session...</div>
    if (authStatus === "error") return <div className="route-error" role="alert">{authError}</div>
    return (
      <AuthPage
        key={route}
        mode={pathname === "/signup" ? "signup" : "login"}
        onSwitch={(mode) => navigate(mode === "signup" ? "/signup" : "/login")}
        onSuccess={completeLogin}
        onHome={() => navigate("/")}
      />
    )
  }

  if (pathname === "/app") {
    if (authStatus === "checking") return <div className="route-loading" role="status">Verifying secure session...</div>
    if (authStatus === "error") return <div className="route-error" role="alert">{authError}</div>
    if (authStatus !== "signed-in" || !user) return null
    return (
      <>
        <App />
        <DashboardAccountMenu user={user} busy={logoutBusy} error={logoutError} onLogout={signOut} />
      </>
    )
  }

  return null
}
