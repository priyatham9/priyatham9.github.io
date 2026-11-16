#!/usr/bin/env python3
"""Frozen, CPU-only UCI campaign timing audit. Fit once; verify saved model replay."""

from __future__ import annotations
import os

for _thread_var in (
    "OPENBLAS_NUM_THREADS",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
):
    os.environ[_thread_var] = "1"
import argparse
import csv
import datetime
import gzip
import hashlib
import io
import json
import math
import pathlib
import platform
import warnings
import numpy as np
import scipy
from scipy.special import expit
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, log_loss
from sklearn.preprocessing import OneHotEncoder, StandardScaler

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUTPUT = ROOT / "labs/crm/campaign.data.json"
PROTOCOL_PATH = HERE / "protocol.json"
FROZEN_PROTOCOL_SHA256 = (
    "8f847d7ad5cbbb71aa962dfdde9cfd3a34bb20dc594a4bb46268627ac9dc978b"
)
MODEL_KEYS = ("withoutDuration", "withDuration")
NUMERIC = ["age", "previous", "pdaysObserved", "previouslyContacted"]
CATEGORICAL = ["job", "marital", "education", "default", "housing", "loan", "poutcome"]
EXPECTED_COLUMNS = [
    "age",
    "job",
    "marital",
    "education",
    "default",
    "housing",
    "loan",
    "contact",
    "month",
    "day_of_week",
    "duration",
    "campaign",
    "pdays",
    "previous",
    "poutcome",
    "emp.var.rate",
    "cons.price.idx",
    "cons.conf.idx",
    "euribor3m",
    "nr.employed",
    "y",
]


def sha(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode()


def runtime():
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "scikit-learn": sklearn.__version__,
    }


def load_inputs():
    body = PROTOCOL_PATH.read_bytes()
    if sha(body) != FROZEN_PROTOCOL_SHA256:
        raise ValueError(
            "Frozen protocol bytes changed; do not silently redefine the study"
        )
    protocol = json.loads(body)
    for package in ("numpy", "scipy", "scikit-learn"):
        if runtime()[package] != protocol["runtime"][package]:
            raise ValueError(
                "Install pinned requirements.txt before fitting/verifying: " + package
            )
    source = json.loads((HERE / "sources/manifest.json").read_text())
    stored = (HERE / "sources" / source["data"]["storedFile"]).read_bytes()
    if sha(stored) != source["data"]["storedSha256"]:
        raise ValueError("Compressed CSV source hash mismatch")
    raw = gzip.decompress(stored)
    if (
        sha(raw) != source["data"]["sha256"]
        or sha(raw) != protocol["dataSha256"]
        or len(raw) != source["data"]["bytes"]
    ):
        raise ValueError("Original CSV source hash/length mismatch")
    reader = csv.DictReader(io.StringIO(raw.decode()), delimiter=";")
    if reader.fieldnames != EXPECTED_COLUMNS:
        raise ValueError("Wrong dataset variant/column schema")
    rows = list(reader)
    if len(rows) != protocol["rows"]:
        raise ValueError("Unexpected row count")
    return protocol, source, rows


def month_blocks(rows):
    blocks = []
    for ordinal, row in enumerate(rows, 1):
        month = row["month"]
        if month not in [
            "jan",
            "feb",
            "mar",
            "apr",
            "may",
            "jun",
            "jul",
            "aug",
            "sep",
            "oct",
            "nov",
            "dec",
        ]:
            raise ValueError("Invalid month label")
        if not blocks or blocks[-1]["month"] != month:
            blocks.append(
                {
                    "id": len(blocks) + 1,
                    "month": month,
                    "firstRow": ordinal,
                    "lastRow": ordinal,
                    "n": 1,
                }
            )
        else:
            blocks[-1]["lastRow"] = ordinal
            blocks[-1]["n"] += 1
    return blocks


def choose_split(rows, protocol):
    blocks = month_blocks(rows)
    cutoff = max(
        b["lastRow"]
        for b in blocks
        if b["lastRow"]
        <= math.floor(len(rows) * protocol["split"]["targetTrainFraction"])
    )
    if (
        cutoff != protocol["split"]["trainLastRow"]
        or len(rows) - cutoff != protocol["split"]["holdoutRows"]
    ):
        raise ValueError("Source-order split differs from frozen protocol")
    for b in blocks:
        b["partition"] = "train" if b["lastRow"] <= cutoff else "holdout"
    if [b["id"] for b in blocks if b["partition"] == "holdout"] != protocol["split"][
        "holdoutBlockIds"
    ]:
        raise ValueError("Holdout block IDs differ from frozen protocol")
    return cutoff, blocks


