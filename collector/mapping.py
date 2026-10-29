"""
mapping.py - turns one MQTT message from the site into BEACON readings.

No network or database code here, so it can be tested on its own
(python -m unittest test_mapping).
"""
import json
import math
from datetime import datetime, timezone

# Text values some decoders send instead of numbers
TEXT_VALUES = {
    "occupied": 1, "vacant": 0, "unoccupied": 0,
    "on": 1, "off": 0, "open": 1, "close": 0, "closed": 0,
    "true": 1, "false": 0, "yes": 1, "no": 0,
}

# Field names that may carry the time the sensor measured the value
TIME_KEYS = ("time", "timestamp", "ts", "received_at", "receivedAt")


def dev_eui_from_topic(topic):
    """'24e12479105d08ff/uplink' -> '24e12479105d08ff' (lowercase), else None."""
    parts = topic.strip("/").split("/")
    if len(parts) >= 2 and parts[-1] == "uplink":
        dev = parts[-2].lower()
        if len(dev) == 16 and all(c in "0123456789abcdef" for c in dev):
            return dev
    return None


def parse_payload(raw):
    """Bytes or text -> dict. Returns None if it is not a JSON object."""
    try:
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode("utf-8")
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def sensor_fields(payload):
    """The decoded sensor values. Some gateways nest them under 'data' or 'object'."""
    for key in ("object", "data", "decoded"):
        inner = payload.get(key)
        if isinstance(inner, dict):
            merged = dict(payload)
            merged.pop(key)
            merged.update(inner)
            return merged
    return payload


def to_number(value):
    """Sensor value -> float, or None if it cannot be read as a number."""
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if isinstance(value, str):
        text = value.strip().lower()
        if text in TEXT_VALUES:
            return float(TEXT_VALUES[text])
        try:
            number = float(text.replace(",", "."))
            return number if math.isfinite(number) else None
        except ValueError:
            return None
    return None


def reading_time(payload, received_at):
    """Use the time in the message if there is a valid one, else the time it arrived."""
    for key in TIME_KEYS:
        value = payload.get(key)
        if isinstance(value, str):
            try:
                t = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
                # ignore clearly wrong clocks (more than 1 day off)
                if abs((t - received_at).total_seconds()) < 86400:
                    return t
            except ValueError:
                pass
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            seconds = value / 1000 if value > 1e11 else value   # milliseconds or seconds
            try:
                t = datetime.fromtimestamp(seconds, tz=timezone.utc)
                if abs((t - received_at).total_seconds()) < 86400:
                    return t
            except (OverflowError, OSError, ValueError):
                pass
    return received_at


def quality_of(value, valid_min, valid_max):
    """0 = good, 2 = suspect (outside the plausible range)."""
    if valid_min is not None and value < valid_min:
        return 2
    if valid_max is not None and value > valid_max:
        return 2
    return 0


def to_readings(payload, points, received_at):
    """
    payload : dict from the message
    points  : {payload_key: (point_id, valid_min, valid_max)} for this device
    returns (readings, unmapped_keys)
        readings = [(point_id, ts, value, quality), ...]
    """
    fields = sensor_fields(payload)
    ts = reading_time(fields, received_at)
    readings, unmapped = [], []
    for key, raw_value in fields.items():
        if key in TIME_KEYS:
            continue
        point = points.get(key)
        if point is None:
            unmapped.append(key)
            continue
        value = to_number(raw_value)
        if value is None:
            continue
        point_id, vmin, vmax = point
        readings.append((point_id, ts, value, quality_of(value, vmin, vmax)))
    return readings, unmapped
