"""
beacon_collector.py - BEACON data collector for the Villetaneuse pilot.

Listens to the site's MQTT broker (through the WireGuard VPN), and saves
every sensor message into the BEACON database:
  - ts.raw_message : the message exactly as received
  - ts.reading     : one row per value, mapped to its data point

READ ONLY. This program never publishes anything to the broker.
It only subscribes to '+/uplink'. Publishing on 'lorawan/downlink/...'
would switch real equipment on site.

Run:  python beacon_collector.py          (stop with Ctrl+C)
Settings come from the .env file next to this script.
"""
import logging
import os
import signal
import sys
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt
import psycopg2
from psycopg2.extras import Json
from dotenv import load_dotenv

from mapping import dev_eui_from_topic, parse_payload, to_readings

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.1.17")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USER = os.getenv("MQTT_USER", "")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "")
MQTT_TOPIC = "+/uplink"                     # fixed on purpose: uplinks only
SITE_CODE = os.getenv("SITE_CODE", "VLT")
BROKER_CODE = os.getenv("BROKER_CODE", "VLT-JEEDOM")

DB = dict(
    host=os.getenv("DB_HOST", "localhost"),
    port=int(os.getenv("DB_PORT", "5432")),
    dbname=os.getenv("DB_NAME", "beacon"),
    user=os.getenv("DB_USER", "beacon"),
    password=os.getenv("DB_PASSWORD", ""),
)

POINT_REFRESH_SECONDS = 600                 # re-read the data point list every 10 minutes

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(message)s",
                    datefmt="%Y-%m-%d %H:%M:%S")
log = logging.getLogger("beacon")


class Store:
    """Database access, with automatic reconnect."""

    def __init__(self):
        self.conn = None
        self.points = {}             # dev_eui -> {payload_key: (point_id, min, max)}
        self.points_loaded_at = 0
        self.gateway_id = None
        self.unmapped_seen = set()   # (dev_eui, key) already reported

    def connect(self):
        while True:
            try:
                self.conn = psycopg2.connect(**DB)
                self.conn.autocommit = True
                log.info("Database connected (%s:%s/%s)", DB["host"], DB["port"], DB["dbname"])
                self.load_points(force=True)
                return
            except psycopg2.OperationalError as e:
                log.error("Database not reachable, retrying in 10 s: %s", str(e).strip())
                time.sleep(10)

    def run(self, sql, params=None, fetch=False):
        for attempt in (1, 2):
            try:
                if self.conn is None or self.conn.closed:
                    self.connect()
                with self.conn.cursor() as cur:
                    cur.execute(sql, params)
                    return cur.fetchall() if fetch else None
            except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
                log.error("Database connection lost: %s", str(e).strip())
                self.conn = None
                if attempt == 2:
                    raise

    def load_points(self, force=False):
        if not force and time.time() - self.points_loaded_at < POINT_REFRESH_SECONDS:
            return
        rows = self.run("""
            SELECT e.dev_eui, dp.payload_key, dp.point_id, dp.valid_min, dp.valid_max
            FROM core.data_point dp
            JOIN core.equipment e ON e.equipment_id = dp.equipment_id
            JOIN core.building b  ON b.building_id = e.building_id
            WHERE b.code = %s AND dp.is_active AND e.is_active AND e.dev_eui IS NOT NULL
        """, (SITE_CODE,), fetch=True)
        points = {}
        for dev_eui, key, point_id, vmin, vmax in rows:
            points.setdefault(dev_eui, {})[key] = (point_id, vmin, vmax)
        self.points = points
        self.points_loaded_at = time.time()
        gw = self.run("SELECT gateway_id FROM core.gateway WHERE code = %s", (BROKER_CODE,), fetch=True)
        self.gateway_id = gw[0][0] if gw else None
        log.info("Loaded %d data points for %d devices (site %s)",
                 sum(len(v) for v in points.values()), len(points), SITE_CODE)

    def status(self, connected, note):
        try:
            self.run("INSERT INTO ops.collector_status (gateway_id, connected, note) VALUES (%s, %s, %s)",
                     (self.gateway_id, connected, note))
        except Exception as e:                       # status is nice to have, never fatal
            log.warning("Could not record status: %s", e)

    def save(self, topic, raw):
        received_at = datetime.now(timezone.utc)
        dev_eui = dev_eui_from_topic(topic)
        payload = parse_payload(raw)
        if payload is None:
            log.warning("Ignored message on %s: not a JSON object", topic)
            return
        self.run("INSERT INTO ts.raw_message (received_at, topic, dev_eui, payload) VALUES (%s, %s, %s, %s)",
                 (received_at, topic, dev_eui, Json(payload)))
        if dev_eui is None:
            return
        self.load_points()
        device_points = self.points.get(dev_eui)
        if not device_points:
            if (dev_eui, None) not in self.unmapped_seen:
                self.unmapped_seen.add((dev_eui, None))
                log.warning("Device %s is not in core.equipment yet (message kept in ts.raw_message)", dev_eui)
            return
        readings, unmapped = to_readings(payload, device_points, received_at)
        for r in readings:
            self.run("""INSERT INTO ts.reading (point_id, ts, value, quality, received_at)
                        VALUES (%s, %s, %s, %s, %s) ON CONFLICT (point_id, ts) DO NOTHING""",
                     (r[0], r[1], r[2], r[3], received_at))
        new_keys = [k for k in unmapped if (dev_eui, k) not in self.unmapped_seen]
        if new_keys:
            self.unmapped_seen.update((dev_eui, k) for k in new_keys)
            log.info("Device %s also sends: %s (kept in ts.raw_message, not mapped)", dev_eui, ", ".join(new_keys))
        suspect = sum(1 for r in readings if r[3] >= 2)
        log.info("%s  %d values saved%s", dev_eui, len(readings),
                 f", {suspect} outside the plausible range" if suspect else "")


