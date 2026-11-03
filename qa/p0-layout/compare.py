"""Read paired browser evidence; preserve raw failures and verify scoped diffs."""
from pathlib import Path
from itertools import product
import argparse
import hashlib
import json
import re
import subprocess


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs/migration-evidence/p0-finance-layout"
CURRENCIES = ("CNY", "USD", "EUR", "HKD", "GBP", "JPY")
AMOUNTS = dict(CNY="-¥0.01", USD="-US$0.01", EUR="-€0.01", HKD="-HK$0.01", GBP="-£0.01", JPY="-JP¥1")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def by_id(rows, key):
    result = {key(row): row for row in rows}
    assert len(result) == len(rows), "Duplicate observed case identity"
    return result


def old_worktree_bytes(root, commit, name, expected):
    assert re.fullmatch(r"[0-9a-f]{40}", commit)
    assert name and ".." not in Path(name).parts
    raw = subprocess.check_output(["git", "show", commit + ":" + name], cwd=root)
    # Git stores LF while the preserved Windows worktree may use CRLF.
    # Accept only a reconstruction whose exact bytes match the recorded hash.
    text = raw.decode("utf8").replace("\r\n", "\n")
    candidates = [raw, text.encode(), text.replace("\n", "\r\n").encode()]
    matches = [candidate for candidate in candidates if sha(candidate) == expected]
    assert matches, "Cannot reconstruct recorded before bytes: " + name
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    options = parser.parse_args()
    for folder in (options.before, options.after, options.out):
        assert folder.resolve().is_relative_to(EVIDENCE.resolve()) and folder.resolve() != EVIDENCE.resolve()
    assert not options.out.exists(), "Preserve previous evidence"
    before, after = [read(folder / "result.json") for folder in (options.before, options.after)]
    for folder, record in ((options.before, before), (options.after, after)):
        assert record["source_stable"] and record["driver_stable"]
        assert sha((folder / "executed-driver.mjs").read_bytes()) == record["driver_sha256_before"] == record["driver_sha256_after"]
        assert record["synthetic_only"] and record["real_chrome"] and record["real_local_http"] and record["real_miniflare_d1"]
        assert record["production_operations"] == record["real_payment_operations"] == record["external_provider_calls"] == 0
    previous, current = by_id(before["rows"], lambda row: row["id"]), by_id(after["rows"], lambda row: row["id"])
    assert previous.keys() == current.keys() and len(current) == 112
    expected = set(product((320, 384, 600, 1100), ("light", "dark"), CURRENCIES))
    geometry = {}
    for label, folder in (("before", options.before), ("after", options.after)):
        values = by_id(read(folder / "geometry.json"), lambda row: (row["viewport"], row["theme"], row["id"].removeprefix("synthetic-layout-")))
        assert values.keys() == expected
        for (width, theme, currency), row in values.items():
            assert row["amount"]["text"] == AMOUNTS[currency], "Original amount display differs"
            if label == "after":
                assert row["main"]["width"] >= min(120, width / 3)
                assert row["documentWidth"] <= width + 1
        geometry[label] = values
    for row in after["rows"]:
        assert row["status"] == "PASS", "After run has actual failure: " + row["id"]
    assert any(row["status"] == "FAIL" and row["id"].endswith("-readable-unclipped-row") for row in before["rows"])
    original, final = [by_id(record["fixture"]["originalFacts"], lambda row: row["id"]) for record in (before, after)]
    assert original.keys() == final.keys() and len(original) == 6
    for ident, value in original.items():
        assert value["amount_minor"] == final[ident]["amount_minor"] == 1
        assert {key: item for key, item in value.items() if key != "amount_exponent"} == {key: item for key, item in final[ident].items() if key != "amount_exponent"}
        assert final[ident]["amount_exponent"] == (0 if value["currency"] == "JPY" else 2)
    root = Path(after["product_root"])
    changes = []
    old_files, new_files = before["source_before"]["files"], after["source_before"]["files"]
    for name in sorted(old_files.keys() & new_files.keys()):
        if old_files[name] == new_files[name]:
            continue
        old = old_worktree_bytes(root, before["source_before"]["head"], name, old_files[name]).decode("utf8").replace("\r\n", "\n")
        raw = (root / name).read_bytes()
        assert sha(raw) == new_files[name], "Current product differs from completed after evidence: " + name
        new = raw.decode("utf8").replace("\r\n", "\n")
        if name == "workspace-experience.css":
            anchor = ".finance-transaction-side { display: grid; justify-items: end; gap: 4px; }"
            replacement = ".finance-transaction-side { display: grid; justify-items: end; gap: 4px; min-width: 0; }\n.finance-transaction-side > small { max-inline-size: min(40vw, 22rem); overflow-wrap: anywhere; }"
            assert old.count(anchor) == 1 and old.replace(anchor, replacement) == new
            kind = "only_two_scoped_css_rules"
        else:
            assert old.replace("20261031-aeris-p0-finance-r1", "20261031-aeris-p0-finance-r2") == new
            kind = "only_asset_release_token"
        changes.append(dict(path=name, before=old_files[name], after=new_files[name], kind=kind))
    matrix = [dict(viewport=width, theme=theme, currency=currency, before_main=geometry["before"][(width, theme, currency)]["main"]["width"], after_main=geometry["after"][(width, theme, currency)]["main"]["width"])
              for width, theme, currency in sorted(expected)]
    result = dict(status="PAIRED_EVIDENCE_VERIFIED_RAW_FAILURES_RETAINED", before_raw_counts=before["counts"], after_raw_counts=after["counts"],
                  case_ids_unchanged=112, layout_rows_compared=48, exact_formatted_money_reads=96,
                  formatted_money_checks_overlap_layout_rows=True, no_product_test_totals_added=True,
                  fixture_amount_currency_time_id_metadata_unchanged=True,
                  exponent_oracle_difference="Before QA sampled API projection; after samples real DB before any UI write. Non-JPY stored exponent is 2, not omitted/null.",
                  source_changes=changes, matrix=matrix)
    options.out.mkdir(parents=True, exist_ok=False)
    (options.out / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print(json.dumps({key: result[key] for key in ("status", "before_raw_counts", "after_raw_counts", "case_ids_unchanged", "layout_rows_compared")}))


if __name__ == "__main__":
    main()
