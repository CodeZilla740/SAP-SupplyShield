from __future__ import annotations

from .common import frame


def generate_transactions(config, canonical):
    supplier_ids = {
        row["name"]: row["supplier_id"]
        for row in config["assumptions"]["suppliers"]
    }
    purchase_orders = canonical["purchaseOrders"] + config["assumptions"]["additional_purchase_orders"]
    shipments = canonical["shipments"] + config["assumptions"]["additional_shipments"]

    labelled_pos = []
    for order in purchase_orders:
        supplier_id = supplier_ids.get(order["supplier_name"])
        if supplier_id is None:
            raise ValueError(f"No synthetic supplier mapping for {order['supplier_name']}")
        labelled_pos.append({
            **order,
            "supplier_id": supplier_id,
            "is_synthetic": True,
        })

    labelled_shipments = []
    for shipment in shipments:
        labelled_shipments.append({**shipment, "is_synthetic": True})

    return frame(labelled_pos), frame(labelled_shipments)
