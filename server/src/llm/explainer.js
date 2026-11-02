// ============================================================================
// LLM EXPLANATION LAYER
// Uses SAP Generative AI Hub (orchestration service in SAP AI Core) to write
// the planner briefing - but ONLY from computed facts. The model never
// calculates, never approves, and never overrides the rules engine.
// If the AI Core service key is not configured or the call fails, a fully
// deterministic template briefing is produced instead and the source is
// labelled accordingly, so the demo (and the workflow) never breaks.
// ============================================================================
const config = require('../config');

const SYSTEM_PROMPT =
  'You are the explanation layer of a medical cold-chain control tower. '
  + 'Write a briefing of at most 120 words for a supply-chain planner. '
  + 'Use ONLY the facts provided. Never invent numbers, carriers, dates or places. '
  + 'Say which option is recommended, and name every rejected option with its reason. '
  + 'Finish with the sentence: Human approval is required before any action.';

function templateBriefing(facts) {
  return `${facts}\nHuman approval is required before any action.`;
}

function parseServiceKey() {
  if (!config.aicore.serviceKeyJson) return null;
  try {
    const key = JSON.parse(config.aicore.serviceKeyJson);
    const apiUrl = key.serviceurls && key.serviceurls.AI_API_URL;
    if (!key.clientid || !key.clientsecret || !key.url || !apiUrl) return null;
    return key;
  } catch (e) {
    return null;
  }
}

async function getToken(key) {
  const res = await fetch(`${key.url}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: key.clientid,
      client_secret: key.clientsecret,
    }),
  });
  if (!res.ok) throw new Error(`AI Core token request failed: HTTP ${res.status}`);
  const body = await res.json();
  return body.access_token;
}

async function explain(facts) {
  const key = parseServiceKey();
  if (!key) {
    return {
      text: templateBriefing(facts),
      source: 'Rule-based template (SAP Generative AI Hub not configured - set AICORE_SERVICE_KEY)',
    };
  }
  try {
    const token = await getToken(key);
    const apiUrl = key.serviceurls.AI_API_URL.replace(/\/$/, '');
    const res = await fetch(`${apiUrl}/v2/completion`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'AI-Resource-Group': config.aicore.resourceGroup,
      },
      body: JSON.stringify({
        orchestration_config: {
          module_configurations: {
            templating_module_config: {
              template: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: 'FACTS:\n{{?facts}}\n\nWrite the briefing.' },
              ],
              defaults: {},
            },
            llm_module_config: {
              model_name: config.aicore.model,
              model_params: { max_tokens: 300, temperature: 0.1 },
            },
          },
        },
        input_params: { facts },
      }),
    });
    if (!res.ok) throw new Error(`Orchestration call failed: HTTP ${res.status}`);
    const body = await res.json();
    const text = body
      && body.orchestration_result
      && body.orchestration_result.choices
      && body.orchestration_result.choices[0]
      && body.orchestration_result.choices[0].message
      && body.orchestration_result.choices[0].message.content;
    if (!text) throw new Error('Orchestration response contained no completion text');
    return { text, source: `SAP Generative AI Hub (${config.aicore.model})` };
  } catch (e) {
    return {
      text: templateBriefing(facts),
      source: `Rule-based template (LLM unavailable: ${String(e.message).slice(0, 80)})`,
    };
  }
}

function explainerStatus() {
  const key = parseServiceKey();
  return key
    ? { configured: true, label: `SAP Generative AI Hub (${config.aicore.model})` }
    : { configured: false, label: 'Rule-based template (SAP Generative AI Hub not configured)' };
}

module.exports = { explain, explainerStatus, SYSTEM_PROMPT, templateBriefing };
