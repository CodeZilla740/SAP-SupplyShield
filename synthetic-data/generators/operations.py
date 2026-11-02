from __future__ import annotations

from .common import frame


def generate_operations(reference, shipments):
    timestamp = reference.isoformat(timespec="seconds")
    temperature_rows = []
    tracking_rows = []
    for index, shipment in enumerate(shipments.to_dict("records"), start=1):
        temperature_rows.append({
            "id": 1000 + index,
            "shipment_id": shipment["id"],
            "batch": shipment["batch"],
            "ts": timestamp,
            "temp_c": shipment["current_temp"],
            "is_synthetic": True,
        })
        tracking_rows.append({
            "tracking_id": f"SYN-TRK-{index:03d}",
            "shipment_id": shipment["id"],
            "ts": timestamp,
            "latitude": None,
            "longitude": None,
            "location": shipment["origin_label"],
            "status": shipment["status"],
            "delay_hours": shipment["delay_hours"],
            "is_synthetic": True,
        })

    return frame(temperature_rows), frame(tracking_rows)
