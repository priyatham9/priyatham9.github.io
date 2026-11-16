import copy
import importlib.util
import pathlib
import unittest
import numpy as np

P = pathlib.Path(__file__).with_name("build.py")
spec = importlib.util.spec_from_file_location("campaign_build", P)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def row(i=0):
    return {
        "age": str(20 + i % 40),
        "previous": str(i % 3),
        "pdays": "999" if i % 2 else str(i % 7),
        "job": "admin." if i % 2 else "technician",
        "marital": "single",
        "education": "high.school",
        "default": "unknown",
        "housing": "yes" if i % 2 else "no",
        "loan": "no",
        "poutcome": "nonexistent" if i % 2 else "failure",
        "duration": str(10 + i * 3),
        "month": "may",
        "y": "yes" if i % 3 == 0 else "no",
    }


class FeatureTests(unittest.TestCase):
    def test_pdays_sentinel_is_not_999_days_or_missing_zero(self):
        never = row(1)
        zero = row(0)
        zero["pdays"] = "0"
        X, names = m.feature_matrix([never, zero])
        self.assertEqual(
            names[:4], ["age", "previous", "pdaysObserved", "previouslyContacted"]
        )
        self.assertEqual(X[0, 2:4].tolist(), [0, 0])
        self.assertEqual(X[1, 2:4].tolist(), [0, 1])

    def test_duration_is_the_only_feature_difference(self):
        rows = [row(1), row(2)]
        a, an = m.feature_matrix(rows)
        b, bn = m.feature_matrix(rows, True)
        self.assertEqual(bn[:4], an[:4])
        self.assertEqual(bn[5:], an[4:])
        np.testing.assert_array_equal(a[:, :4], b[:, :4])
        np.testing.assert_array_equal(a[:, 4:], b[:, 5:])
        np.testing.assert_allclose(b[:, 4].astype(float), np.log1p([13, 16]))

    def test_excluded_fields_and_target_cannot_change_features(self):
        a = row(1)
        b = a | {
            "y": "no",
            "contact": "invented",
            "campaign": "999999",
            "emp.var.rate": "123",
            "month": "dec",
            "day_of_week": "fri",
            "euribor3m": "nan",
        }
        np.testing.assert_array_equal(
            m.feature_matrix([a])[0], m.feature_matrix([b])[0]
        )

    def test_invalid_numeric_input_fails_and_unknown_is_preserved(self):
        for value in ["nan", "inf", "", "-1"]:
            with self.assertRaises(ValueError):
                m.feature_matrix([row() | {"age": value}])
        X, _ = m.feature_matrix([row()])
        self.assertIn("unknown", X[0])


