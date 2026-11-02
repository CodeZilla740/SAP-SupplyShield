from __future__ import annotations

from datetime import datetime
import math


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _records(frame):
    return frame.astype(object).where(frame.notna(), None).to_dict("records")


def _timestamp(value, label):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label} is not a valid ISO-8601 timestamp: {value}") from error
    _require(parsed.utcoffset() is not None, f"{label} must include a timezone offset")
    return parsed


def _whole_nonnegative(value, label):
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be a non-negative whole number")
    _require(math.isfinite(numeric) and numeric.is_integer() and numeric >= 0,
             f"{label} must be a non-negative whole number")


def validate(frames, config, reference):
    counts = config["counts"]
    _require(set(frames) == set(counts), "Generated datasets do not match configured datasets")
    total = sum(len(data) for data in frames.values())
    _require(total == config["snapshot_total"], f"Expected {config['snapshot_total']} records, got {total}")
    _require(reference.utcoffset() is not None, "Reference timestamp must include a timezone offset")

    for name, expected in counts.items():
        data = frames[name]
        _require(len(data) == expected, f"{name}: expected {expected}, got {len(data)}")
        _require(
            data["is_synthetic"].eq(True).all(),
            f"{name} contains a record not labelled synthetic",
        )

    records = {name: _records(data) for name, data in frames.items()}
    facilities = records["facilities"]
    medicines = records["medicines"]
    suppliers = records["suppliers"]
    carriers = records["carriers"]
    lanes = records["lanes"]
    inventory = records["inventory"]
    orders = records["purchase_orders"]
    shipments = records["shipments"]
    temperatures = records["temperature_readings"]
    tracking = records["shipment_tracking"]
    disruptions = records["disruptions"]

    ids = {
        "facilities": ("code", facilities),
        "medicines": ("sku", medicines),
        "suppliers": ("supplier_id", suppliers),
        "carriers": ("code", carriers),
        "lanes": ("id", lanes),
        "purchase_orders": ("ebeln", orders),
        "shipments": ("id", shipments),
        "temperature_readings": ("id", temperatures),
        "shipment_tracking": ("tracking_id", tracking),
        "disruptions": ("id", disruptions),
    }
    for name, (column, rows) in ids.items():
        values = [str(row[column]) for row in rows]
        _require(len(values) == len(set(values)), f"{name} contains duplicate {column}")

    facility_by_code = {row["code"]: row for row in facilities}
    medicine_by_sku = {row["sku"]: row for row in medicines}
    carrier_by_code = {row["code"]: row for row in carriers}
    supplier_by_id = {row["supplier_id"]: row for row in suppliers}
    inventory_by_position = {}
    for row in inventory:
        key = (row["facility_code"], row["product_sku"])
        _require(key not in inventory_by_position, f"Duplicate inventory position {key}")
        inventory_by_position[key] = row
        _require(row["facility_code"] in facility_by_code, f"Unknown inventory facility {key[0]}")
        _require(row["product_sku"] in medicine_by_sku, f"Unknown inventory medicine {key[1]}")
        _whole_nonnegative(row["qty_on_hand"], f"On-hand stock at {key}")
        _whole_nonnegative(row["reserved_qty"], f"Reserved stock at {key}")
        _whole_nonnegative(row["daily_usage"], f"Daily usage at {key}")
        _whole_nonnegative(row["safety_stock"], f"Safety stock at {key}")
        _require(0 <= row["reserved_qty"] <= row["qty_on_hand"], f"Invalid reserved stock at {key}")
        _require(0 <= row["safety_stock"] <= row["qty_on_hand"], f"Invalid safety stock at {key}")

    for medicine in medicines:
        _require(medicine["min_temp"] < medicine["max_temp"], f"Invalid temperature band for {medicine['sku']}")
        _require(medicine["case_size"] > 0, f"Invalid case size for {medicine['sku']}")

    for lane in lanes:
        _require(lane["origin_code"] in facility_by_code, f"Unknown lane origin {lane['origin_code']}")
        _require(lane["destination_code"] in facility_by_code, f"Unknown lane destination {lane['destination_code']}")
        _require(lane["origin_code"] != lane["destination_code"], f"Lane {lane['id']} loops to itself")
        _require(lane["carrier_code"] in carrier_by_code, f"Unknown lane carrier {lane['carrier_code']}")
        carrier = carrier_by_code[lane["carrier_code"]]
        _require(lane["mode"] == carrier["mode"], f"Lane {lane['id']} mode differs from its carrier")
        _require(math.isfinite(float(lane["distance_km"])) and lane["distance_km"] > 0,
                 f"Lane {lane['id']} must have positive distance in km")

    for carrier in carriers:
        _require(carrier["mode"] in ("ROAD", "AIR"), f"Invalid mode for {carrier['code']}")
        for column in ("cold_chain_certified", "telemetry_capable"):
            _require(carrier[column] in (0, 1), f"Invalid {column} flag for {carrier['code']}")
        _require(math.isfinite(float(carrier["base_cost"])) and carrier["base_cost"] >= 0,
                 f"Invalid USD base cost for {carrier['code']}")
        _require(math.isfinite(float(carrier["cost_per_km"])) and carrier["cost_per_km"] >= 0,
                 f"Invalid USD/km rate for {carrier['code']}")
        _require(math.isfinite(float(carrier["avg_speed_kmh"])) and carrier["avg_speed_kmh"] > 0,
                 f"Invalid km/h speed for {carrier['code']}")
        _require(math.isfinite(float(carrier["handling_hours"])) and carrier["handling_hours"] >= 0,
                 f"Invalid handling time for {carrier['code']}")
        carrier_min, carrier_max = carrier["min_temp"], carrier["max_temp"]
        _require(
            (carrier_min is None and carrier_max is None)
            or (
                carrier_min is not None and carrier_max is not None
                and carrier_min < carrier_max
            ),
            f"Incomplete carrier temperature band for {carrier['code']}",
        )
        if carrier["cold_chain_certified"]:
            _require(carrier_min is not None and carrier["telemetry_capable"],
                     f"Certified carrier {carrier['code']} lacks a verified band or telemetry")
            for medicine in medicines:
                _require(
                    carrier_min >= medicine["min_temp"] and carrier_max <= medicine["max_temp"],
                    f"Certified carrier {carrier['code']} is outside {medicine['sku']} storage limits",
                )

    order_by_id = {row["ebeln"]: row for row in orders}
    for order in orders:
        _require(order["product_sku"] in medicine_by_sku, f"Unknown PO medicine {order['ebeln']}")
        _require(order["destination_code"] in facility_by_code, f"Unknown PO destination {order['ebeln']}")
        _require(order["supplier_id"] in supplier_by_id, f"Unknown PO supplier {order['ebeln']}")
        _require(order["supplier_name"] == supplier_by_id[order["supplier_id"]]["name"],
                 f"Supplier name/ID mismatch for {order['ebeln']}")
        _require(float(order["qty"]).is_integer() and order["qty"] > 0,
                 f"PO quantity must be a positive whole number for {order['ebeln']}")
        _require(order["status"] in ("IN_TRANSIT", "DELIVERED"), f"Invalid PO status for {order['ebeln']}")
        eta = datetime.strptime(order["eta"], "%Y-%m-%d").date()
        _require(eta >= reference.date(), f"PO {order['ebeln']} ETA precedes the snapshot date")

    shipment_by_id = {row["id"]: row for row in shipments}
    for shipment in shipments:
        _require(shipment["po_ebeln"] in order_by_id, f"Unknown shipment PO {shipment['id']}")
        order = order_by_id[shipment["po_ebeln"]]
        _require(shipment["product_sku"] == order["product_sku"], f"PO/shipment medicine mismatch {shipment['id']}")
        _require(shipment["destination_code"] == order["destination_code"], f"PO/shipment destination mismatch {shipment['id']}")
        _require(shipment["origin_code"] in facility_by_code, f"Unknown shipment origin {shipment['id']}")
        _require(shipment["destination_code"] in facility_by_code, f"Unknown shipment destination {shipment['id']}")
        medicine = medicine_by_sku[shipment["product_sku"]]
        _require(shipment["batch"] == medicine["batch"], f"Shipment batch does not match medicine {shipment['id']}")
        _require(
            medicine["min_temp"] <= shipment["current_temp"] <= medicine["max_temp"],
            f"Shipment temperature outside {shipment['product_sku']} storage band",
        )
        _require(math.isfinite(float(shipment["current_temp"])), f"Invalid shipment temperature {shipment['id']}")
        _require(math.isfinite(float(shipment["delay_hours"])) and shipment["delay_hours"] >= 0,
                 f"Invalid shipment delay {shipment['id']}")

    for reading in temperatures:
        _require(reading["shipment_id"] in shipment_by_id, f"Unknown temperature shipment {reading['shipment_id']}")
        shipment = shipment_by_id[reading["shipment_id"]]
        medicine = medicine_by_sku[shipment["product_sku"]]
        _require(reading["batch"] == shipment["batch"], f"Temperature batch mismatch for {reading['shipment_id']}")
        _require(medicine["min_temp"] <= reading["temp_c"] <= medicine["max_temp"],
                 f"Temperature excursion for {reading['shipment_id']}")
        timestamp = _timestamp(reading["ts"], f"Temperature timestamp for {reading['shipment_id']}")
        _require(timestamp <= reference, f"Temperature reading is after the snapshot for {reading['shipment_id']}")
    temperature_shipments = [row["shipment_id"] for row in temperatures]
    _require(
        len(temperature_shipments) == len(set(temperature_shipments)) == len(shipments),
        "Expected exactly one temperature snapshot per shipment",
    )

    for event in disruptions:
        _require(event["port"], f"Disruption {event['id']} has no affected port")
        _require(event["expected_delay_hours"] > 0, f"Disruption {event['id']} has no positive delay")
        _require(event["verified"] in (0, 1), f"Invalid verification state for {event['id']}")
        timestamp = _timestamp(event["created_at"], f"Disruption timestamp for {event['id']}")
        _require(timestamp <= reference, f"Disruption is after the snapshot for {event['id']}")
        relevant_orders = [
            row for row in orders
            if row["port"] == event["port"] and row["status"] == "IN_TRANSIT"
        ]
        _require(relevant_orders, f"Disruption {event['id']} does not affect an in-transit PO")

    for point in tracking:
        _require(point["shipment_id"] in shipment_by_id, f"Unknown tracking shipment {point['shipment_id']}")
        shipment = shipment_by_id[point["shipment_id"]]
        _require(point["status"] == shipment["status"], f"Tracking status mismatch for {point['shipment_id']}")
        _require(point["delay_hours"] == shipment["delay_hours"], f"Tracking delay mismatch for {point['shipment_id']}")
        timestamp = _timestamp(point["ts"], f"Tracking timestamp for {point['shipment_id']}")
        _require(timestamp <= reference, f"Tracking point is after the snapshot for {point['shipment_id']}")
        latitude, longitude = point["latitude"], point["longitude"]
        _require(
            (latitude is None and longitude is None)
            or (
                latitude is not None and longitude is not None
                and -90 <= latitude <= 90 and -180 <= longitude <= 180
            ),
            f"Invalid or partial tracking coordinates for {point['shipment_id']}",
        )
    tracking_shipments = [row["shipment_id"] for row in tracking]
    _require(
        len(tracking_shipments) == len(set(tracking_shipments)) == len(shipments),
        "Expected exactly one tracking snapshot per shipment",
    )

    _require(
        all(event["status"] in ("ACTIVE", "MONITORING", "ANALYSED", "RESOLVED") for event in disruptions),
        "Invalid disruption status",
    )
    return True
