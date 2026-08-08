import json
import unittest
from pathlib import Path
import scout

ROOT = Path(__file__).resolve().parent
CONFIG = scout.load_config(ROOT / "interests.json")


class TestScoring(unittest.TestCase):
    def test_clinical_small_model_scores_high(self):
        score, matches = scout.score_title(
            "Evaluating Small Language Models for Clinical Information Extraction",
            CONFIG,
        )
        self.assertGreaterEqual(score, 12)
        concepts = {m.concept for m in matches}
        self.assertIn("small_language_models", concepts)
        self.assertIn("biomedical_information_extraction", concepts)

    def test_robotics_penalty_applies(self):
        score, matches = scout.score_title(
            "Retrieval-Augmented Navigation for Autonomous Robots",
            CONFIG,
        )
        self.assertTrue(any(m.kind == "negative" for m in matches))

    def test_synonyms_do_not_double_score_same_concept(self):
        config = {
            "interests": {
                "x": {"weight": 5, "terms": ["clinical", "clinical text"]}
            },
            "negative_signals": {},
        }
        score, matches = scout.score_title("Clinical Text Methods", config)
        self.assertEqual(score, 5)
        self.assertEqual(len(matches), 1)

    def test_demo_ranking(self):
        ranked = scout.rank(scout.demo_papers(), CONFIG)
        self.assertGreater(ranked[0].score, ranked[-1].score)
        self.assertTrue(
            any("clinical" in x.paper.title.lower() for x in ranked[:4])
        )


if __name__ == "__main__":
    unittest.main()