class MetricTests(unittest.TestCase):
    def test_average_precision_groups_ties_noninterpolated(self):
        r = m.metric_bundle(
            np.array([1, 0, 1]), np.array([0.8, 0.8, 0.2]), np.array([1, 2, 3])
        )
        self.assertAlmostEqual(r["averagePrecision"], 7 / 12)

    def test_no_positive_labels_are_undefined_for_ap_recall(self):
        r = m.metric_bundle(np.array([0, 0]), np.array([0.1, 0.9]), np.array([1, 2]))
        self.assertIsNone(r["averagePrecision"])
        self.assertIsNone(r["topBudget"]["recall"])
        self.assertEqual(r["topBudget"]["precision"], 0)

    def test_budget_ceil_and_ties_use_ordinal_not_input_order(self):
        y = np.array([0, 1, 0])
        s = np.array([0.4, 0.4, 0.1])
        o = np.array([20, 10, 30])
        r = m.metric_bundle(y, s, o)
        self.assertEqual(r["topBudget"]["count"], 1)
        self.assertEqual(r["topBudget"]["positives"], 1)
        self.assertEqual(m.ranking(s, o)[1].tolist(), [2, 1, 3])

    def test_calibration_edges_empty_bins_and_one_are_exact(self):
        b = m.calibration_bins(
            np.array([0, 1, 1]), np.array([0, 0.5, 1.0]), [0, 0.5, 0.75, 1]
        )
        self.assertEqual([x["n"] for x in b], [1, 1, 1])
        self.assertEqual(b[-1]["observedRate"], 1)
        empty = m.calibration_bins(np.array([0]), np.array([0.1]), [0, 0.5, 1])[1]
        self.assertIsNone(empty["meanProbability"])
        self.assertIsNone(empty["observedRate"])

    def test_constant_training_score_ap_is_evaluation_prevalence(self):
        r = m.metric_bundle(
            np.array([1, 0, 0, 1]), np.full(4, 0.1), np.arange(4), rank_budget=False
        )
        self.assertEqual(r["averagePrecision"], 0.5)
        self.assertAlmostEqual(r["brier"], 0.41)
        self.assertIsNone(r["topBudget"])

    def test_resampling_is_paired_and_handles_no_positive_replicates(self):
        p = {
            "resampling": {
                "replicates": 50,
                "seed": 7,
                "quantiles": [0.025, 0.975],
                "quantileMethod": "linear",
                "interpretation": "descriptive",
                "method": "paired",
            },
            "metrics": {"budgetFraction": 0.1},
        }
        r = m.paired_resampling(
            np.array([0, 0, 0]),
            np.array([0.1, 0.2, 0.3]),
            np.array([0.1, 0.2, 0.3]),
            np.arange(3),
            np.array([1, 1, 2]),
            p,
        )
        self.assertEqual(r["undefinedAPReplicates"], 50)
        self.assertEqual(r["ranges"]["averagePrecision"]["validReplicates"], 0)
        self.assertIsNone(r["ranges"]["averagePrecision"]["low"])
        self.assertEqual(r["ranges"]["brier"]["low"], 0)
        self.assertEqual(r["ranges"]["precisionAtBudget"]["high"], 0)
        self.assertEqual(r["replicateRows"], {"min": 2, "max": 4})
        self.assertEqual(
            r,
            m.paired_resampling(
                np.array([0, 0, 0]),
                np.array([0.1, 0.2, 0.3]),
                np.array([0.1, 0.2, 0.3]),
                np.arange(3),
                np.array([1, 1, 2]),
                p,
            ),
        )

    def test_blocks_preserve_order_and_repeated_months_remain_distinct(self):
        b = m.month_blocks([{"month": x} for x in ["may", "may", "jun", "may"]])
        self.assertEqual(
            [(x["month"], x["n"]) for x in b], [("may", 2), ("jun", 1), ("may", 1)]
        )
        self.assertEqual(b[-1]["firstRow"], 4)


class TrainingOnlyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.protocol = __import__("json").loads(m.PROTOCOL_PATH.read_text())
        cls.rows = [row(i) for i in range(80)]
        cls.y = m.labels(cls.rows)
        cls.fit = m.fit_model(cls.rows, cls.y, False, cls.protocol)

    def test_scaling_means_and_categories_are_train_only(self):
        means = self.fit["preprocessing"]["numeric"]["means"]
        self.assertAlmostEqual(means[0], np.mean([float(r["age"]) for r in self.rows]))
        before = m.canonical(self.fit)
        future = [row(2) | {"age": "99999", "job": "future-only-category"}]
        scores = m.score_model(future, self.fit, False)
        self.assertEqual(before, m.canonical(self.fit))
        self.assertNotIn(
            "future-only-category",
            str(self.fit["preprocessing"]["categorical"]["categories"]),
        )
        self.assertTrue(np.isfinite(scores).all())

    def test_source_order_prefix_is_reproducible_without_future_fit(self):
        repeated = m.fit_model(self.rows, self.y, False, self.protocol)
        self.assertEqual(m.sha(m.canonical(self.fit)), m.sha(m.canonical(repeated)))

    def test_unknown_category_replay_is_explicit_all_zero_onehot(self):
        r = row(1) | {"job": "not-in-training"}
        X, _ = m.feature_matrix([r])
        prep = self.fit["preprocessing"]
        n = 4
        v = (
            (X[0, :n].astype(float) - np.array(prep["numeric"]["means"]))
            / np.array(prep["numeric"]["scales"])
        ).tolist()
        for name, categories in zip(
            prep["categorical"]["names"], prep["categorical"]["categories"]
        ):
            v += [float(r[name] == level) for level in categories]
        logit = self.fit["intercept"] + sum(
            x * c["coefficient"] for x, c in zip(v, self.fit["coefficients"])
        )
        self.assertAlmostEqual(
            m.score_model([r], self.fit, False)[0], m.expit(logit), places=14
        )

    def test_model_source_replay_uses_probabilities_not_stale_supplied_scores(self):
        altered = copy.deepcopy(self.fit)
        altered["intercept"] += 1
        a = m.score_model(self.rows, self.fit, False)
        b = m.score_model(self.rows, altered, False)
        self.assertTrue((b > a).all())


