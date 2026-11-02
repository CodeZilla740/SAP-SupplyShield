from __future__ import annotations

from .common import frame


def generate_disruptions(config, canonical):
    analyzed_id = config["boot_analyzed_disruption_id"]
    return frame([
        {
            **event,
            "status": "ANALYSED" if event["id"] == analyzed_id else event["status"],
            "is_synthetic": True,
        }
        for event in canonical["disruptions"]
    ])
