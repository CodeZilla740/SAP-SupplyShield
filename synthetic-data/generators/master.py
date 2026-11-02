from __future__ import annotations

from .common import frame


def _label_synthetic(rows):
    return [{**row, "is_synthetic": True} for row in rows]


def generate_master(config, canonical):
    assumptions = config["assumptions"]
    facilities = _label_synthetic(canonical["facilities"])
    medicines = _label_synthetic(canonical["medicines"])
    carriers = _label_synthetic(canonical["carriers"] + assumptions["carriers"])
    lanes = _label_synthetic(canonical["lanes"] + assumptions["lanes"])
    inventory = _label_synthetic(canonical["inventory"] + assumptions["inventory"])
    suppliers = _label_synthetic(assumptions["suppliers"])

    return {
        "facilities": frame(facilities),
        "medicines": frame(medicines),
        "suppliers": frame(suppliers),
        "carriers": frame(carriers),
        "lanes": frame(lanes),
        "inventory": frame(inventory),
    }
