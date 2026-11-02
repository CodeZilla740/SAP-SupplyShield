import { useState, type FormEvent } from "react"
import { login, signup, type AuthUser } from "./auth"
import "./AuthPage.css"

type AuthPageProps = {
  mode: "login" | "signup"
  onSwitch: (mode: "login" | "signup") => void
  onSuccess: (user: AuthUser) => void
  onHome: () => void
}

function EyeIcon({ visible }: { visible: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {visible ? (
        <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a15.7 15.7 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.5 7 10 7a10.5 10.5 0 0 0 4-.8" /></>
      ) : (
        <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="2.7" /></>
      )}
    </svg>
  )
}

export default function AuthPage({ mode, onSwitch, onSuccess, onHome }: AuthPageProps) {
  const isSignup = mode === "signup"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrorMessage("")

    setBusy(true)
    try {
      const user = isSignup
        ? await signup({ fullName, email, password })
        : await login(email, password)
      onSuccess(user)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to authenticate. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-glow auth-glow-top" />
      <div className="auth-glow auth-glow-bottom" />
      <header className="auth-header">
        <button className="auth-brand" type="button" onClick={onHome} aria-label="Return to SupplyShield home">
          <span className="auth-brand-mark"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v5c0 5 3.3 8.3 8 10 4.7-1.7 8-5 8-10V6l-8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg></span>
          <span><b>SupplyShield</b><small>MEDICAL NETWORK RESILIENCE</small></span>
        </button>
        <button type="button" className="auth-back-link" onClick={onHome}>Back to home <span>↗</span></button>
      </header>

      <section className={`auth-layout${isSignup ? " auth-layout-signup" : ""}`}>
        <aside className="auth-story">
          <span className="auth-story-kicker"><i /> TRUSTED NETWORK ACCESS</span>
          <h1>{isSignup ? <>Join a network built for <em>continuity.</em></> : <>Clarity for your network.<br /><em>Confidence for care.</em></>}</h1>
          <p>Access an intelligent control tower for medical supply resilience, built to help healthcare teams respond with context.</p>
          <div className="auth-story-visual" aria-hidden="true">
            <div className="auth-story-orbit auth-story-orbit-one" />
            <div className="auth-story-orbit auth-story-orbit-two" />
            <div className="auth-story-core"><svg viewBox="0 0 24 24" width="29" height="29" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v5c0 5 3.3 8.3 8 10 4.7-1.7 8-5 8-10V6l-8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg></div>
            <span className="auth-story-node auth-story-node-one">SHIPMENTS<i /></span>
            <span className="auth-story-node auth-story-node-two">INVENTORY<i /></span>
            <span className="auth-story-node auth-story-node-three">RECOVERY<i /></span>
            <span className="auth-story-node auth-story-node-four">COLD-CHAIN<i /></span>
          </div>
          <div className="auth-story-foot"><span>SECURE BY DESIGN</span><i /><span>HUMAN-LED DECISIONS</span><i /><span>TRACEABLE ACTIONS</span></div>
        </aside>

        <section className="auth-form-panel" aria-labelledby="auth-title">
          <div className="auth-form-topline"><span className="auth-live-dot" /> SUPPLYSHIELD WORKSPACE</div>
          <h2 id="auth-title">{isSignup ? "Create your account" : "Welcome back"}</h2>
          <p className="auth-form-description">
            {isSignup ? "Join the SupplyShield workspace." : "Sign in to your SupplyShield workspace."}
          </p>

          <form className="auth-form" onSubmit={submit}>
            {isSignup && (
              <>
                <label className="auth-field">
                  <span>Full name</span>
                  <input autoComplete="name" maxLength={100} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" required value={fullName} />
                </label>
                <label className="auth-field">
                  <span>Email address</span>
                  <input autoComplete="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} />
                </label>
              </>
            )}

            {!isSignup && (
              <label className="auth-field">
                <span>Email address</span>
                <input autoComplete="username" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} />
              </label>
            )}

            <label className="auth-field">
              <span>Password</span>
              <span className="auth-password-wrap">
                <input
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  minLength={isSignup ? 12 : undefined}
                  maxLength={isSignup ? 72 : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={isSignup ? "At least 12 characters" : "Enter your password"}
                  required
                  type={passwordVisible ? "text" : "password"}
                  value={password}
                />
                <button className="auth-password-toggle" type="button" aria-label={passwordVisible ? "Hide password" : "Show password"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>
                  <EyeIcon visible={passwordVisible} />
                </button>
              </span>
            </label>

            {errorMessage && <p className="auth-error-message" role="alert">{errorMessage}</p>}
            <button className="auth-submit" disabled={busy} type="submit">
              {busy ? (isSignup ? "Creating account..." : "Signing in...") : isSignup ? "Create account" : "Log in"}
              {!busy && <span>→</span>}
            </button>
          </form>

          <div className="auth-switch">
            {isSignup ? "Already have an account?" : "Don't have an account?"}
            <button type="button" onClick={() => onSwitch(isSignup ? "login" : "signup")}>{isSignup ? "Login" : "Sign Up"}</button>
          </div>
          <div className="auth-security-note"><span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v5c0 5 3.3 8.3 8 10 4.7-1.7 8-5 8-10V6l-8-3Z" /></svg></span> Passwords are securely hashed and sessions are protected</div>
        </section>
      </section>
      <footer className="auth-footer"><span>© SupplyShield · Medical supply resilience</span><span>Secure demo workspace</span></footer>
    </main>
  )
}