def labels(rows):
    if any(row["y"] not in ("yes", "no") for row in rows):
        raise ValueError("Unexpected target label")
    return np.array([row["y"] == "yes" for row in rows], dtype=np.int64)


def feature_matrix(rows, include_duration=False):
    numeric = NUMERIC + (["log1pDuration"] if include_duration else [])
    values = []
    for row in rows:
        age, previous, pdays = (float(row[k]) for k in ("age", "previous", "pdays"))
        if not all(math.isfinite(x) and x >= 0 for x in (age, previous, pdays)):
            raise ValueError(
                "Nonfinite, negative or missing numeric profile/history input"
            )
        v = [
            age,
            previous,
            0.0 if pdays == 999 else pdays,
            0.0 if pdays == 999 else 1.0,
        ]
        if include_duration:
            duration = float(row["duration"])
            if not math.isfinite(duration) or duration < 0:
                raise ValueError("Invalid duration")
            v.append(math.log1p(duration))
        if any(not isinstance(row[k], str) or not row[k] for k in CATEGORICAL):
            raise ValueError(
                "Empty categorical field; literal unknown must remain explicit"
            )
        values.append(v + [row[k] for k in CATEGORICAL])
    return np.array(values, dtype=object), numeric + CATEGORICAL


def fit_model(train_rows, train_y, include_duration, protocol):
    X, names = feature_matrix(train_rows, include_duration)
    number_count = len(NUMERIC) + int(include_duration)
    preprocessing = ColumnTransformer(
        [
            ("numeric", StandardScaler(), list(range(number_count))),
            (
                "categorical",
                OneHotEncoder(handle_unknown="ignore", drop=None, sparse_output=True),
                list(range(number_count, len(names))),
            ),
        ],
        sparse_threshold=1.0,
    )
    transformed = preprocessing.fit_transform(X)
    params = {
        k: protocol["model"][k]
        for k in (
            "solver",
            "penalty",
            "C",
            "class_weight",
            "fit_intercept",
            "max_iter",
            "tol",
            "random_state",
        )
    }
    model = LogisticRegression(**params)
    with warnings.catch_warnings():
        warnings.simplefilter("error", ConvergenceWarning)
        warnings.filterwarnings(
            "ignore", category=FutureWarning, message=".*penalty.*deprecated.*"
        )
        model.fit(transformed, train_y)
    if int(model.n_iter_[0]) >= params["max_iter"]:
        raise RuntimeError("Model reached max_iter; protocol forbids silent retuning")
    scaler = preprocessing.named_transformers_["numeric"]
    encoder = preprocessing.named_transformers_["categorical"]
    fit = {
        "nIterations": int(model.n_iter_[0]),
        "converged": True,
        "parameterCount": int(model.coef_.size + 1),
        "intercept": float(model.intercept_[0]),
        "coefficients": [
            {"feature": name, "coefficient": float(value)}
            for name, value in zip(
                preprocessing.get_feature_names_out(names), model.coef_[0]
            )
        ],
        "preprocessing": {
            "numeric": {
                "names": names[:number_count],
                "means": scaler.mean_.tolist(),
                "scales": scaler.scale_.tolist(),
            },
            "categorical": {
                "names": CATEGORICAL,
                "categories": [x.tolist() for x in encoder.categories_],
            },
        },
    }
    # Replay independently of sklearn's fitted objects before publishing parameters.
    np.testing.assert_allclose(
        score_model(train_rows, fit, include_duration),
        model.predict_proba(transformed)[:, 1],
        rtol=0,
        atol=2e-14,
    )
    return fit


