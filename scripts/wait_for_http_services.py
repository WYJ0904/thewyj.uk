from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable


@dataclass(frozen=True)
class ServiceSpec:
    name: str
    url: str
    pid_file: Path | None = None
    log_file: Path | None = None


class ServiceWaitError(RuntimeError):
    pass


def _process_is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _read_pid(path: Path) -> int:
    return int(path.read_text(encoding="utf-8").strip())


def _probe_json(url: str, timeout: float) -> None:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "WYJ-CI-readiness-probe"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status}")
        body = response.read(1_000_001)
        if not body or len(body) > 1_000_000:
            raise RuntimeError("empty or oversized response")
        payload = json.loads(body.decode("utf-8"))
        if not payload:
            raise RuntimeError("empty JSON payload")


def _log_tail(path: Path | None, limit: int = 80) -> str:
    if path is None:
        return ""
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as exc:
        return f"\n--- unable to read {path}: {exc} ---"
    tail = "\n".join(lines[-limit:]) or "(log is empty)"
    return f"\n--- {path} (last {limit} lines) ---\n{tail}"


def wait_for_services(
    services: Iterable[ServiceSpec],
    *,
    timeout: float,
    interval: float = 0.25,
    request_timeout: float = 1.0,
    probe: Callable[[str, float], None] = _probe_json,
) -> dict[str, float]:
    pending = {service.name: service for service in services}
    if not pending:
        raise ValueError("at least one service is required")
    if timeout <= 0 or interval <= 0 or request_timeout <= 0:
        raise ValueError("timeouts and intervals must be positive")

    started = time.monotonic()
    deadline = started + timeout
    last_errors: dict[str, str] = {}
    ready_at: dict[str, float] = {}
    print(
        "Waiting up to "
        f"{timeout:.1f}s for: {', '.join(sorted(pending))}",
        flush=True,
    )

    while pending:
        for name, service in tuple(pending.items()):
            if service.pid_file is not None:
                try:
                    pid = _read_pid(service.pid_file)
                except (OSError, ValueError) as exc:
                    raise ServiceWaitError(
                        f"{name} PID file is invalid: {exc}{_log_tail(service.log_file)}"
                    ) from exc
                if not _process_is_running(pid):
                    raise ServiceWaitError(
                        f"{name} process {pid} exited before readiness"
                        f"{_log_tail(service.log_file)}"
                    )

            try:
                probe(service.url, request_timeout)
            except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
                last_errors[name] = f"{type(exc).__name__}: {exc}"
                continue

            elapsed = time.monotonic() - started
            ready_at[name] = elapsed
            pending.pop(name)
            print(f"Ready: {name} after {elapsed:.2f}s", flush=True)

        if not pending:
            return ready_at
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(interval, remaining))

    details = []
    for name, service in pending.items():
        details.append(
            f"{name}: {last_errors.get(name, 'no successful response')}"
            f"{_log_tail(service.log_file)}"
        )
    elapsed = time.monotonic() - started
    raise ServiceWaitError(
        f"Services did not become ready within {elapsed:.2f}s:\n" + "\n".join(details)
    )


def _parse_named_values(values: list[str], label: str) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for raw in values:
        name, separator, value = raw.partition("=")
        name = name.strip()
        value = value.strip()
        if not separator or not name or not value:
            raise ValueError(f"invalid {label}: {raw!r}; expected NAME=VALUE")
        if name in parsed:
            raise ValueError(f"duplicate {label} name: {name}")
        parsed[name] = value
    return parsed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Wait for isolated CI HTTP services.")
    parser.add_argument("--service", action="append", default=[], metavar="NAME=URL")
    parser.add_argument("--pid-file", action="append", default=[], metavar="NAME=PATH")
    parser.add_argument("--log-file", action="append", default=[], metavar="NAME=PATH")
    parser.add_argument("--timeout", type=float, default=90.0)
    parser.add_argument("--interval", type=float, default=0.25)
    parser.add_argument("--request-timeout", type=float, default=1.0)
    args = parser.parse_args(argv)

    try:
        urls = _parse_named_values(args.service, "service")
        pid_files = _parse_named_values(args.pid_file, "PID file")
        log_files = _parse_named_values(args.log_file, "log file")
        unknown = (set(pid_files) | set(log_files)) - set(urls)
        if unknown:
            raise ValueError(
                "PID/log mapping references unknown services: " + ", ".join(sorted(unknown))
            )
        services = [
            ServiceSpec(
                name=name,
                url=url,
                pid_file=Path(pid_files[name]) if name in pid_files else None,
                log_file=Path(log_files[name]) if name in log_files else None,
            )
            for name, url in urls.items()
        ]
        wait_for_services(
            services,
            timeout=args.timeout,
            interval=args.interval,
            request_timeout=args.request_timeout,
        )
    except (ServiceWaitError, ValueError) as exc:
        print(f"Readiness check failed: {exc}", file=sys.stderr)
        return 1

    print("All isolated services are ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