def main():
    if not MQTT_CLIENT_ID or MQTT_CLIENT_ID in ("jeedom", "ug56"):
        sys.exit("Set MQTT_CLIENT_ID in .env to your own id, e.g. hyperv-dev-kartheeban "
                 "(never 'jeedom' or 'ug56': that would disconnect the site's own clients).")

    store = Store()
    store.connect()

    def on_connect(client, userdata, flags, reason_code, properties):
        if reason_code.is_failure:
            log.error("Broker refused the connection: %s", reason_code)
            store.status(False, f"refused: {reason_code}")
            return
        log.info("Connected to broker %s:%s as %s", MQTT_HOST, MQTT_PORT, MQTT_CLIENT_ID)
        client.subscribe(MQTT_TOPIC, qos=0)
        log.info("Listening on '%s'. Sensors report about every 30 minutes.", MQTT_TOPIC)
        store.status(True, "connected")

    def on_disconnect(client, userdata, flags, reason_code, properties):
        log.warning("Disconnected from broker (%s). Reconnecting automatically...", reason_code)
        store.status(False, f"disconnected: {reason_code}")

    def on_message(client, userdata, msg):
        try:
            store.save(msg.topic, msg.payload)
        except Exception as e:
            log.exception("Could not save message from %s: %s", msg.topic, e)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=MQTT_CLIENT_ID, clean_session=True)
    if MQTT_USER:
        client.username_pw_set(MQTT_USER, MQTT_PASSWORD)
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=2, max_delay=60)

    def stop(*_):
        log.info("Stopping...")
        store.status(False, "stopped by user")
        client.disconnect()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    log.info("Connecting to broker %s:%s ... (is the WireGuard tunnel active?)", MQTT_HOST, MQTT_PORT)
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=60)
    client.loop_forever(retry_first_connection=True)
    log.info("Collector stopped.")


if __name__ == "__main__":
    main()