def score_model(rows, fit, include_duration):
    """Replay saved numeric scales, categorical vocabularies and coefficients."""
    X, _ = feature_matrix(rows, include_duration)
    prep = fit["preprocessing"]
    n = len(prep["numeric"]["names"])
    numeric = (X[:, :n].astype(float) - np.array(prep["numeric"]["means"])) / np.array(
        prep["numeric"]["scales"]
    )
    parts = [numeric]
    for j, categories in enumerate(prep["categorical"]["categories"]):
        # Unseen levels intentionally produce all-zero one-hot columns.
        parts.append(
            np.column_stack(
                [X[:, n + j] == category for category in categories]
            ).astype(float)
        )
    encoded = np.column_stack(parts)
    coef = np.array([c["coefficient"] for c in fit["coefficients"]])
    if encoded.shape[1] != len(coef):
        raise ValueError("Saved preprocessing/parameter dimensions disagree")
    return expit(encoded @ coef + fit["intercept"])


def ranking(scores, ordinals):
    # Third key makes duplicated bootstrap occurrences deterministic too.
    order = np.lexsort((np.arange(len(scores)), ordinals, -scores))
    ranks = np.empty(len(scores), dtype=np.int64)
    ranks[order] = np.arange(1, len(scores) + 1)
    return order, ranks


def metric_bundle(y, scores, ordinals, budget_fraction=0.1, rank_budget=True):
    n = len(y)
    if n == 0:
        raise ValueError("Cannot evaluate an empty batch")
    positives = int(y.sum())
    result = {
        "averagePrecision": float(average_precision_score(y, scores))
        if positives
        else None,
        "brier": float(np.mean((scores - y) ** 2)),
        "logLoss": float(log_loss(y, scores, labels=[0, 1])),
        "topBudget": None,
    }
    if rank_budget:
        count = math.ceil(budget_fraction * n)
        selected = ranking(scores, ordinals)[0][:count]
        captured = int(y[selected].sum())
        result["topBudget"] = {
            "fraction": budget_fraction,
            "count": count,
            "positives": captured,
            "precision": captured / count,
            "recall": captured / positives if positives else None,
        }
    return result


def calibration_bins(y, scores, edges):
    index = np.clip(np.searchsorted(edges, scores, side="right") - 1, 0, len(edges) - 2)
    bins = []
    for i in range(len(edges) - 1):
        mask = index == i
        n = int(mask.sum())
        positives = int(y[mask].sum())
        bins.append(
            {
                "lower": edges[i],
                "upper": edges[i + 1],
                "n": n,
                "positives": positives,
                "meanProbability": float(scores[mask].mean()) if n else None,
                "observedRate": positives / n if n else None,
            }
        )
    return bins


def paired_resampling(y, p0, p1, ordinals, block_ids, protocol):
    spec = protocol["resampling"]
    ids = np.unique(block_ids)
    groups = [np.flatnonzero(block_ids == i) for i in ids]
    rng = np.random.default_rng(spec["seed"])
    draws = rng.integers(0, len(ids), size=(spec["replicates"], len(ids)))
    deltas = {k: [] for k in ("averagePrecision", "brier", "precisionAtBudget")}
    sizes = []
    undefined = 0
    for draw in draws:
        take = np.concatenate([groups[i] for i in draw])
        sizes.append(len(take))
        yy = y[take]
        ss0 = p0[take]
        ss1 = p1[take]
        oo = ordinals[take]
        if yy.sum():
            deltas["averagePrecision"].append(
                float(
                    average_precision_score(yy, ss1) - average_precision_score(yy, ss0)
                )
            )
        else:
            undefined += 1
        deltas["brier"].append(
            float(np.mean((ss1 - yy) ** 2) - np.mean((ss0 - yy) ** 2))
        )
        k = math.ceil(protocol["metrics"]["budgetFraction"] * len(take))
        deltas["precisionAtBudget"].append(
            float(
                yy[ranking(ss1, oo)[0][:k]].mean() - yy[ranking(ss0, oo)[0][:k]].mean()
            )
        )
    ranges = {}
    for key, values in deltas.items():
        q = (
            np.quantile(
                values, spec["quantiles"], method=spec["quantileMethod"]
            ).tolist()
            if values
            else [None, None]
        )
        ranges[key] = {"low": q[0], "high": q[1], "validReplicates": len(values)}
    return {
        "replicates": spec["replicates"],
        "seed": spec["seed"],
        "ranges": ranges,
        "undefinedAPReplicates": undefined,
        "replicateRows": {"min": min(sizes), "max": max(sizes)},
        "sampledBlockIndexSha256": sha(canonical(draws.tolist())),
        "interpretation": spec["interpretation"],
        "method": spec["method"],
    }


