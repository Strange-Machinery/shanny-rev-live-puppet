"""Qualified fast-live selection from the entire installed episode voice library.

Nothing is cloned or resynthesized as a new voice. This is the episode's
audition-ranked, source-continuity-aware selection of existing saved prompts.
Expensive reference loading belongs to resident worker startup; routing a live
line performs only dictionary lookups and tiny bounded weighted selection.
"""
from __future__ import annotations

import hashlib
import math
import random

ALLOWED_CODES = {
    "SHANNY": frozenset(f"S{i:02d}" for i in range(1, 21)),
    "REV": frozenset(f"R{i:02d}" for i in range(1, 24)),
}
# Small continuity families parallel to episode selection. If the acting
# direction changes families, this preference vanishes (it never overrides
# categorical approval). Multiple approved sources can exist in one category.
GROUPS = {
    "SHANNY": {
        "anger": frozenset(("S05", "S06", "S07", "S08", "S09", "S11", "S20")),
        "cry": frozenset(("S01", "S02", "S03", "S04", "S05", "S13", "S14")),
        "positive": frozenset(("S15", "S16", "S17", "S19")),
        "inquiry": frozenset(("S12", "S18")),
    },
    "REV": {
        "anger": frozenset(("R09", "R10", "R11", "R12", "R13", "R14", "R15", "R20")),
        "cry": frozenset(("R04", "R16", "R17", "R18")),
        "positive": frozenset(("R03", "R05", "R06", "R07", "R19", "R21", "R22")),
        "inquiry": frozenset(("R01", "R02", "R08", "R23")),
    },
}


def families(actor, code):
    return frozenset(k for k, codes in GROUPS[actor].items() if code in codes)


def approved_routes(library, references, requested):
    if not isinstance(library, dict) or not isinstance(references, dict) or not isinstance(requested, dict):
        raise ValueError("Invalid episode reference manifest")
    if any(actor not in ALLOWED_CODES for actor in requested):
        raise ValueError("Unknown episode actor")
    result = {}
    for actor, codes in requested.items():
        if (not isinstance(codes, list) or len(codes) > 24 or
                len(set(codes)) != len(codes)):
            raise ValueError("Invalid or duplicate episode delivery request")
        if any(not isinstance(code, str) or code not in ALLOWED_CODES[actor] for code in codes):
            raise ValueError("Unreviewed episode delivery category")
        result[actor] = {}
        available = library.get("category_routes", {}).get(actor, {})
        for code in codes:
            choices = available.get(code, [])
            qualified = []
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
                rank = choice.get("rank")
                if (isinstance(rank, bool) or not isinstance(rank, (int, float)) or
                        not math.isfinite(rank)):
                    continue
                qualified.append({
                    "reference_id": choice["reference_id"],
                    "rank": float(rank),
                    "source_family_id": sel.get("source_family_id") or sel.get("source_video_id"),
                })
            if qualified:
                qualified.sort(key=lambda row: (-row["rank"], row["reference_id"]))
                result[actor][code] = qualified
    return result


def select_reference(routes, actor, code, request_id, seed, prior=None):
    """Choose in constant small time, deterministically given this live request.

    The first suitable ranked prompt wins only when the category has one
    auditioned candidate. Otherwise weight ranks as the episode engine does,
    prefer source family continuity for compatible expression, and discourage
    monotonous exact repetition when alternatives exist.
    """
    choices = routes.get(actor, {}).get(code)
    if not choices or not isinstance(request_id, str) or not request_id:
        raise ValueError("Voice category not qualified for this actor")
    if not isinstance(seed, int):
        raise ValueError("Invalid deterministic selection seed")
    preferred = None
    if prior and (families(actor, code) & prior.get("groups", frozenset())):
        preferred = prior.get("source_family_id")
    max_rank = max(x["rank"] for x in choices)
    weights = []
    for choice in choices:
        weight = 2.0 ** (2.0 * (choice["rank"] - max_rank))
        if preferred and choice["source_family_id"] == preferred:
            weight *= 8.0
        if prior and prior.get("reference_id") == choice["reference_id"] and len(choices) > 1:
            weight *= 0.25
        weights.append(weight)
    material = f"{seed}|{actor}|{code}|{request_id}"
    random_seed = int(hashlib.sha256(material.encode("utf-8")).hexdigest()[:16], 16)
    chosen = random.Random(random_seed).choices(choices, weights=weights, k=1)[0]
    state = {
        "groups": families(actor, code),
        "reference_id": chosen["reference_id"],
        "source_family_id": chosen["source_family_id"],
    }
    return chosen["reference_id"], state
