from __future__ import annotations

from datetime import datetime
from pathlib import Path
import json
import subprocess

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
OBSOLETE_DATASETS = (
    "facility_conditions",
    "disruption_impacts",
    "scenario_evaluations",
    "inventory_transfers",
    "recovery_outcomes",
    "compliance_audit_records",
)


def load_config():
    return json.loads((ROOT / "config.json").read_text(encoding="utf-8"))


def load_canonical():
    script = """
const data = require('./server/src/db/canonical-data');
process.stdout.write(JSON.stringify({
  medicines: data.medicines,
  facilities: data.facilities,
  inventory: data.inventory,
  carriers: data.carriers,
  lanes: data.lanes,
  purchaseOrders: data.purchaseOrders,
  shipments: data.shipments,
  disruptions: data.disruptions
}));
"""
    result = subprocess.run(
        ["node", "-e", script],
        cwd=PROJECT_ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(result.stdout)


def setup():
    config = load_config()
    canonical = load_canonical()
    reference = datetime.fromisoformat(config["reference_timestamp"])
    return config, canonical, reference


def frame(rows, columns=None):
    result = pd.DataFrame(rows, columns=columns)
    if "is_synthetic" not in result.columns:
        result["is_synthetic"] = True
    return result


def write_frames(frames):
    output = ROOT / "output"
    output.mkdir(parents=True, exist_ok=True)
    for name, data in frames.items():
        data.to_csv(output / f"{name}.csv", index=False, lineterminator="\n", na_rep="\\N")
    for name in OBSOLETE_DATASETS:
        stale_file = output / f"{name}.csv"
        if stale_file.exists():
            stale_file.unlink()
    manifest = {
        "synthetic": True,
        "generated_at": load_config()["reference_timestamp"],
        "record_counts": {name: int(len(data)) for name, data in frames.items()},
        "total_records": sum(len(data) for data in frames.values()),
        "assumptions": load_config()["assumptions"]["label"],
        "units": load_config()["units"],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
