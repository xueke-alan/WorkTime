import contextlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from urllib.error import HTTPError, URLError

spec = importlib.util.spec_from_file_location("fetch_weather", Path(__file__).resolve().parents[1] / "scripts/fetch_weather.py")
weather = importlib.util.module_from_spec(spec)
spec.loader.exec_module(weather)


def result(district="310101"):
    return {"location": {"id": district}, "now": {"temp": 23, "uptime": "20261003121500", "text": "多云"},
            "forecasts": [{"date": "2026-10-03", "high": 25, "low": 18, "text_day": "多云"}]}


def response(payload):
    return io.BytesIO(json.dumps(payload).encode())


class CollectorTests(unittest.TestCase):
    def snapshot(self, updated):
        return {"schemaVersion": 1, "updatedAt": updated, "cities": {
            key: {"name": name, "districtId": district, "result": result(district)}
            for key, name, district in weather.CITIES
        }}

    def test_freshness_rolling_hour_boundaries_and_timezones(self):
        now = datetime(2026, 10, 8, 8, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "weather.json"
            for age, expected in [(0, True), (3599, True), (3600, False), (3601, False), (-1, False)]:
                with self.subTest(age=age):
                    updated = (now - timedelta(seconds=age)).isoformat()
                    output.write_text(json.dumps(self.snapshot(updated)))
                    self.assertEqual(weather.has_recent_snapshot(output, now), expected)
            output.write_text(json.dumps(self.snapshot("2026-10-08T15:59:59+08:00")))
            self.assertTrue(weather.has_recent_snapshot(output, now))

    def test_invalid_or_incomplete_snapshot_does_not_suppress_collection(self):
        now = datetime(2026, 10, 8, 8, 0, tzinfo=timezone.utc)
        valid = self.snapshot("2026-10-08T07:59:00Z")
        incomplete = self.snapshot(valid["updatedAt"])
        incomplete["cities"].pop(weather.CITIES[0][0])
        invalid_city = self.snapshot(valid["updatedAt"])
        invalid_city["cities"][weather.CITIES[0][0]]["result"]["now"]["temp"] = 999999
        wrong_district = self.snapshot(valid["updatedAt"])
        wrong_district["cities"][weather.CITIES[0][0]]["districtId"] = "invalid"
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "weather.json"
            self.assertFalse(weather.has_recent_snapshot(output, now))
            for snapshot in [None, {}, {**valid, "schemaVersion": 2},
                             {**valid, "updatedAt": "bad-date"},
                             {**valid, "updatedAt": "2026-10-08T07:59:00"},
                             {**valid, "updatedAt": None}, incomplete, invalid_city, wrong_district]:
                with self.subTest(snapshot=snapshot):
                    output.write_text(json.dumps(snapshot))
                    self.assertFalse(weather.has_recent_snapshot(output, now))
            output.write_text("bad-json")
            self.assertFalse(weather.has_recent_snapshot(output, now))

    def test_recent_snapshot_skips_requests_and_commit_without_key(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "weather.json"
            output.write_text(json.dumps(self.snapshot(datetime.now(timezone.utc).isoformat())))
            before = output.read_bytes()
            action_output, summary = Path(folder) / "outputs", Path(folder) / "summary"
            with patch.object(weather, "OUTPUT", output), patch.dict(os.environ, {
                "BAIDU_MAP_AK": "", "GITHUB_OUTPUT": str(action_output), "GITHUB_STEP_SUMMARY": str(summary)
            }, clear=True), patch.object(weather, "collect") as collect, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(weather.main(), 0)
                collect.assert_not_called()
            self.assertEqual(output.read_bytes(), before)
            self.assertEqual(action_output.read_text(), "changed=false\n")
            self.assertIn("跳过本次采集", summary.read_text(encoding="utf-8"))

    def test_stale_snapshot_collects_and_reports_changes(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "weather.json"
            old = self.snapshot("2026-01-01T00:00:00Z")
            output.write_text(json.dumps(old))
            updated = self.snapshot(datetime.now(timezone.utc).isoformat())
            updated["cities"][weather.CITIES[0][0]]["result"]["now"]["temp"] = 24
            action_output = Path(folder) / "outputs"
            with patch.object(weather, "OUTPUT", output), patch.dict(os.environ, {
                "BAIDU_MAP_AK": "secret", "GITHUB_OUTPUT": str(action_output)
            }, clear=True), patch.object(weather, "collect", return_value=updated) as collect, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(weather.main(), 0)
                collect.assert_called_once_with("secret")
            self.assertEqual(json.loads(output.read_text(encoding="utf-8")), updated)
            self.assertEqual(action_output.read_text(), "changed=true\n")

    def test_ten_cities_and_snapshot(self):
        with patch.object(weather, "fetch_city", side_effect=lambda ak, district: result(district)):
            snapshot = weather.collect("secret")
        self.assertEqual(len(snapshot["cities"]), 10)
        self.assertEqual(snapshot["cities"]["dongguan"]["districtId"], "441900")
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "data/weather.json"
            self.assertTrue(weather.write_snapshot(snapshot, output))
            before = output.read_bytes()
            snapshot["updatedAt"] = "2026-10-03T05:17:00Z"
            self.assertFalse(weather.write_snapshot(snapshot, output))
            self.assertEqual(output.read_bytes(), before)
            self.assertEqual(list(output.parent.iterdir()), [output])

    def test_success_url_and_timeout(self):
        with patch.object(weather, "urlopen", return_value=response({"status": 0, "result": result()})) as call:
            self.assertEqual(weather.fetch_city("secret", "310101"), result())
        self.assertIn("data_type=all", call.call_args.args[0].full_url)
        self.assertEqual(call.call_args.kwargs["timeout"], 30)

    def test_network_retries_and_redaction(self):
        with patch.object(weather, "urlopen", side_effect=URLError("secret")) as call, patch.object(weather.time, "sleep"):
            with self.assertRaises(weather.WeatherError) as error:
                weather.fetch_city("secret", "310101")
        self.assertEqual(call.call_count, 3)
        self.assertNotIn("secret", str(error.exception))

    def test_temporary_service_recovery(self):
        with patch.object(weather, "urlopen", side_effect=[response({"status": 503}), response({"status": 0, "result": result()})]) as call, patch.object(weather.time, "sleep"):
            weather.fetch_city("secret", "310101")
        self.assertEqual(call.call_count, 2)

    def test_http_and_business_auth_fail_fast(self):
        for value in [HTTPError("secret-url", 403, "secret", {}, None), response({"status": 211, "message": "secret"})]:
            with self.subTest(value=type(value).__name__):
                options = {"side_effect": value} if isinstance(value, Exception) else {"return_value": value}
                with patch.object(weather, "urlopen", **options) as call:
                    with self.assertRaises(weather.WeatherError) as error:
                        weather.fetch_city("secret", "310101")
                self.assertEqual(call.call_count, 1)
                self.assertNotIn("secret", str(error.exception))

    def test_invalid_json_and_weather(self):
        with patch.object(weather, "urlopen", return_value=io.BytesIO(b"bad-json")):
            with self.assertRaises(weather.WeatherError):
                weather.fetch_city("secret", "310101")
        for invalid in [None, {}, result("110101")]:
            with self.assertRaises(weather.WeatherError):
                weather.validate_result(invalid, "310101")
        for value in [999999, float("nan"), float("inf"), True]:
            invalid = result()
            invalid["now"]["temp"] = value
            with self.assertRaises(weather.WeatherError):
                weather.validate_result(invalid, "310101")

    def test_missing_key_and_partial_failure_preserve_output(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "weather.json"
            for exists in [False, True]:
                if exists:
                    output.write_text("old-snapshot")
                with patch.object(weather, "OUTPUT", output), patch.dict(os.environ, {"BAIDU_MAP_AK": ""}), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(weather.main(), 1)
                with patch.object(weather, "OUTPUT", output), patch.dict(os.environ, {"BAIDU_MAP_AK": "secret"}), patch.object(weather, "fetch_city", side_effect=[result(), weather.WeatherError("offline")]), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(weather.main(), 1)
                self.assertEqual(output.exists(), exists)
                if exists:
                    self.assertEqual(output.read_text(), "old-snapshot")

    def test_replace_failure_preserves_old_file(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "weather.json"
            output.write_text("old-snapshot")
            with patch.object(weather.os, "replace", side_effect=OSError("disk")):
                with self.assertRaises(OSError):
                    weather.write_snapshot({"cities": {}}, output)
            self.assertEqual(output.read_text(), "old-snapshot")
            self.assertEqual(list(output.parent.iterdir()), [output])


if __name__ == "__main__":
    unittest.main()
