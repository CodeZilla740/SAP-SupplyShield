from __future__ import annotations

import sys

from generators.common import setup, write_frames
from generators.disruptions import generate_disruptions
from generators.master import generate_master
from generators.operations import generate_operations
from generators.transactions import generate_transactions
from validate import validate


def main():
    config, canonical, reference = setup()
    master = generate_master(config, canonical)
    purchase_orders, shipments = generate_transactions(config, canonical)
    temperatures, tracking = generate_operations(reference, shipments)
    disruptions = generate_disruptions(config, canonical)

    frames = {
        "facilities": master["facilities"],
        "medicines": master["medicines"],
        "suppliers": master["suppliers"],
        "carriers": master["carriers"],
        "lanes": master["lanes"],
        "inventory": master["inventory"],
        "purchase_orders": purchase_orders,
        "shipments": shipments,
        "temperature_readings": temperatures,
        "shipment_tracking": tracking,
        "disruptions": disruptions,
    }
    validate(frames, config, reference)
    write_frames(frames)
    for name, data in frames.items():
        print(f"{name}: {len(data):,}")
    print(f"Total records: {sum(len(data) for data in frames.values())}")
    print("Validation: PASS")
    print(f"Output: {__import__('pathlib').Path(__file__).resolve().parent / 'output'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Synthetic data generation failed: {error}", file=sys.stderr)
        raise
