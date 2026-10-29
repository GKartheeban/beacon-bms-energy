"""
fake_site.py - pretends to be the Villetaneuse site, for testing on your own PC.

Sends WS203 / EM300-TH style messages to a TEST broker on this computer,
so you can check the collector and database before the VPN works.

It refuses to run against any broker except localhost: it must never
publish anything to the real site.

Run:  python fake_site.py            (one round of messages every 10 s)
      python fake_site.py 60         (every 60 s)
"""
import json
import random
import sys
import time

import paho.mqtt.client as mqtt

HOST, PORT = "127.0.0.1", 1883            # local test broker only, never the site
INTERVAL = int(sys.argv[1]) if len(sys.argv) > 1 else 10

ROOM_SENSORS = {
    "24e12479105d08ff": "Workshop - Sensor 1",
    "24e12479105d617b": "Workshop - Sensor 2",
    "24e12479105d8d3a": "Corridor - Sensor 3",
    "24e12479105d3494": "Management office - Sensor 4",
    "24e12479105de88d": "Accounts office - Sensor 5",
}
OUTDOOR = "24e124136056b599"

client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="beacon-fake-site")
client.connect(HOST, PORT)
client.loop_start()
print(f"Fake site publishing to {HOST}:{PORT} every {INTERVAL} s. Ctrl+C to stop.")

try:
    while True:
        for dev, name in ROOM_SENSORS.items():
            msg = {"battery": random.randint(85, 100),
                   "temperature": round(random.uniform(19.5, 24.5), 1),
                   "humidity": round(random.uniform(40, 60), 1),
                   "occupancy": random.choice(["occupied", "vacant"])}
            client.publish(f"{dev}/uplink", json.dumps(msg))
            print(f"  {name:<30} {msg}")
        out = {"battery": 97, "temperature": round(random.uniform(8, 16), 1),
               "humidity": round(random.uniform(60, 90), 1)}
        client.publish(f"{OUTDOOR}/uplink", json.dumps(out))
        print(f"  {'Outdoor sensor':<30} {out}")
        time.sleep(INTERVAL)
except KeyboardInterrupt:
    pass
finally:
    client.loop_stop()
    client.disconnect()
