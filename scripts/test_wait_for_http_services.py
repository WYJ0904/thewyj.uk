from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from scripts.wait_for_http_services import ServiceSpec, ServiceWaitError, wait_for_services


class ServiceReadinessTests(unittest.TestCase):
    def test_longer_bounded_wait_survives_delayed_cold_start(self) -> None:
        ready_after = time.monotonic() + 0.30
        service = ServiceSpec("chrome", "http://127.0.0.1:9223/json/version")

        def delayed_probe(_url: str, _timeout: float) -> None:
            if time.monotonic() < ready_after:
                raise OSError("connection refused during cold start")

        with self.assertRaises(ServiceWaitError):
            wait_for_services(
                [service],
                timeout=0.10,
                interval=0.02,
                request_timeout=0.05,
                probe=delayed_probe,
            )

        ready = wait_for_services(
            [service],
            timeout=1.0,
            interval=0.02,
            request_timeout=0.05,
            probe=delayed_probe,
        )
        self.assertIn("chrome", ready)

    def test_exited_process_reports_its_log_tail(self) -> None:
        with tempfile.TemporaryDirectory() as raw_directory:
            directory = Path(raw_directory)
            pid_file = directory / "chrome.pid"
            log_file = directory / "chrome.log"
            pid_file.write_text("99999999", encoding="utf-8")
            log_file.write_text("first line\nchrome startup failed\n", encoding="utf-8")
            service = ServiceSpec(
                "chrome",
                "http://127.0.0.1:9223/json/version",
                pid_file,
                log_file,
            )

            with self.assertRaises(ServiceWaitError) as raised:
                wait_for_services([service], timeout=1.0)

        message = str(raised.exception)
        self.assertIn("exited before readiness", message)
        self.assertIn("chrome startup failed", message)


if __name__ == "__main__":
    unittest.main()