class SourceTests(unittest.TestCase):
    def test_protocol_hash_source_license_and_split(self):
        protocol, source, rows = m.load_inputs()
        cutoff, blocks = m.choose_split(rows, protocol)
        self.assertEqual(cutoff, 27972)
        self.assertEqual(len(rows) - cutoff, 13216)
        self.assertEqual(len([b for b in blocks if b["partition"] == "holdout"]), 18)
        self.assertEqual(source["license"]["spdx"], "CC-BY-4.0")
        self.assertEqual(m.sha(m.PROTOCOL_PATH.read_bytes()), m.FROZEN_PROTOCOL_SHA256)


class PublishedArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import json

        cls.data = json.loads(m.OUTPUT.read_text())
        cls.protocol, cls.source, cls.rows = m.load_inputs()
        cls.cutoff, cls.blocks = m.choose_split(cls.rows, cls.protocol)
        cls.records = cls.data["records"]
        cls.y = m.labels(cls.rows[cls.cutoff :])
        cls.ordinals = np.arange(cls.cutoff + 1, len(cls.rows) + 1)

    def test_all_exported_records_match_source_outcomes_duration_and_order(self):
        self.assertEqual(len(self.records), 13216)
        self.assertEqual([r["row"] for r in self.records], self.ordinals.tolist())
        self.assertEqual([r["outcome"] for r in self.records], self.y.tolist())
        self.assertEqual(
            [r["durationSeconds"] for r in self.records],
            [int(r["duration"]) for r in self.rows[self.cutoff :]],
        )
        self.assertEqual(
            [r["blockId"] for r in self.records],
            [
                b["id"]
                for b in self.blocks
                if b["partition"] == "holdout"
                for _ in range(b["n"])
            ],
        )

    def test_frozen_analysis_execution_and_model_hashes_match(self):
        provenance = self.data["provenance"]
        self.assertEqual(provenance["analysisSourceSha256"], m.sha(P.read_bytes()))
        self.assertEqual(provenance["protocolSha256"], m.FROZEN_PROTOCOL_SHA256)
        self.assertEqual(
            provenance["executionManifestSha256"],
            m.sha((m.HERE / "execution-start.json").read_bytes()),
        )
        for key in m.MODEL_KEYS:
            self.assertEqual(
                self.data["models"][key]["modelSha256"],
                m.sha(m.canonical(self.data["models"][key]["fit"])),
            )
            self.assertTrue(self.data["models"][key]["fit"]["converged"])

    def test_every_published_score_replays_with_numerical_tolerance(self):
        for key in m.MODEL_KEYS:
            actual = m.score_model(
                self.rows[self.cutoff :],
                self.data["models"][key]["fit"],
                key == "withDuration",
            )
            expected = np.array([r[key] for r in self.records])
            np.testing.assert_allclose(actual, expected, rtol=0, atol=1e-12)
            metrics = m.metric_bundle(self.y, expected, self.ordinals)
            for name in ["averagePrecision", "brier", "logLoss"]:
                self.assertAlmostEqual(
                    metrics[name], self.data["models"][key]["metrics"][name], places=12
                )
            self.assertEqual(
                metrics["topBudget"], self.data["models"][key]["metrics"]["topBudget"]
            )

    def test_all_calibration_bins_and_month_blocks_recompute(self):
        block_ids = np.array([r["blockId"] for r in self.records])
        for key in m.MODEL_KEYS:
            scores = np.array([r[key] for r in self.records])
            bins = m.calibration_bins(
                self.y, scores, self.protocol["metrics"]["calibrationEdges"]
            )
            self.assertEqual(bins, self.data["calibration"][key])
            self.assertEqual(sum(b["n"] for b in bins), 13216)
            for block in self.data["monthly"]:
                keep = block_ids == block["blockId"]
                metrics = m.metric_bundle(
                    self.y[keep], scores[keep], self.ordinals[keep]
                )
                for name in ["averagePrecision", "brier", "logLoss"]:
                    self.assertAlmostEqual(metrics[name], block[key][name], places=12)
                self.assertEqual(metrics["topBudget"], block[key]["topBudget"])

    def test_published_ranks_and_default_use_scores_only(self):
        for key, rankkey in [
            ("withoutDuration", "rankWithoutDuration"),
            ("withDuration", "rankWithDuration"),
        ]:
            _, ranks = m.ranking(
                np.array([r[key] for r in self.records]), self.ordinals
            )
            self.assertEqual(ranks.tolist(), [r[rankkey] for r in self.records])
        winner = min(
            self.records,
            key=lambda r: (-abs(r["withDuration"] - r["withoutDuration"]), r["row"]),
        )
        self.assertEqual(winner["row"], self.data["recordDefaultRow"])


if __name__ == "__main__":
    unittest.main()