def quality_summary(train, holdout, fit):
    cats = fit["preprocessing"]["categorical"]
    levels = dict(zip(cats["names"], cats["categories"]))
    return {
        "unknownTokens": {
            name: {
                "train": sum(r[name] == "unknown" for r in train),
                "holdout": sum(r[name] == "unknown" for r in holdout),
            }
            for name in CATEGORICAL
        },
        "unseenHoldoutCategories": {
            name: {
                "count": sum(r[name] not in levels[name] for r in holdout),
                "values": sorted(
                    {r[name] for r in holdout if r[name] not in levels[name]}
                ),
            }
            for name in CATEGORICAL
        },
        "neverPreviouslyContacted": {
            "train": sum(r["pdays"] == "999" for r in train),
            "holdout": sum(r["pdays"] == "999" for r in holdout),
        },
        "clientIdsAvailable": False,
        "fullDatesAvailable": False,
    }


def assemble(protocol, source, rows, fits, provenance):
    cutoff, blocks = choose_split(rows, protocol)
    train, holdout = rows[:cutoff], rows[cutoff:]
    y_train, y = labels(train), labels(holdout)
    ordinals = np.arange(cutoff + 1, len(rows) + 1)
    block_ids = np.array(
        [b["id"] for b in blocks if b["partition"] == "holdout" for _ in range(b["n"])]
    )
    scores = {
        key: score_model(holdout, fits[key], key == "withDuration")
        for key in MODEL_KEYS
    }
    metrics = {
        key: metric_bundle(
            y, scores[key], ordinals, protocol["metrics"]["budgetFraction"]
        )
        for key in MODEL_KEYS
    }
    ranks = {key: ranking(scores[key], ordinals)[1] for key in MODEL_KEYS}
    models = {
        key: {
            "label": "Profile/history under stated timing assumptions"
            + (" + post-call duration" if key == "withDuration" else ""),
            "metrics": metrics[key],
            "fit": fits[key],
            "modelSha256": sha(canonical(fits[key])),
        }
        for key in MODEL_KEYS
    }
    baseline = float(y_train.mean())
    models["constantBaseline"] = {
        "label": "Training-prevalence constant score",
        "probability": baseline,
        "metrics": metric_bundle(
            y, np.full(len(y), baseline), ordinals, rank_budget=False
        ),
    }
    monthly = []
    for block in blocks:
        if block["partition"] != "holdout":
            continue
        mask = block_ids == block["id"]
        yy = y[mask]
        monthly.append(
            {
                "blockId": block["id"],
                "n": int(mask.sum()),
                "positives": int(yy.sum()),
                "prevalence": float(yy.mean()),
                **{
                    key: metric_bundle(
                        yy,
                        scores[key][mask],
                        ordinals[mask],
                        protocol["metrics"]["budgetFraction"],
                    )
                    for key in MODEL_KEYS
                },
            }
        )
    summary = lambda yy, first, last: {
        "firstRow": first,
        "lastRow": last,
        "n": len(yy),
        "positives": int(yy.sum()),
        "prevalence": float(yy.mean()),
    }
    deltas = {
        "averagePrecision": metrics["withDuration"]["averagePrecision"]
        - metrics["withoutDuration"]["averagePrecision"],
        "brier": metrics["withDuration"]["brier"] - metrics["withoutDuration"]["brier"],
        "precisionAtBudget": metrics["withDuration"]["topBudget"]["precision"]
        - metrics["withoutDuration"]["topBudget"]["precision"],
    }
    records = [
        {
            "row": int(ordinal),
            "blockId": int(block_ids[i]),
            "durationSeconds": int(holdout[i]["duration"]),
            "outcome": int(y[i]),
            "withoutDuration": float(scores["withoutDuration"][i]),
            "withDuration": float(scores["withDuration"][i]),
            "rankWithoutDuration": int(ranks["withoutDuration"][i]),
            "rankWithDuration": int(ranks["withDuration"][i]),
        }
        for i, ordinal in enumerate(ordinals)
    ]
    default = int(
        ordinals[
            np.lexsort(
                (ordinals, -np.abs(scores["withDuration"] - scores["withoutDuration"]))
            )[0]
        ]
    )
    return {
        "schemaVersion": "crm-campaign-audit/1",
        "source": source,
        "protocol": protocol,
        "provenance": provenance
        | {"modelDigests": {key: models[key]["modelSha256"] for key in MODEL_KEYS}},
        "split": {
            "train": summary(y_train, 1, cutoff),
            "holdout": summary(y, cutoff + 1, len(rows)),
            "blocks": blocks,
        },
        "models": models,
        "comparison": {
            "deltas": deltas,
            "blockResampling": paired_resampling(
                y,
                scores["withoutDuration"],
                scores["withDuration"],
                ordinals,
                block_ids,
                protocol,
            ),
        },
        "calibration": {
            key: calibration_bins(
                y, scores[key], protocol["metrics"]["calibrationEdges"]
            )
            for key in MODEL_KEYS
        },
        "monthly": monthly,
        "records": records,
        "recordDefaultRow": default,
        "dataQuality": quality_summary(train, holdout, fits["withoutDuration"]),
        "limitations": protocol["limits"],
    }


