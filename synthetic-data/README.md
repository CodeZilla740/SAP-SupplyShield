# Compact synthetic supply-chain data

This generator creates a reproducible 136-row snapshot from the existing
simulated demo seed plus explicitly labelled scenario assumptions. It does not
use random generation, external operational data, or model-generated
recommendations. All generated CSV rows have `is_synthetic=true`.

## Data sources and assumptions

- Existing facilities, medicines, inventory, carriers, lanes, purchase
  orders, shipments, and disruptions are read from
  `server/src/db/canonical-data.js`, the application's documented simulated
  source of truth.
- The extra carrier rate cards, eight lanes, four inventory positions,
  three POs/shipments, and five supplier-name rows are fixed in `config.json`.
  Their values are demonstration assumptions, not real carrier contracts,
  route distances, stock records, or supplier facts.
- Supplier reliability, country, and other unsupported supplier attributes
  are omitted. The schema stores only `purchase_orders.supplier_name`; the
  supplier IDs in the CSV snapshot are auxiliary and are not persisted.
- Shipment tracking records are persisted in `shipment_tracking`; unknown
  coordinates use the CSV null marker `\N`.
- Temperature snapshots reuse each shipment's configured `current_temp` and
  are validated against the medicine's storage band. They are not represented
  as live telemetry.
- No external dataset is used, so there are no external-source dates or
  real-world claims.

The fixed scenario clock follows the canonical simulated event time in the
project. The Chennai disruption status in the snapshot reflects the normal
boot pipeline (`ANALYSED`); the canonical source is `ACTIVE` before that
pipeline runs. There is no random seed because generation is deterministic
without randomness.

## Snapshot size

| Dataset | Rows |
|---|---:|
| Facilities | 18 |
| Medicines | 6 |
| Suppliers (CSV only) | 5 |
| Carriers | 6 |
| Logistics lanes | 20 |
| Inventory positions | 19 |
| Purchase orders | 13 |
| Shipments | 13 |
| Temperature readings | 13 |
| Shipment tracking | 13 |
| Disruption scenarios | 10 |
| **Total** | **136** |

Facilities cover Mumbai, Chennai, Hyderabad, Bengaluru, Delhi NCR, Kolkata,
and Pune. Added scenario records include port congestion, demand surge, power
outage, and extreme weather. These are synthetic and unverified; unavailable
demand increments and facility telemetry remain explicitly unresolved.

The scenario-evaluation CSVs from the former generator are intentionally
removed. The five existing agents calculate options at runtime from the same
initial inventory; a proposed plan is not described as an executed recovery.
Scoring and hard rules continue to come from the existing policy and rules
engine, including cold-chain certification and range, donor safety stock,
stock-cover deadline, documented score weights, and the configured one-day
transfer buffer.

## Generate and validate

Requires Python dependencies in `requirements.txt` and the project's Node.js
runtime so the generator can read the canonical seed without copying it.

```powershell
python -m pip install -r synthetic-data\requirements.txt
python synthetic-data\main.py
python -m unittest discover -s synthetic-data -p test_generator.py
```

Validation checks exact counts, total size, IDs, foreign keys, supplier-name
links, PO/shipment consistency, inventory quantities, lane/carrier modes,
temperature limits, coordinate completeness/ranges, and timezone-aware
timestamps. The manifest records per-dataset counts and the assumption label.
It also declares the units used for quantities, distances, rates, temperatures,
and times.
Generation writes only under `synthetic-data/output/`; it does not touch the
database, the canonical seed, or the CAP/SQLite/HANA schemas.

## Optional non-production import

The runtime importer supports medicines, facilities, inventory, carriers,
lanes, purchase orders, shipments, disruptions, temperature readings, and
tracking. Supplier names are derived from persisted purchase orders because
the current schema does not define a separate supplier master entity.

```powershell
Invoke-RestMethod -Method Post http://localhost:4004/api/admin/import-synthetic
```

The importer uses the existing SQLite/HANA facade and runs transactionally.
Rows identical to existing primary/composite-key records are skipped; a
same-key row with different values fails and rolls back rather than replacing
anything. This allows the canonical seed to be present without overwriting
it. The endpoint remains restricted to non-production environments. Do not
run it against a database unless that import is explicitly intended.
