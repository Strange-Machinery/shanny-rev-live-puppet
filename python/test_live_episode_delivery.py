import unittest
from live_episode_delivery import approved_routes


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
        self.assertEqual(got["SHANNY"], {"S07": "s-low"})
        self.assertEqual(got["REV"], {"R11": "r-mock"})

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

    def test_foreign_reference_cannot_influence_another_actor(self):
        broken = {**self.catalog, "category_routes": {
            "SHANNY": {"S07": [{"reference_id": "r-mock", "rank": 999}]},
            "REV": self.catalog["category_routes"]["REV"]}}
        self.assertEqual(approved_routes(broken, self.refs,
                                         {"SHANNY": ["S07"]})["SHANNY"], {})


if __name__ == "__main__":
    unittest.main()
