"""Independent synthetic Python model/normalization review; no account DB opened."""
import copy
import importlib.util
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "local-backend"))
OUT = ROOT / (sys.argv[1] if len(sys.argv) > 1 else "docs/migration-evidence/p07-closeout/b1-python-review.json")
work = ROOT / ".wrangler/b1-python-review"
work.mkdir(parents=True, exist_ok=True)
at = "2026-11-08T08:00:00Z"
base = dict(data_type="wrong_book", record_id="wrong:network", payload_json=json.dumps({"wrong_count": 1, "correct_answer": "", "rubric": {"gloss": ""}}), updated_at=at, deleted=0, client_id="same-client", client_version="old-web", server_version=13, created_at=at, server_updated_at=at)
change = dict(data_type="wrong_book", record_id="wrong:network", payload={"wrong_count": 1, "correct_answer": "网络", "rubric": {"gloss": "网络"}}, updated_at=at, deleted=False, client_id="same-client", client_version="old-web", base_server_version=13)
versions = [("rc6", "e4844a5304709263a2810332eca5d2a87b069d3d"), ("raw-pr136", "f4ce8c7e7abc12b80895a570068fa7aa2f7a2a17"), ("reviewed", None)]
proof = {"kind": "pure Python AccountStore methods and actual request normalization; synthetic only", "production_operations": 0, "versions": []}
for name, ref in versions:
    source = subprocess.check_output(["git", "show", ref + ":local-backend/account_store.py"], cwd=ROOT) if ref else (ROOT / "local-backend/account_store.py").read_bytes()
    filename = work / (name + ".py")
    filename.write_bytes(source)
    spec = importlib.util.spec_from_file_location("b1_" + name.replace("-", "_"), filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    cls = module.AccountStore
    cases = [
        ("acknowledged equal-time meaning update", base, change, lambda r: r[0]["payload"].get("correct_answer") == "网络"),
        ("newer own offline deletion", base, {**change, "deleted": True, "payload": {}, "updated_at": "2026-11-08T08:00:01Z", "base_server_version": 11}, lambda r: r[0]["deleted"] is True),
        ("stale own live replay cannot resurrect tombstone", {**base, "deleted": 1, "payload_json": "{}"}, {**change, "base_server_version": 11}, lambda r: r[0]["deleted"] is True and not r[1]),
        ("equal-time acknowledged replay cannot resurrect tombstone", {**base, "deleted": 1, "payload_json": "{}"}, change, lambda r: r[0]["deleted"] is True and not r[1]),
        ("ambiguous same-time own delete stays pending", base, {**change, "deleted": True, "payload": {}, "base_server_version": 11}, lambda r: False),
        ("stale other-device delete rejected", base, {**change, "deleted": True, "payload": {}, "base_server_version": 11, "client_id": "other-device", "updated_at": "2026-11-08T08:00:01Z"}, lambda r: r[0]["deleted"] is False and not r[1]),
        ("new empty payload retains saved meaning", {**base, "payload_json": json.dumps(change["payload"])}, {**change, "payload": {"correct_answer": "", "rubric": {"gloss": ""}}, "updated_at": "2026-11-08T08:00:01Z"}, lambda r: r[0]["payload"].get("correct_answer") == "网络"),
        ("exact duplicate is idempotent", {**base, "payload_json": json.dumps(change["payload"])}, change, lambda r: not r[1]),
    ]
    results = []
    for label, existing, incoming, check in cases:
        try:
            result = cls._merge_learning_sync_record(copy.deepcopy(existing), copy.deepcopy(incoming))
            passed = check(result)
            results.append({"name": label, "pass": passed})
        except module.AccountError as error:
            results.append({"name": label, "pass": label == "ambiguous same-time own delete stays pending" and error.code == "learning_sync_refresh_required", "code": error.code})
    normalized = cls._validated_learning_sync_request({"schema_version": 1, "client_id": "same-client", "client_version": "compatibility", "since_version": 0, "changes": [{k: v for k, v in {**change, "updated_at": "2026-11-08T08:00:00.123Z"}.items() if k not in ("client_id", "client_version")}]})
    results.append({"name": "millisecond normalization preserved", "pass": normalized["changes"][0]["updated_at"] == "2026-11-08T08:00:00.123Z"})
    proof["versions"].append({"name": name, "ref": ref or "WORKTREE", "results": results})
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps([{ "name": v["name"], "pass": sum(r["pass"] for r in v["results"]), "total": len(v["results"])} for v in proof["versions"]]))
if not all(r["pass"] for r in proof["versions"][-1]["results"]):
    sys.exit(1)
