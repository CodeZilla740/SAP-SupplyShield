import { useState, type CSSProperties, type ReactNode } from "react"
import "./LandingPage.css"

type LandingPageProps = {
  onLogin: () => void
  onSignUp: () => void
}

type IconName = "pulse" | "route" | "box" | "snow" | "eye" | "brain" | "spark" | "arrow" | "shield" | "menu" | "close"

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    pulse: <><path d="M3 12h4l2.2-6 4.2 12 2.2-6H21" /><circle cx="12" cy="12" r="9" /></>,
    route: <><circle cx="5" cy="18" r="2" /><circle cx="19" cy="6" r="2" /><path d="M7 18h3a3 3 0 0 0 3-3V9a3 3 0 0 1 3-3h1" /></>,
    box: <><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z" /><path d="m3 7 9 4 9-4M12 11v10" /></>,
    snow: <><path d="M12 2v20M4 6.5l16 11M4 17.5l16-11" /><path d="m9 4 3 3 3-3M9 20l3-3 3 3" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    brain: <><path d="M9 4a3 3 0 0 0-5 2 3 3 0 0 0 1 5 3.5 3.5 0 0 0 4 6" /><path d="M15 4a3 3 0 0 1 5 2 3 3 0 0 1-1 5 3.5 3.5 0 0 1-4 6M12 3v18M8 9h4M12 14h4" /></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    shield: <><path d="M12 3 4 6v5c0 5 3.3 8.3 8 10 4.7-1.7 8-5 8-10V6l-8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

const features: { icon: IconName; title: string; description: string; tag: string }[] = [
  {
    icon: "pulse",
    title: "AI Disruption Detection",
    description: "See emerging supply interruptions sooner with a connected view of operational signals and network risk.",
    tag: "EARLY AWARENESS",
  },
  {
    icon: "route",
    title: "Shipment Intelligence",
    description: "Follow critical medical shipments and understand route changes, delivery context, and condition signals.",
    tag: "LIVE VISIBILITY",
  },
  {
    icon: "box",
    title: "Inventory & Stock Risk",
    description: "Understand where availability is tightening and bring facility-level stock risk into focus.",
    tag: "NETWORK READINESS",
  },
  {
    icon: "snow",
    title: "Cold-Chain Compliance",
    description: "Keep temperature-sensitive medicines and vaccines in view with clear, traceable compliance evidence.",
    tag: "PRODUCT INTEGRITY",
  },
]

const workflow: { number: string; title: string; detail: string; icon: IconName }[] = [
  { number: "01", title: "Sense", detail: "Monitor supply-chain data and detect disruptions.", icon: "eye" },
  { number: "02", title: "Analyse", detail: "Assess exposure across shipments, facilities, and stock.", icon: "pulse" },
  { number: "03", title: "Simulate", detail: "Evaluate recovery scenarios against real constraints.", icon: "brain" },
  { number: "04", title: "Optimise", detail: "Surface practical logistics and inventory actions.", icon: "spark" },
  { number: "05", title: "Recover", detail: "Support teams as they coordinate a human-led response.", icon: "shield" },
]

