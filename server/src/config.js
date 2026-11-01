// Central configuration. Everything is read from environment variables.
// No credentials are hardcoded anywhere in this project.
try { require('dotenv').config(); } catch (e) { /* dotenv is optional at runtime */ }

const config = {
  port: Number(process.env.PORT || 4004),

  // ---- Persistence ----
  // When HANA_HOST (or a bound VCAP_SERVICES hana entry) is present, the
  // server connects to SAP HANA Cloud. Otherwise the development fallback
  // is ephemeral SQLite; production persistence is provided by CAP/HDI.
  hana: {
    host: process.env.HANA_HOST || '',
    port: Number(process.env.HANA_PORT || 443),
    user: process.env.HANA_USER || '',
    password: process.env.HANA_PASSWORD || '',
    schema: process.env.HANA_SCHEMA || 'SUPPLYSHIELD',
    encrypt: process.env.HANA_ENCRYPT !== 'false',
  },
  sqliteFile: process.env.SQLITE_FILE || ':memory:',

  // ---- SAP Generative AI Hub (orchestration service in SAP AI Core) ----
  // Optional. Without a service key the explainer falls back to a
  // deterministic rule-based briefing template (clearly labelled).
  aicore: {
    serviceKeyJson: process.env.AICORE_SERVICE_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-4o',
    resourceGroup: process.env.AICORE_RESOURCE_GROUP || 'default',
  },

  // ---- External integrations ----
  weather: {
    // Open-Meteo needs no API key. Set WEATHER_PROVIDER=off to disable.
    provider: process.env.WEATHER_PROVIDER || 'open-meteo',
    baseUrl: process.env.WEATHER_BASE_URL || 'https://api.open-meteo.com/v1/forecast',
    timeoutMs: Number(process.env.WEATHER_TIMEOUT_MS || 6000),
  },
  s4hana: {
    // Live S/4HANA OData is only used when a base URL and API key are
    // configured. Until then the mock adapter (HANA tables) is active.
    baseUrl: process.env.S4HANA_BASE_URL || '',
    apiKey: process.env.S4HANA_API_KEY || '',
  },

  // Demo planner identity used when no SSO is wired up. In a BTP
  // deployment this would come from the XSUAA token instead.
  defaultPlanner: process.env.DEFAULT_PLANNER || 'Arjun Kumar',

  nodeEnv: process.env.NODE_ENV || 'development',
};

module.exports = config;
