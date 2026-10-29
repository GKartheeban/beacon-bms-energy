# BEACON collector (Villetaneuse pilot)

Reads the sensor messages from the site's MQTT broker and saves them in the
BEACON database. Read only: it never publishes anything.

| File | What it does |
|---|---|
| `beacon_collector.py` | The collector. Run it while the WireGuard tunnel is active |
| `mapping.py` | Turns one message into readings (device id, values, time, quality) |
| `test_mapping.py` | Tests for `mapping.py` |
| `fake_site.py` | Pretends to be the site, for testing on your own PC |
| `.env.example` | Settings template. Copy to `.env` and fill in the passwords |

## One-time setup (Windows, in this folder)

```
pip install -r requirements.txt
copy .env.example .env
notepad .env
```

## Test on your own PC (no VPN needed)

1. Start a local test broker in Docker:
   ```
   docker run -d --name test-broker -p 1883:1883 eclipse-mosquitto mosquitto -c /mosquitto-no-auth.conf
   ```
2. In `.env`, set `MQTT_HOST=127.0.0.1` and leave `MQTT_USER=` empty.
3. Window 1: `python beacon_collector.py`
4. Window 2: `python fake_site.py`
5. In pgAdmin: `SELECT * FROM ts.latest;`
6. Stop both with Ctrl+C, then remove the fake readings before going live:
   ```sql
   TRUNCATE ts.reading, ts.raw_message, ops.collector_status;
   ```

## Run against the real site

1. Activate the WireGuard tunnel. Check that http://192.168.1.17 opens.
2. In `.env`, set `MQTT_HOST=192.168.1.17`, `MQTT_USER=jeedom` and the MQTT password.
3. `python beacon_collector.py`
4. Sensors report about every 30 minutes, so wait up to 30 minutes for the first values.

## Rules
- Never publish on `lorawan/downlink/...` (it switches real lighting). This program cannot.
- Use your own `MQTT_CLIENT_ID`, never `jeedom` or `ug56`.
- Never upload `.env` to GitHub (it is in `.gitignore`).
- Switch the tunnel off when you are not working.
