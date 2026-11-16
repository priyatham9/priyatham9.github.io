import copy, gzip, importlib.util, json, pathlib, unittest

P = pathlib.Path(__file__).with_name("build.py")
spec = importlib.util.spec_from_file_location("filings_build", P)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.row = {
            "start": "2025-01-01",
            "end": "2025-12-31",
            "val": 123,
            "accn": "original",
            "filed": "2026-02-01",
            "form": "10-K",
            "fy": 2025,
            "frame": "MISLEADING",
        }
        self.data = {"facts": {"us-gaap": {"Test": {"units": {"USD": [self.row]}}}}}
        self.args = dict(
            end="2025-12-31",
            start="2025-01-01",
            accession="original",
            filed="2026-02-01",
        )

    def pick(self, **kwargs):
        return m.select_fact(self.data, "Test", **(self.args | kwargs))

    def rows(self):
        return self.data["facts"]["us-gaap"]["Test"]["units"]["USD"]

    def test_exact_period_not_fy_or_frame(self):
        self.row["fy"] = 2099
        self.assertEqual(self.pick()["value"], 123)
        self.rows().insert(0, self.row | {"start": "2025-04-01", "val": 999})
        self.assertEqual(self.pick()["value"], 123)

    def test_instant_cannot_select_duration(self):
        with self.assertRaises(m.SelectionError):
            self.pick(start=None)

    def test_units_are_not_convertible_by_guess(self):
        with self.assertRaises(m.SelectionError):
            self.pick(unit="USD/shares")

    def test_duplicate_identical_values_collapse(self):
        self.rows().append(copy.deepcopy(self.row))
        self.assertEqual(self.pick()["identicalRows"], 2)

    def test_conflicting_exact_values_fail(self):
        self.rows().append(self.row | {"val": 124})
        with self.assertRaises(m.SelectionError):
            self.pick()

    def test_amendment_not_silently_substituted(self):
        self.rows().append(
            self.row
            | {"form": "10-K/A", "accn": "amendment", "filed": "2026-03-01", "val": 456}
        )
        r = self.pick()
        self.assertEqual(r["value"], 123)
        self.assertTrue(r["laterAnnualObservations"][0]["changed"])
        self.rows().pop(0)
        with self.assertRaises(m.SelectionError):
            self.pick()

    def test_same_day_amendment_is_disclosed_but_never_substituted(self):
        self.rows().append(
            self.row | {"form": "10-K/A", "accn": "same-day-amendment", "val": 456}
        )
        r = self.pick()
        self.assertEqual(r["value"], 123)
        self.assertEqual(
            r["laterAnnualObservations"][0]["accession"], "same-day-amendment"
        )

    def test_cutoff_excludes_future_comparative(self):
        self.rows().append(
            self.row | {"accn": "later", "filed": "2027-03-01", "val": 999}
        )
        self.assertEqual(self.pick()["laterAnnualObservations"], [])
        with self.assertRaises(m.SelectionError):
            self.pick(as_of="2026-01-31")

    def test_later_comparative_is_evidence_not_selected_value(self):
        self.rows().append(
            self.row | {"accn": "later", "filed": "2026-10-01", "val": 456}
        )
        r = self.pick()
        self.assertEqual(r["value"], 123)
        self.assertEqual(r["laterAnnualObservations"][0]["value"], 456)

    def test_wrong_filing_date_is_not_tolerated(self):
        with self.assertRaises(m.SelectionError):
            self.pick(filed="2026-02-02")


class ArithmeticTests(unittest.TestCase):
    def test_cash_signs_and_negative_asset_xbrl_fact(self):
        self.assertEqual(
            m.bridge(10, 7, -3, -1),
            {
                "balanceChange": -3,
                "balanceProxy": 3,
                "reportedAdjustment": 3,
                "residual": 0,
            },
        )
        self.assertEqual(m.bridge(10, 14, 4, 1)["balanceProxy"], 4)

    def test_scope_missing_is_not_zero(self):
        with self.assertRaises(m.SelectionError):
            m.scope_total([], ["inventory"])

    def test_net_agreement_can_hide_offsetting_disagreement(self):
        rows = [
            {
                "account": "a",
                "balanceProxy": 10,
                "reportedAdjustment": 15,
                "residual": 5,
            },
            {
                "account": "b",
                "balanceProxy": 20,
                "reportedAdjustment": 15,
                "residual": -5,
            },
        ]
        r = m.scope_total(rows, ["a", "b"])
        self.assertEqual(r["residual"], 0)
        self.assertEqual(r["grossAbsoluteResidual"], 10)
        self.assertEqual(r["offsettingResidual"], 10)


class PinnedEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = m.build()

    def test_actual_microsoft_sign_reversal_is_bounded_to_three_accounts(self):
        y = self.data["companies"][0]["years"][1]
        r = y["scopes"]["threeAccounts"]
        self.assertEqual(
            (r["balanceProxy"], r["reportedAdjustment"], r["residual"]),
            (3262000000, -7930000000, -11192000000),
        )
        self.assertTrue(r["signMismatch"])
        self.assertEqual(
            [x["residual"] for x in y["rows"]], [-1766000000, -2000000, -9424000000]
        )

    def test_actual_costco_cancellation_is_visible(self):
        y = self.data["companies"][1]["years"][1]
        r = y["scopes"]["inventoryPayables"]
        self.assertEqual(
            (r["residual"], r["grossAbsoluteResidual"]), (2000000, 108000000)
        )
        self.assertNotIn("threeAccounts", y["scopes"])

    def test_fiscal_dates_are_not_calendar_year_assumptions(self):
        self.assertEqual(
            [y["days"] for c in self.data["companies"] for y in c["years"]],
            [365, 365, 364, 364],
        )

    def test_all_selected_facts_have_exact_vintage_and_units(self):
        for c in self.data["companies"]:
            for y in c["years"]:
                facts = [y["operatingCashFlow"]] + [
                    r[k] for r in y["rows"] for k in ["opening", "closing", "flow"]
                ]
                for f in facts:
                    self.assertEqual(f["accession"], y["accession"])
                    self.assertEqual(f["filed"], y["filed"])
                    self.assertEqual(f["unit"], "USD")
                    self.assertEqual(f["form"], "10-K")

    def test_checked_quotes_and_hashes_are_mandatory(self):
        bad = self.data["sources"][0] | {"sha256": "0" * 64}
        with self.assertRaises(m.SelectionError):
            m.read_source(bad)
        with self.assertRaises(m.SelectionError):
            m.quotation({"excerpts": [{"text": "different"}]}, "exact quote")

    def test_curated_report_extracts_are_bounded_and_bound_to_original_hashes(self):
        for meta in self.data["sources"]:
            if meta["storageKind"] != "curated-report-extract":
                continue
            self.assertNotIn("storedFile", meta)
            extract = m.read_source(meta)
            self.assertLessEqual(extract["quotedProseWordCount"], 200)
            self.assertEqual(extract["originalResponseSha256"], meta["sha256"])
            self.assertNotEqual(meta["extractSha256"], meta["sha256"])
            with self.assertRaises(m.SelectionError):
                m.read_source(meta | {"extractSha256": "0" * 64})
            with self.assertRaises(m.SelectionError):
                m.read_source(meta | {"sha256": "0" * 64})

    def test_full_report_verification_requires_original_bytes_and_excerpt_membership(
        self,
    ):
        raw = b"<p>Selected original evidence.</p>"
        meta = {
            "id": "fixture",
            "storageKind": "curated-report-extract",
            "sha256": m.sha(raw),
            "bytes": len(raw),
        }
        extract = {"excerpts": [{"id": "one", "text": "Selected original evidence."}]}
        self.assertTrue(m.verify_original(meta, raw, extract))
        with self.assertRaises(m.SelectionError):
            m.verify_original(meta, raw + b"changed", extract)
        with self.assertRaises(m.SelectionError):
            m.verify_original(
                meta,
                raw,
                {"excerpts": [{"id": "false", "text": "Not in the original."}]},
            )

    def test_deterministic_public_artifact(self):
        self.assertEqual(m.output_bytes(self.data), m.OUTPUT.read_bytes())
        self.assertEqual(m.output_bytes(m.build()), m.output_bytes(self.data))


if __name__ == "__main__":
    unittest.main()
