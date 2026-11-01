// ============================================================================
// WEATHER / DISRUPTION ALERT ADAPTER
// Live, key-free weather data from Open-Meteo (https://open-meteo.com).
//
// IMPORTANT honesty boundary: a weather alert is NOT proof that a port is
// closed. This adapter only produces UNVERIFIED weather alerts. A port
// closure is only marked verified when it comes from an operational source
// (seeded demo bulletin, or a future port-authority integration).
// ============================================================================
const config = require('../config');

const PORTS = [
  { port: 'INMAA', name: 'Chennai Port', lat: 13.0827, lon: 80.2707 },
  { port: 'INBOM', name: 'Mumbai Port', lat: 18.9388, lon: 72.8354 },
  { port: 'INHYD', name: 'Hyderabad Air Cargo', lat: 17.2403, lon: 78.4294 },
];

// Wind thresholds (km/h) for alert classification - indicative only.
function classify(windKmh) {
  if (windKmh >= 90) return { severity: 'HIGH', note: 'severe cyclonic conditions possible' };
  if (windKmh >= 62) return { severity: 'MEDIUM', note: 'storm-force winds' };
  if (windKmh >= 40) return { severity: 'LOW', note: 'strong winds' };
  return null;
}

async function fetchPortWeather(p) {
  const url = `${config.weather.baseUrl}?latitude=${p.lat}&longitude=${p.lon}`
    + '&current=wind_speed_10m,wind_gusts_10m,weather_code&wind_speed_unit=kmh';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.weather.timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const wind = body.current && body.current.wind_speed_10m;
    const gusts = body.current && body.current.wind_gusts_10m;
    const alert = classify(Math.max(wind || 0, gusts || 0));
    return {
      port: p.port, name: p.name, wind_kmh: wind, gusts_kmh: gusts,
      observed_at: body.current && body.current.time,
      alert: alert
        ? {
          severity: alert.severity,
          message: `Weather alert (${alert.note}) near ${p.name}: wind ${wind} km/h, gusts ${gusts} km/h. `
            + 'UNVERIFIED for operations - this is a weather observation, not a confirmed port disruption.',
          verified: false,
        }
        : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function refresh() {
  if (config.weather.provider === 'off') {
    return { live: false, provider: 'disabled', alerts: [], note: 'Weather provider disabled by configuration.' };
  }
  try {
    const results = await Promise.all(PORTS.map(fetchPortWeather));
    return {
      live: true,
      provider: 'Open-Meteo (live, no key required)',
      fetched_at: new Date().toISOString(),
      ports: results,
      alerts: results.filter((r) => r.alert).map((r) => ({ port: r.port, name: r.name, ...r.alert })),
    };
  } catch (e) {
    return {
      live: false,
      provider: 'Open-Meteo',
      alerts: [],
      note: `Weather feed unreachable (${e.message}). Demo disruption data remains available.`,
    };
  }
}

module.exports = { refresh };