export default function LandingPage({ onLogin, onSignUp }: LandingPageProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="landing-page">
      <header className="landing-nav">
        <a className="landing-brand" href="#home" onClick={closeMenu} aria-label="SupplyShield home">
          <span className="landing-brand-mark"><Icon name="shield" size={21} /></span>
          <span><b>SupplyShield</b><small>MEDICAL NETWORK RESILIENCE</small></span>
        </a>
        <button
          className="landing-menu-toggle"
          type="button"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name={menuOpen ? "close" : "menu"} />
        </button>
        <nav className={`landing-nav-links${menuOpen ? " is-open" : ""}`} aria-label="Main navigation">
          <a href="#home" onClick={closeMenu}>Home</a>
          <a href="#features" onClick={closeMenu}>Features</a>
          <a href="#impact" onClick={closeMenu}>Impact</a>
          <a href="#about" onClick={closeMenu}>About</a>
          <button className="landing-login-link" type="button" onClick={() => { closeMenu(); onLogin() }}>Login</button>
          <button className="landing-signup-button" type="button" onClick={() => { closeMenu(); onSignUp() }}>
            Sign up <Icon name="arrow" size={16} />
          </button>
        </nav>
      </header>

      <main>
        <section className="landing-hero" id="home">
          <div className="landing-hero-copy">
            <div className="landing-eyebrow"><span /> AI-POWERED MEDICAL SUPPLY RESILIENCE</div>
            <h1>Building a resilient medical supply network<span>.</span></h1>
            <p className="landing-hero-description">
              An intelligent, connected medical supply network that predicts disruptions, protects critical medicines, and ensures uninterrupted healthcare delivery.
            </p>
            <div className="landing-hero-actions">
              <button className="landing-primary-button" type="button" onClick={onSignUp}>
                Get started <Icon name="arrow" size={17} />
              </button>
              <a className="landing-secondary-button" href="#features">
                Explore platform <span className="landing-play">↓</span>
              </a>
            </div>
            <div className="landing-trust-note">
              <span className="landing-trust-icon"><Icon name="shield" size={16} /></span>
              <span>Built for healthcare teams. Designed for continuity.</span>
            </div>
          </div>

          <div className="landing-visual" role="img" aria-label="Illustration of connected medical supply locations across India">
            <div className="landing-visual-halo" />
            <div className="landing-orbit landing-orbit-one" />
            <div className="landing-orbit landing-orbit-two" />
            <div className="landing-globe">
              <div className="landing-globe-grid landing-grid-vertical" />
              <div className="landing-globe-grid landing-grid-horizontal" />
              <svg className="landing-globe-map" viewBox="0 0 360 360" role="img" aria-label="Network connections across India">
                <defs>
                  <linearGradient id="landing-land" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#66f3d0" stopOpacity=".78" />
                    <stop offset="1" stopColor="#10a9bc" stopOpacity=".42" />
                  </linearGradient>
                  <radialGradient id="landing-globe-fill" cx="32%" cy="28%" r="80%">
                    <stop offset="0" stopColor="#164e68" />
                    <stop offset=".58" stopColor="#0d344c" />
                    <stop offset="1" stopColor="#071a2c" />
                  </radialGradient>
                  <clipPath id="landing-globe-clip">
                    <circle cx="180" cy="180" r="150" />
                  </clipPath>
                </defs>
                <circle cx="180" cy="180" r="150" fill="url(#landing-globe-fill)" />
                <g clipPath="url(#landing-globe-clip)" fill="none" stroke="#57cbd2" strokeOpacity=".2">
                  <ellipse cx="180" cy="180" rx="57" ry="150" />
                  <ellipse cx="180" cy="180" rx="112" ry="150" />
                  <ellipse cx="180" cy="180" rx="150" ry="51" />
                  <ellipse cx="180" cy="180" rx="150" ry="101" />
                  <path d="M20 180h320M43 110h274M43 250h274" />
                </g>
                <g clipPath="url(#landing-globe-clip)">
                  <path className="landing-continent" d="m111 78 19-16 21 3 12 13 24 3 8 10-10 15 13 8 2 12-15 6-12 17-11 13-7 19-14 3-6 16-10 9-2 17-11 7-6-13-8-9 3-15-9-10-4-15-13-9 1-20 12-11 2-17 11-13-5-13 12-14Z" />
                  <path className="landing-continent landing-continent-muted" d="m65 113 16-12 18 2 11 10-8 12-20 7-16-5ZM200 83l17-10 22 5 14 14-9 12-16-4-14 8-14-10ZM229 142l17-7 12 11-1 20-12 8-15-12Z" />
                  <g className="landing-routes">
                    <path d="M116 174Q153 94 197 133T245 187" />
                    <path d="M116 174Q158 218 197 133" />
                    <path d="M116 174Q172 269 245 187" />
                    <path d="M153 233Q170 174 197 133" />
                  </g>
                  <g className="landing-map-points">
                    <circle cx="116" cy="174" r="4" /><circle cx="153" cy="233" r="4" />
                    <circle cx="197" cy="133" r="5" /><circle cx="245" cy="187" r="4" />
                    <circle className="landing-alert-point" cx="153" cy="233" r="7" />
                  </g>
                </g>
                <circle cx="180" cy="180" r="150" fill="none" stroke="#63dccc" strokeOpacity=".38" />
                <ellipse cx="180" cy="180" rx="163" ry="43" transform="rotate(-24 180 180)" fill="none" stroke="#40d9c2" strokeOpacity=".5" strokeDasharray="3 8" />
              </svg>
              <span className="landing-globe-label"><i /> INDIA NETWORK</span>
            </div>
            <div className="landing-visual-caption"><span className="landing-caption-pulse" /> CONNECTED CARE, IN MOTION</div>
            <div className="landing-location landing-location-west"><i /><span>MUMBAI<br /><b>Distribution hub</b></span></div>
            <div className="landing-location landing-location-south"><i /><span>BENGALURU<br /><b>Regional warehouse</b></span></div>
            <div className="landing-location landing-location-east"><i /><span>CHENNAI<br /><b>Hospital network</b></span></div>
            <div className="landing-float-card landing-card-shipment">
              <span className="landing-card-icon"><Icon name="route" size={17} /></span>
              <span><b>Shipment tracking</b><small>Route visibility connected</small></span>
              <i className="landing-card-live" />
            </div>
            <div className="landing-float-card landing-card-recovery">
              <span className="landing-card-icon"><Icon name="brain" size={17} /></span>
              <span><b>AI recovery</b><small>Scenario ready to review</small></span>
              <span className="landing-card-spark"><Icon name="spark" size={15} /></span>
            </div>
            <div className="landing-float-card landing-card-inventory">
              <span className="landing-card-icon"><Icon name="box" size={17} /></span>
              <span><b>Inventory risk</b><small>Stock visibility connected</small></span>
            </div>
            <div className="landing-float-card landing-card-cold">
              <span className="landing-card-icon"><Icon name="snow" size={17} /></span>
              <span><b>Cold-chain</b><small>Condition monitoring active</small></span>
            </div>
            <div className="landing-shipment-chip"><span>✦</span> VACCINE SHIPMENT <i /></div>
            <div className="landing-medical-pod" aria-hidden="true"><span /><i /><b>TEMP CONTROLLED</b></div>
            <div className="landing-signal-chip"><i /> DISRUPTION SIGNAL <b>UNDER REVIEW</b></div>
          </div>
        </section>

        <section className="landing-proof-strip" aria-label="SupplyShield capabilities">
          <span>ONE CONNECTED VIEW</span>
          <i />
          <span>MEDICINE-FIRST INTELLIGENCE</span>
          <i />
          <span>HUMAN-LED RECOVERY</span>
          <i />
          <span>TRACEABLE DECISIONS</span>
        </section>

        <section className="landing-section landing-features" id="features">
          <div className="landing-section-heading">
            <span className="landing-section-kicker">THE PLATFORM</span>
            <h2>Resilience, from signal to <em>response.</em></h2>
            <p>Bring operational context together so teams can see risk, understand impact, and act with confidence.</p>
          </div>
          <div className="landing-feature-grid">
            {features.map((feature, index) => (
              <article className="landing-feature-card" key={feature.title} style={{ "--card-index": index } as CSSProperties}>
                <div className="landing-feature-top"><span className="landing-feature-icon"><Icon name={feature.icon} size={22} /></span><span className="landing-feature-tag">{feature.tag}</span></div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <span className="landing-feature-link">Explore capability <Icon name="arrow" size={15} /></span>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-workflow-section">
          <div className="landing-section-heading landing-workflow-heading">
            <span className="landing-section-kicker">HOW SUPPLYSHIELD WORKS</span>
            <h2>From the first signal to <em>continuity.</em></h2>
            <p>A clear, connected workflow helps planners move from early awareness to a considered recovery.</p>
          </div>
          <div className="landing-workflow">
            <div className="landing-workflow-line" />
            {workflow.map((step) => (
              <article className="landing-workflow-step" key={step.number}>
                <span className="landing-workflow-icon"><Icon name={step.icon} size={20} /></span>
                <span className="landing-workflow-number">{step.number}</span>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-impact-section" id="impact">
          <div className="landing-impact-orb" />
          <div className="landing-impact-copy">
            <span className="landing-section-kicker">THE IMPACT</span>
            <h2>Make critical care supply chains more <em>prepared.</em></h2>
            <p>SupplyShield helps healthcare teams build a shared operational picture and a more considered path through disruption.</p>
            <div className="landing-impact-list">
              <span><i /> Improved supply-chain visibility</span>
              <span><i /> Faster, evidence-led disruption response</span>
              <span><i /> Earlier awareness of medicine shortages</span>
              <span><i /> Better cold-chain monitoring</span>
              <span><i /> Intelligent, human-reviewed recovery planning</span>
            </div>
          </div>
          <div className="landing-impact-visual" aria-hidden="true">
            <div className="landing-impact-ring landing-impact-ring-one" />
            <div className="landing-impact-ring landing-impact-ring-two" />
            <div className="landing-impact-core"><Icon name="shield" size={34} /><span>CARE<br />CONTINUITY</span></div>
            <span className="landing-impact-node node-one"><Icon name="box" size={18} /></span>
            <span className="landing-impact-node node-two"><Icon name="snow" size={18} /></span>
            <span className="landing-impact-node node-three"><Icon name="route" size={18} /></span>
            <span className="landing-impact-node node-four"><Icon name="pulse" size={18} /></span>
            <div className="landing-impact-note"><i /> PEOPLE AT THE CENTRE OF EVERY DECISION</div>
          </div>
        </section>

        <section className="landing-about-section" id="about">
          <div className="landing-about-mark"><Icon name="shield" size={27} /></div>
          <div>
            <span className="landing-section-kicker">ABOUT SUPPLYSHIELD</span>
            <h2>Healthcare continuity is a <em>network effort.</em></h2>
            <p>SupplyShield connects supply signals, clinical priorities, and planner decisions in one transparent control tower—so teams can focus on getting critical medicines where they are needed.</p>
          </div>
          <button className="landing-primary-button" type="button" onClick={onSignUp}>Access the platform <Icon name="arrow" size={17} /></button>
        </section>

        <section className="landing-cta">
          <div className="landing-cta-stars" aria-hidden="true" />
          <span className="landing-section-kicker">READY TO CONNECT YOUR NETWORK?</span>
          <h2>Resilience starts with <em>visibility.</em></h2>
          <p>Sign in or create an account to explore the SupplyShield workspace.</p>
          <div className="landing-cta-actions">
            <button type="button" className="landing-primary-button" onClick={onLogin}>Log in <Icon name="arrow" size={17} /></button>
            <button type="button" className="landing-cta-text" onClick={onSignUp}>Create an account</button>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <a className="landing-brand" href="#home">
          <span className="landing-brand-mark"><Icon name="shield" size={20} /></span>
          <span><b>SupplyShield</b><small>MEDICAL NETWORK RESILIENCE</small></span>
        </a>
        <span>Designed for a more resilient medical supply network.</span>
        <button type="button" onClick={onLogin}>Authorized access <Icon name="arrow" size={14} /></button>
      </footer>
    </div>
  )
}
