// ============================================================================
// AGENT 1 - SENSING AGENT
// Receives disruption information, classifies the event, determines severity
// and the expected delay, and distinguishes verified operational disruptions
// from unverified alerts. No numbers are invented here: the delay comes from
// the configured severity map in policy.
// ============================================================================
const { policy } = require('../db/canonical-data');

async function run(db, disruption) {
  const errors = [];
  if (!disruption) errors.push('Disruption record not found');
  if (disruption && !disruption.type) errors.push('Missing disruption type');
  if (disruption && !disruption.severity) errors.push('Missing severity');
  if (disruption && !policy.DELAY_HOURS_BY_SEVERITY[disruption.severity]) {
    errors.push(`Unknown severity "${disruption.severity}"`);
  }

  const delayHours = disruption
    ? (disruption.expected_delay_hours || policy.DELAY_HOURS_BY_SEVERITY[disruption.severity])
    : 0;

  return {
    type: disruption && disruption.type,
    title: disruption && disruption.title,
    port: disruption && disruption.port,
    severity: disruption && disruption.severity,
    delayHours,
    // verified=1 means an operational source confirmed the disruption
    // (e.g. port authority bulletin). A weather alert alone stays
    // verified=0 and is labelled UNVERIFIED - never treated as a closure.
    verified: Boolean(disruption && disruption.verified),
    source: disruption && disruption.source,
    errors,
  };
}

module.exports = { run };
