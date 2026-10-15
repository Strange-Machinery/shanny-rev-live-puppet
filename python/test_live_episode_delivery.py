import unittest
from live_episode_delivery import approved_routes, select_reference, ALLOWED_CODES


class ApprovedLiveDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.catalog = {
            "category_routes": {
                "SHANNY": {"S07": [
                    {"reference_id": "s-low", "rank": 9},
                    {"reference_id": "s-alternate", "rank": 5}
                ], "S06": [{"reference_id": "s-rage", "rank": 10}]},
                "REV": {"R11": [{"reference_id": "r-mock", "rank": 8}]}
            }
        }
        self.refs = {
            "s-low": {"speaker": "Shanny", "reference_selection": {
                "category": "S07", "automatic_routing_eligible": True}},
            "s-alternate": {"speaker": "Shanny", "reference_selection": {
                "category": "S07", "automatic_routing_eligible": True}},
            "s-rage": {"speaker": "Shanny", "reference_selection": {
                "category": "S06", "automatic_routing_eligible": False}},
            "r-mock": {"speaker": "Rev", "reference_selection": {
                "category": "R11", "automatic_routing_eligible": True}}
        }

    def test_top_ranked_approved_actor_category(self):
        got = approved_routes(self.catalog, self.refs,
                              {"SHANNY": ["S07"], "REV": ["R11"]})
        self.assertEqual([row["reference_id"] for row in got["SHANNY"]["S07"]], ["s-low", "s-alternate"])
        self.assertEqual(got["REV"]["R11"][0]["reference_id"], "r-mock")

    def test_does_not_route_unreviewed_ref_even_when_highly_ranked(self):
        got = approved_routes(self.catalog, self.refs,
                              {"SHANNY": ["S06"], "REV": ["R11"]})
        self.assertEqual(got["SHANNY"], {})

    def test_actor_spoof_and_unknown_codes_rejected(self):
        for requested in [
            {"REV": ["S07"]}, {"SHANNY": ["S99"]}, {"BAD": ["S07"]},
            {"REV": ["R11", "R11"]}
        ]:
            with self.assertRaises(ValueError):
                approved_routes(self.catalog, self.refs, requested)

    def test_full_episode_catalog_is_addressable(self):
        self.assertEqual(len(ALLOWED_CODES["SHANNY"]), 20)
        self.assertEqual(len(ALLOWED_CODES["REV"]), 23)

    def test_weighted_variants_are_deterministic_and_continuity_aware(self):
        routes = approved_routes(self.catalog, self.refs,
                                  {"SHANNY": ["S07"], "REV": ["R11"]})
        selected, state = select_reference(routes, "SHANNY", "S07", "request-123", 73001)
        repeated, _ = select_reference(routes, "SHANNY", "S07", "request-123", 73001)
        self.assertEqual(selected, repeated)
        self.assertIn(selected, ("s-low", "s-alternate"))
        self.assertEqual(state["reference_id"], selected)
        with self.assertRaises(ValueError):
            select_reference(routes, "REV", "S07", "request-123", 73001)

    def test_rage_intensity_selects_real_approved_source_not_pitch_manipulation(self):
        library = {"category_routes": {"SHANNY": {"S06": [
            {"reference_id": "full-rage", "rank": 8},
            {"reference_id": "medium-rage", "rank": 9}
        ]}}}
        references = {
            "full-rage": {"speaker": "Shanny", "reference_selection": {
                "category": "S06", "automatic_routing_eligible": True,
                "delivery_intensity": "full"}},
            "medium-rage": {"speaker": "Shanny", "reference_selection": {
                "category": "S06", "automatic_routing_eligible": True,
                "delivery_intensity": "medium"}}
        }
        routes = approved_routes(library, references, {"SHANNY": ["S06"]})
        self.assertEqual(select_reference(routes, "SHANNY", "S06", "1", 73001,
                                          intensity="full")[0], "full-rage")
        self.assertEqual(select_reference(routes, "SHANNY", "S06", "1", 73001,
                                          intensity="medium")[0], "medium-rage")
        with self.assertRaises(ValueError):
            select_reference(routes, "SHANNY", "S06", "1", 73001,
                             intensity="unknown")

    def test_episode_original_reassurance_fallback_is_verified(self):
        library = {"category_routes": {"REV": {}}}
        refs = {"rev-03-reassuring": {"speaker": "Rev",
                "reference_selection": {"category": "R03"}}}
        route = approved_routes(library, refs, {"REV": ["R03"]})
        self.assertEqual(route["REV"]["R03"][0]["reference_id"],
                         "rev-03-reassuring")

    def test_foreign_reference_cannot_influence_another_actor(self):
        broken = {**self.catalog, "category_routes": {
            "SHANNY": {"S07": [{"reference_id": "r-mock", "rank": 999}]},
            "REV": self.catalog["category_routes"]["REV"]}}
        self.assertEqual(approved_routes(broken, self.refs,
                                         {"SHANNY": ["S07"]})["SHANNY"], {})


if __name__ == "__main__":
    unittest.main()
