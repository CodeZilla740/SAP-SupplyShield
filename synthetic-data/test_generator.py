import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generators.common import setup
from generators.disruptions import generate_disruptions
from generators.master import generate_master
from generators.operations import generate_operations
from generators.transactions import generate_transactions
from validate import validate


class SyntheticGeneratorTests(unittest.TestCase):
    def generate_all(self):
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
        return config, canonical, reference, frames

    def test_expanded_snapshot_counts_and_existing_data_reuse(self):
        config, canonical, _, frames = self.generate_all()
        self.assertEqual(sum(map(len, frames.values())), 136)
        for name, count in config["counts"].items():
            self.assertEqual(len(frames[name]), count)
        self.assertEqual(
            frames["facilities"]["code"].tolist(),
            [row["code"] for row in canonical["facilities"]],
        )
        self.assertEqual(
            frames["medicines"]["sku"].tolist(),
            [row["sku"] for row in canonical["medicines"]],
        )
        self.assertEqual(
            frames["disruptions"]["id"].tolist(),
            [row["id"] for row in canonical["disruptions"]],
        )
        self.assertTrue(all(data["is_synthetic"].all() for data in frames.values()))
        self.assertNotIn("reliability_score", frames["suppliers"].columns)

    def test_repeated_generation_is_deterministic_without_random_inputs(self):
        _, _, _, first = self.generate_all()
        _, _, _, second = self.generate_all()
        for name in first:
            pd.testing.assert_frame_equal(first[name], second[name])

    def test_temperature_and_tracking_records_follow_shipment_data(self):
        _, _, reference, frames = self.generate_all()
        shipments = frames["shipments"].set_index("id")
        medicines = frames["medicines"].set_index("sku")
        for reading in frames["temperature_readings"].to_dict("records"):
            shipment = shipments.loc[reading["shipment_id"]]
            medicine = medicines.loc[shipment["product_sku"]]
            self.assertLessEqual(medicine["min_temp"], reading["temp_c"])
            self.assertGreaterEqual(medicine["max_temp"], reading["temp_c"])
            self.assertEqual(pd.Timestamp(reading["ts"]).isoformat(), reference.isoformat())
        self.assertTrue(frames["shipment_tracking"]["latitude"].isna().all())
        self.assertTrue(frames["shipment_tracking"]["longitude"].isna().all())

    def test_temperature_excursion_is_rejected(self):
        config, _, reference, frames = self.generate_all()
        frames["temperature_readings"].loc[0, "temp_c"] = 20
        with self.assertRaisesRegex(ValueError, "Temperature excursion"):
            validate(frames, config, reference)


if __name__ == "__main__":
    unittest.main()
