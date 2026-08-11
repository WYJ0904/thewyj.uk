#!/usr/bin/env python3
"""Keep the user-facing catalog, QA matrix, and browser coverage in lockstep."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MATRIX_PATH = ROOT / "qa" / "functional-audit.json"


def fail(message: str) -> None:
    raise AssertionError(message)


def tool_catalog_from_source(source: str) -> dict[str, list[str]]:
    start = source.find("const toolRows = {")
    end = source.find("const TOOLS =", start)
    if start < 0 or end < 0:
        fail("tools.js toolRows catalog could not be located")
    catalog: dict[str, list[str]] = {}
    category = ""
    category_pattern = re.compile(r'^\s{4}(text|file|image|random|temporary):\s*\[$')
    tool_pattern = re.compile(r'^\s{6}\["([a-z0-9-]+)"\s*,')
    for line in source[start:end].splitlines():
        category_match = category_pattern.match(line)
        if category_match:
            category = category_match.group(1)
            catalog[category] = []
            continue
        tool_match = tool_pattern.match(line)
        if tool_match and category:
            catalog[category].append(tool_match.group(1))
    return catalog


def flatten_modes(groups: dict[str, list[str]]) -> set[str]:
    return {
        f"{group}.{value}"
        for group, values in groups.items()
        for value in values
    }


def checkbox_controls_from_source(source: str) -> set[str]:
    return set(
        re.findall(r'<input[^>]*id="([^"]+)"[^>]*type="checkbox"', source)
        + re.findall(r'<input[^>]*type="checkbox"[^>]*id="([^"]+)"', source)
    )


def main() -> int:
    matrix = json.loads(MATRIX_PATH.read_text(encoding="utf-8"))
    tools_source = (ROOT / "tools.js").read_text(encoding="utf-8")
    app_source = (ROOT / "app.js").read_text(encoding="utf-8")
    html_source = (ROOT / "index.html").read_text(encoding="utf-8")
    app_test_source = (ROOT / "local-backend" / "test_app_browser.mjs").read_text(encoding="utf-8")
    tool_test_source = (ROOT / "local-backend" / "test_tools_browser.mjs").read_text(encoding="utf-8")

    actual_catalog = tool_catalog_from_source(tools_source)
    expected_catalog = matrix.get("tool_catalog", {})
    if actual_catalog != expected_catalog:
        fail(
            "tool catalog differs from qa/functional-audit.json\n"
            f"source={json.dumps(actual_catalog, ensure_ascii=False, sort_keys=True)}\n"
            f"matrix={json.dumps(expected_catalog, ensure_ascii=False, sort_keys=True)}"
        )
    all_ids = [tool_id for ids in actual_catalog.values() for tool_id in ids]
    if len(all_ids) != 103 or len(set(all_ids)) != 103:
        fail(f"expected 103 unique tools, found {len(all_ids)} entries / {len(set(all_ids))} unique")

    actual_flows = re.findall(r'await check\("([^"]+)"', app_test_source)
    expected_flows = matrix.get("browser_flows", [])
    if actual_flows != expected_flows:
        fail("application browser flow list differs from the QA matrix")

    expected_tool_modes = flatten_modes(matrix.get("tool_modes", {}))
    declared_tool_modes = set(re.findall(r'coverMode\("([^"]+)"\)', tool_test_source))
    if declared_tool_modes != expected_tool_modes:
        missing = sorted(expected_tool_modes - declared_tool_modes)
        extra = sorted(declared_tool_modes - expected_tool_modes)
        fail(f"tool mode coverage differs; missing={missing}, extra={extra}")

    expected_checkbox_controls = set(matrix.get("tool_checkbox_controls", []))
    actual_checkbox_controls = checkbox_controls_from_source(tools_source)
    if actual_checkbox_controls != expected_checkbox_controls:
        missing = sorted(actual_checkbox_controls - expected_checkbox_controls)
        stale = sorted(expected_checkbox_controls - actual_checkbox_controls)
        fail(f"tool checkbox coverage differs; missing={missing}, stale={stale}")
    for control_id in expected_checkbox_controls:
        if f'"#{control_id}"' not in tool_test_source:
            fail(f"tool checkbox #{control_id} is not exercised by the browser matrix")

    direct_options = {
        value for value in re.findall(r'<option value="([^"]+)"', tools_source)
        if value != "${value}"
    }
    option_block_match = re.search(r"const options = \{(.+?)\n\s*\};\n\s*const optionHtml", tools_source, re.S)
    generated_options = set(re.findall(r'\[\[?"([^"]+)"\s*,', option_block_match.group(1))) if option_block_match else set()
    represented_option_values = {value for values in matrix.get("tool_modes", {}).values() for value in values}
    unrepresented_options = sorted((direct_options | generated_options) - represented_option_values)
    if unrepresented_options:
        fail(f"tool select options absent from the QA mode matrix: {unrepresented_options}")

    route_source = app_source + "\n" + tools_source
    for route in matrix.get("routes", []):
        path = route["path"]
        anchor = path.split("/:", 1)[0]
        static_segments = [segment for segment in path.split("/") if segment and not segment.startswith(":")]
        represented = (
            anchor in route_source
            or f'href="{anchor}"' in html_source
            or all(segment in route_source for segment in static_segments)
        )
        if not represented:
            fail(f"route {path} is absent from application routing")

    mode_source = app_source + "\n" + html_source + "\n" + tools_source
    for group, values in matrix.get("application_modes", {}).items():
        for value in values:
            if value not in mode_source:
                fail(f"application mode {group}.{value} is absent from source")

    markdown = (ROOT / "qa" / "FULL_FUNCTIONAL_AUDIT.md").read_text(encoding="utf-8")
    for tool_id in all_ids:
        if f"`{tool_id}`" not in markdown:
            fail(f"{tool_id} is absent from FULL_FUNCTIONAL_AUDIT.md")

    print(
        "Functional audit gate passed: "
        f"{len(matrix['routes'])} routes, {len(actual_flows)} app flows, "
        f"{len(all_ids)} tools, {len(expected_tool_modes)} tool modes, "
        f"{len(expected_checkbox_controls)} checkbox controls."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, KeyError, ValueError) as error:
        print(f"Functional audit gate failed: {error}", file=sys.stderr)
        raise SystemExit(1)