def output_bytes(result):
    return (
        json.dumps(
            result, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        ).encode()
        + b"\n"
    )


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--fit", action="store_true")
    mode.add_argument("--check", action="store_true")
    args = parser.parse_args()
    protocol, source, rows = load_inputs()
    cutoff, _ = choose_split(rows, protocol)
    analysis_sha = sha(pathlib.Path(__file__).read_bytes())
    if args.fit:
        execution_path = HERE / "execution-start.json"
        if OUTPUT.exists() or execution_path.exists():
            raise FileExistsError(
                "An audit artifact or execution-start record already exists. Use --check; do not silently refit the published holdout study."
            )
        execution = {
            "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "analysisSourceSha256": analysis_sha,
            "protocolSha256": FROZEN_PROTOCOL_SHA256,
            "dataSha256": source["data"]["sha256"],
            "runtime": runtime(),
            "threads": 1,
        }
        execution_path.write_text(json.dumps(execution, indent=2) + "\n")
        # This source hash and immutable protocol are persisted before model fit/holdout scoring.
        provenance = {
            "protocolSha256": FROZEN_PROTOCOL_SHA256,
            "analysisSourceSha256": analysis_sha,
            "runtime": runtime(),
            "executionStartedAt": execution["startedAt"],
            "executionManifestSha256": sha(execution_path.read_bytes()),
            "threads": 1,
            "scoreSemantics": "Uncalibrated logistic probabilities; no heldout fitting or recalibration",
            "verification": "Saved parameters replay the fixed models; source and protocol bytes are pinned.",
        }
        train = rows[:cutoff]
        y_train = labels(train)
        fits = {
            key: fit_model(train, y_train, key == "withDuration", protocol)
            for key in MODEL_KEYS
        }
    else:
        existing = json.loads(OUTPUT.read_text())
        provenance = {
            k: v for k, v in existing["provenance"].items() if k != "modelDigests"
        }
        if (
            sha((HERE / "execution-start.json").read_bytes())
            != provenance["executionManifestSha256"]
        ):
            raise ValueError("Execution-start manifest digest mismatch")
        if (
            provenance["analysisSourceSha256"] != analysis_sha
            or provenance["protocolSha256"] != FROZEN_PROTOCOL_SHA256
        ):
            raise ValueError("Published analysis-source/protocol digest changed")
        fits = {key: existing["models"][key]["fit"] for key in MODEL_KEYS}
        for key in MODEL_KEYS:
            if sha(canonical(fits[key])) != existing["models"][key]["modelSha256"]:
                raise ValueError("Saved fitted-model digest mismatch")
    result = assemble(protocol, source, rows, fits, provenance)
    body = output_bytes(result)
    if args.fit:
        OUTPUT.write_bytes(body)
        print("Wrote", OUTPUT, len(body), "bytes")
        print(
            json.dumps(
                {
                    "split": result["split"] | {"blocks": "see artifact"},
                    "metrics": {k: v["metrics"] for k, v in result["models"].items()},
                    "deltas": result["comparison"]["deltas"],
                    "ranges": result["comparison"]["blockResampling"]["ranges"],
                    "iterations": {k: fits[k]["nIterations"] for k in MODEL_KEYS},
                },
                indent=2,
            )
        )
    else:
        if body != OUTPUT.read_bytes():
            raise ValueError(
                "Published scores/metrics do not match deterministic saved-model replay"
            )
        print(
            "Verified pinned source/protocol/model digests, all heldout scores, calibration, monthly metrics and paired block-resampling ranges"
        )


if __name__ == "__main__":
    main()
