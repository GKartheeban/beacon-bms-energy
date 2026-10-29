"""Tests for mapping.py. Run:  python -m unittest test_mapping"""
import unittest
from datetime import datetime, timezone, timedelta

from mapping import dev_eui_from_topic, parse_payload, to_number, to_readings

NOW = datetime(2026, 10, 17, 9, 30, tzinfo=timezone.utc)
POINTS = {"temperature": (1, -40, 85), "humidity": (2, 0, 100),
          "occupancy": (3, 0, 1), "battery": (4, 0, 100)}


class TopicTests(unittest.TestCase):
    def test_uplink_topic(self):
        self.assertEqual(dev_eui_from_topic("24e12479105d08ff/uplink"), "24e12479105d08ff")
        self.assertEqual(dev_eui_from_topic("24E12479105D08FF/uplink"), "24e12479105d08ff")

    def test_other_topics_ignored(self):
        self.assertIsNone(dev_eui_from_topic("lorawan/downlink/24e12479105d08ff"))
        self.assertIsNone(dev_eui_from_topic("jeedom/status"))
        self.assertIsNone(dev_eui_from_topic("nothex1234567890/uplink"))


class ValueTests(unittest.TestCase):
    def test_numbers_and_text(self):
        self.assertEqual(to_number(22.4), 22.4)
        self.assertEqual(to_number("22,4"), 22.4)
        self.assertEqual(to_number("occupied"), 1.0)
        self.assertEqual(to_number("vacant"), 0.0)
        self.assertEqual(to_number(True), 1.0)
        self.assertIsNone(to_number("unknown"))
        self.assertIsNone(to_number(None))
        self.assertIsNone(to_number(float("nan")))

    def test_bad_json(self):
        self.assertIsNone(parse_payload(b"not json"))
        self.assertIsNone(parse_payload(b"[1,2]"))
        self.assertEqual(parse_payload(b'{"a":1}'), {"a": 1})


class ReadingTests(unittest.TestCase):
    def test_ws203_message(self):
        msg = {"battery": 98, "temperature": 21.7, "humidity": 48.5, "occupancy": "occupied"}
        readings, unmapped = to_readings(msg, POINTS, NOW)
        self.assertEqual(unmapped, [])
        self.assertEqual(sorted((r[0], r[2], r[3]) for r in readings),
                         [(1, 21.7, 0), (2, 48.5, 0), (3, 1.0, 0), (4, 98.0, 0)])
        self.assertTrue(all(r[1] == NOW for r in readings))

    def test_nested_and_extra_fields(self):
        msg = {"devEUI": "24e12479105d08ff", "time": "2026-10-17T09:15:00Z",
               "object": {"temperature": 19.0, "temperature_alarm": "normal"}}
        readings, unmapped = to_readings(msg, POINTS, NOW)
        self.assertEqual([(r[0], r[2]) for r in readings], [(1, 19.0)])
        self.assertEqual(readings[0][1], NOW - timedelta(minutes=15))
        self.assertIn("temperature_alarm", unmapped)
        self.assertIn("devEUI", unmapped)

    def test_out_of_range_is_suspect(self):
        readings, _ = to_readings({"temperature": 150}, POINTS, NOW)
        self.assertEqual(readings[0][3], 2)

    def test_wrong_clock_uses_arrival_time(self):
        readings, _ = to_readings({"time": "2019-01-01T00:00:00Z", "humidity": 50}, POINTS, NOW)
        self.assertEqual(readings[0][1], NOW)


if __name__ == "__main__":
    unittest.main()
