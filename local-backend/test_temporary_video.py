import unittest

from account_store import AccountError
from temporary_store import LEGACY_MAX_TEMP_FILE_BYTES, MAX_TEMP_FILE_BYTES, TemporaryStore


class SizedContent:
    def __init__(self, size):
        self.size = size

    def __len__(self):
        return self.size


class TemporaryVideoValidationTests(unittest.TestCase):
    def test_size_limits(self):
        self.assertEqual(MAX_TEMP_FILE_BYTES, 30 * 1024 * 1024)
        self.assertEqual(LEGACY_MAX_TEMP_FILE_BYTES, 20 * 1024 * 1024)

    def test_supported_video_signatures(self):
        iso_bmff = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"
        webm = b"\x1aE\xdf\xa3\x9fB\x86\x81\x01"
        cases = [
            ("sample.mp4", "video/mp4", iso_bmff),
            ("sample.m4v", "video/x-m4v", iso_bmff),
            ("sample.mov", "video/quicktime", iso_bmff),
            ("sample.webm", "video/webm", webm),
        ]
        for name, mime, payload in cases:
            with self.subTest(name=name):
                self.assertEqual(TemporaryStore.validate_file(name, mime, payload), (name, mime))

    def test_existing_file_types_keep_twenty_megabyte_limit(self):
        with self.assertRaises(AccountError) as raised:
            TemporaryStore.validate_file("too-large.txt", "text/plain", SizedContent(LEGACY_MAX_TEMP_FILE_BYTES + 1))
        self.assertEqual(raised.exception.code, "file_too_large")

    def test_video_uses_thirty_megabyte_limit(self):
        with self.assertRaises(AccountError) as raised:
            TemporaryStore.validate_file("too-large.mp4", "video/mp4", SizedContent(MAX_TEMP_FILE_BYTES + 1))
        self.assertEqual(raised.exception.code, "file_too_large")

    def test_wrong_mime_is_rejected(self):
        payload = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"
        with self.assertRaises(AccountError) as raised:
            TemporaryStore.validate_file("sample.mp4", "image/png", payload)
        self.assertEqual(raised.exception.code, "file_type_invalid")

    def test_wrong_signature_is_rejected(self):
        with self.assertRaises(AccountError) as raised:
            TemporaryStore.validate_file("sample.webm", "video/webm", b"not-webm")
        self.assertEqual(raised.exception.code, "file_signature_invalid")


if __name__ == "__main__":
    unittest.main()
