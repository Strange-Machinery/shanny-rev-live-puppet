"""Bounded prequalified fast-live references chosen from the installed episode catalog.

No model weights or acoustic pitch parameters are changed. Every reference is
confirmed in the existing saved-prompt registry; unknown categories stay OFF.
"""
from __future__ import annotations

import math

ALLOWED_CODES = {
    "SHANNY": frozenset(("S05", "S06", "S07", "S08", "S09", "S10", "S11", "S20")),
    "REV": frozenset(("R01", "R09", "R10", "R11", "R12", "R13", "R14", "R20")),
}


def approved_routes(library, references, requested):
    if not isinstance(library, dict) or not isinstance(references, dict) or not isinstance(requested, dict):
        raise ValueError("Invalid episode reference manifest")
    if any(actor not in ALLOWED_CODES for actor in requested):
        raise ValueError("Unknown episode actor")
    result = {}
    for actor, codes in requested.items():
        if not isinstance(codes, list) or len(codes) > 24 or len(set(codes)) != len(codes):
            raise ValueError("Invalid or duplicate episode delivery request")
        if any(not isinstance(code, str) or code not in ALLOWED_CODES[actor] for code in codes):
            raise ValueError("Unreviewed episode delivery category")
        result[actor] = {}
        available = library.get("category_routes", {}).get(actor, {})
        for code in codes:
            choices = available.get(code, [])
            allowed = []
            for choice in choices:
                if not isinstance(choice, dict) or not isinstance(choice.get("reference_id"), str):
                    continue
                ref = references.get(choice["reference_id"])
                if not isinstance(ref, dict):
                    continue
                sel = ref.get("reference_selection", {})
                if (str(ref.get("speaker", "")).upper() != actor or
                        sel.get("category") != code or
                        sel.get("automatic_routing_eligible") is not True):
                    continue
                rank = choice.get("rank", 0)
                if isinstance(rank, bool) or not isinstance(rank, (int, float)) or not math.isfinite(rank):
                    continue
                allowed.append((float(rank), choice["reference_id"]))
            if allowed:
                # Prefer best auditioned natural delivery. Stable across live
                # requests; no RNG/voice changes or extra GPU decoding.
                allowed.sort(key=lambda row: (-row[0], row[1]))
                result[actor][code] = allowed[0][1]
    return result
