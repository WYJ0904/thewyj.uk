#!/usr/bin/env python3
"""Independently reopen browser-produced tool artifacts and verify their meaning."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

import cv2
import numpy as np
import vobject
from PIL import Image, ImageChops, ImageStat
from pypdf import PdfReader


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_csv_path(path: Path) -> list[list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.reader(handle))


def read_csv_bytes(data: bytes) -> list[list[str]]:
    return list(csv.reader(io.StringIO(data.decode("utf-8-sig"), newline="")))


def zip_contents(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        require(archive.testzip() is None, f"{path.name}: corrupt ZIP member")
        return {name: archive.read(name) for name in archive.namelist()}


def verify_file_artifacts(entries: dict[str, dict]) -> int:
    checked = 0
    for tool_id, item in entries.items():
        output = Path(item["path"])
        sources = [Path(value) for value in item.get("sources", [])]
        require(output.is_file() and output.stat().st_size > 0, f"{tool_id}: missing download")
        if tool_id == "csv-json":
            rows = read_csv_path(sources[0])
            expected = [dict(zip(rows[0], row)) for row in rows[1:]]
            require(json.loads(output.read_text(encoding="utf-8")) == expected, "csv-json semantic mismatch")
        elif tool_id == "json-csv":
            expected = json.loads(sources[0].read_text(encoding="utf-8"))
            rows = read_csv_path(output)
            actual = [dict(zip(rows[0], row)) for row in rows[1:]]
            require(actual == [{key: str(value) for key, value in row.items()} for row in expected], "json-csv semantic mismatch")
        elif tool_id == "text-encoding":
            require(output.read_text(encoding="utf-8") == sources[0].read_text(encoding="utf-8"), "text encoding changed content")
        elif tool_id == "text-split":
            members = zip_contents(output)
            expected_lines = sources[0].read_text(encoding="utf-8").splitlines()
            require(list(members) == [f"part-{index:03d}.txt" for index in range(1, len(expected_lines) + 1)], "text split created missing or empty extra parts")
            require([data.decode("utf-8") for data in members.values()] == expected_lines, "text split content mismatch")
        elif tool_id == "csv-split":
            members = zip_contents(output)
            source_rows = read_csv_path(sources[0])
            require(len(members) == len(source_rows) - 1, "CSV split part count mismatch")
            actual_rows = [read_csv_bytes(data) for data in members.values()]
            require(all(rows[0] == source_rows[0] and len(rows) == 2 for rows in actual_rows), "CSV split header mismatch")
            require([rows[1] for rows in actual_rows] == source_rows[1:], "CSV split data mismatch")
        elif tool_id == "txt-merge":
            expected = "".join(source.read_text(encoding="utf-8") if index == 0 or source.read_text(encoding="utf-8").startswith("\n") or sources[index - 1].read_text(encoding="utf-8").endswith("\n") else "\n" + source.read_text(encoding="utf-8") for index, source in enumerate(sources))
            require(output.read_text(encoding="utf-8") == expected, "TXT merge inserted or removed content")
        elif tool_id == "csv-merge":
            expected = read_csv_path(sources[0]) + read_csv_path(sources[1])[1:]
            require(read_csv_path(output) == expected, "CSV merge semantic mismatch")
        elif tool_id == "json-array-merge":
            expected = sum((json.loads(source.read_text(encoding="utf-8")) for source in sources), [])
            require(json.loads(output.read_text(encoding="utf-8")) == expected, "JSON array merge semantic mismatch")
        elif tool_id == "images-pdf":
            reader = PdfReader(str(output))
            require(len(reader.pages) == len(sources), "images-pdf page count mismatch")
            require(all(page.images for page in reader.pages), "images-pdf page has no embedded image")
        elif tool_id in {"files-zip", "batch-zip"}:
            members = zip_contents(output)
            require(list(members) == [source.name for source in sources], f"{tool_id}: member names mismatch")
            require(all(hashlib.sha256(members[source.name]).hexdigest() == sha256(source) for source in sources), f"{tool_id}: member bytes mismatch")
        checked += 1
    return checked


def image_difference(left: Image.Image, right: Image.Image) -> float:
    left = left.convert("RGBA")
    right = right.convert("RGBA")
    require(left.size == right.size, f"image size mismatch: {left.size} != {right.size}")
    return sum(ImageStat.Stat(ImageChops.difference(left, right)).mean) / 4


def expected_transformation(source: Image.Image, key: str) -> Image.Image | None:
    if key == "image-rotate:90":
        return source.transpose(Image.Transpose.ROTATE_270)
    if key == "image-rotate:180":
        return source.transpose(Image.Transpose.ROTATE_180)
    if key == "image-rotate:270":
        return source.transpose(Image.Transpose.ROTATE_90)
    if key == "image-flip:horizontal":
        return source.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if key == "image-flip:vertical":
        return source.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    if key == "image-flip:both":
        return source.transpose(Image.Transpose.FLIP_LEFT_RIGHT).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    return None


def verify_image_artifacts(entries: dict[str, dict]) -> int:
    expected_sizes = {
        "image-resize": (40, 30),
        "image-scale": (96, 96),
        "image-crop": (96, 58),
        "crop-square": (192, 192),
        "crop-four-three": (192, 144),
        "crop-sixteen-nine": (192, 108),
        "favicon-generator": (32, 32),
        "gradient-generator": (1200, 630),
        "solid-image": (1200, 630),
    }
    checked = 0
    for key, item in entries.items():
        output = Path(item["path"])
        require(output.is_file() and output.stat().st_size > 0, f"{key}: missing image artifact")
        if key in {"image-batch-compress", "multi-icon-zip"}:
            members = zip_contents(output)
            if key == "image-batch-compress":
                require(len(members) == 2, "batch compression output count mismatch")
                require(all(Image.open(io.BytesIO(data)).format == "JPEG" for data in members.values()), "batch compression format mismatch")
            else:
                expected = {f"icon-{size}.png": (size, size) for size in (16, 32, 48, 64, 128, 192, 512)}
                require(set(members) == set(expected), "multi-icon ZIP member mismatch")
                for name, size in expected.items():
                    with Image.open(io.BytesIO(members[name])) as image:
                        require(image.size == size and image.format == "PNG", f"{name}: icon dimensions or format mismatch")
            checked += 1
            continue
        if key == "image-pdf":
            reader = PdfReader(str(output))
            require(len(reader.pages) == 2 and all(page.images for page in reader.pages), "image-pdf semantic mismatch")
            checked += 1
            continue
        if key == "exif-remove":
            with Image.open(output) as image:
                require(not image.getexif(), "EXIF removal left metadata behind")
            checked += 1
            continue

        with Image.open(output) as image_handle:
            image_handle.load()
            image = image_handle.copy()
            output_format = image_handle.format
        source = Image.open(item["source"]).convert("RGBA") if item.get("source") else None
        if key in expected_sizes:
            require(image.size == expected_sizes[key], f"{key}: expected {expected_sizes[key]}, got {image.size}")
        if key in {"image-compress", "image-format", "image-format:image/jpeg"}:
            require(output_format == "JPEG", f"{key}: expected JPEG, got {output_format}")
        if key == "image-format:image/png":
            require(output_format == "PNG", f"{key}: expected PNG, got {output_format}")
        if key == "image-format:image/webp":
            require(output_format == "WEBP", f"{key}: expected WEBP, got {output_format}")
        transformed = expected_transformation(source, key) if source else None
        if transformed is not None:
            require(image_difference(image, transformed) < 1.5, f"{key}: pixels do not match requested transform")
        if key in {"image-rounded", "image-avatar"}:
            require(image.convert("RGBA").getpixel((0, 0))[3] == 0, f"{key}: corner is not transparent")
            require(image.convert("RGBA").getpixel((image.width // 2, image.height // 2))[3] > 0, f"{key}: center became transparent")
        if key == "image-redact":
            redacted = image.convert("RGB")
            require(redacted.getpixel((image.width // 2, image.height // 2)) == (0, 0, 0), "redaction region is not black")
        if key == "solid-image":
            require(image.convert("RGB").getpixel((image.width // 2, image.height // 2)) == (36, 109, 168), "solid image color mismatch")
        if key == "gradient-generator":
            rgb = image.convert("RGB")
            require(rgb.getpixel((0, 0)) != rgb.getpixel((image.width - 1, image.height - 1)), "gradient output is a flat color")
        if key in {"text-watermark", "image-watermark", "tile-watermark", "image-mosaic", "image-blur"} and source:
            require(image_difference(image, source) > 0.05, f"{key}: requested visual effect changed no pixels")
        checked += 1
    return checked


def decode_qr(path: Path) -> str:
    image = np.array(Image.open(path).convert("RGB"))
    value, points, _straight = cv2.QRCodeDetector().detectAndDecode(cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
    require(points is not None and value, f"{path.name}: independent QR decoder found no payload")
    return value


def verify_qr_artifacts(entries: list[dict]) -> int:
    labels = set()
    for item in entries:
        labels.add(item["label"])
        decoded = decode_qr(Path(item["path"]))
        require(decoded == item["expected_payload"], f"{item['label']}: decoded QR payload mismatch")
        if item["kind"] == "contact":
            card = vobject.readOne(decoded)
            require(card.fn.value == "王小明", "contact QR name is not parseable")
            require(card.n.value.family == "王" and card.n.value.given == "小明", "contact QR structured name mismatch")
            require(card.tel.value == "+86 13800000000", "contact QR phone mismatch")
            require(card.email.value == "wyj@example.com", "contact QR email mismatch")
            require(card.org.value[0] == "WYJ Lab", "contact QR organization mismatch")
            require(card.url.value == "https://thewyj.uk/contact", "contact QR URL mismatch")
    require(
        labels == {"text", "url", "wifi-wpa", "wifi-hidden", "wifi-wep", "wifi-open", "contact", "dynamic"},
        "QR mode artifacts are incomplete",
    )
    return len(entries)


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_tool_artifacts.py <manifest.json>")
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    require(manifest.get("schema_version") == 1, "artifact manifest schema mismatch")
    file_count = verify_file_artifacts(manifest.get("files", {}))
    image_count = verify_image_artifacts(manifest.get("images", {}))
    qr_count = verify_qr_artifacts(manifest.get("qrs", []))
    temporary_count = 0
    for item in manifest.get("temporary_files", []):
        require(sha256(Path(item["original"])) == sha256(Path(item["downloaded"])), "temporary share SHA-256 mismatch")
        temporary_count += 1
    require(temporary_count == 1, "temporary file round-trip artifact is missing")
    print(json.dumps({
        "file_artifacts": file_count,
        "image_artifacts": image_count,
        "qr_artifacts": qr_count,
        "temporary_file_round_trips": temporary_count,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, OSError, ValueError, zipfile.BadZipFile) as error:
        print(f"Artifact verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
