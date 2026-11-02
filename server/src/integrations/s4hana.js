// ============================================================================
// SAP S/4HANA INTEGRATION ADAPTER
//
// DEFAULT (and what runs in the demo): the MOCK adapter. Purchase orders are
// stored as S/4HANA-shaped records (EBELN numbering, supplier, product,
// destination, port) inside SAP HANA Cloud / the local fallback database.
// This is the documented, honest swap point: the tables mirror the
// S/4HANA OData entity structure, so switching to live OData calls later
// only changes this file.
//
// LIVE mode is only active when S4HANA_BASE_URL and S4HANA_API_KEY are set
// (e.g. the SAP API Business Accelerator Hub sandbox). It is read-only and
// never writes to S/4HANA. We do not claim live S/4HANA connectivity
// unless these variables are configured AND a call succeeds.
// ============================================================================
const config = require('../config');

function isLiveConfigured() {
  return Boolean(config.s4hana.baseUrl && config.s4hana.apiKey);
}

async function getPurchaseOrders(db) {
  if (isLiveConfigured()) {
    try {
      const url = `${config.s4hana.baseUrl.replace(/\/$/, '')}`
        + '/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder?$top=50'
        + '&$select=PurchaseOrder,Supplier,PurchaseOrderDate';
      const res = await fetch(url, {
        headers: { APIKey: config.s4hana.apiKey, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      return {
        mode: 'LIVE (read-only sandbox call)',
        records: (body.d && body.d.results) || [],
      };
    } catch (e) {
      return {
        mode: 'MOCK (live call failed: ' + e.message + ')',
        records: await db.all('SELECT * FROM purchase_orders'),
      };
    }
  }
  return {
    mode: 'MOCK (S/4HANA-shaped demo records in the database; set S4HANA_BASE_URL + S4HANA_API_KEY for a live read-only sandbox call)',
    records: await db.all('SELECT * FROM purchase_orders'),
  };
}

function status() {
  return isLiveConfigured()
    ? { configured: true, mode: 'LIVE read-only (SAP API Business Accelerator Hub sandbox)' }
    : { configured: false, mode: 'MOCK adapter (S/4HANA-shaped demo data)' };
}

module.exports = { getPurchaseOrders, status, isLiveConfigured };
