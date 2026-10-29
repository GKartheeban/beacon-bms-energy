/* =========================================================================
   BEACON - database schema, first version for the Villetaneuse pilot
   PostgreSQL 16 + TimescaleDB. Run once in pgAdmin (Query Tool on the
   "beacon" database): open this file, press F5.
   Safe to run again: it only creates what does not exist yet.

   Follows docs/Database_Design.docx. Only the tables the pilot needs now
   are created; the energy, ctx and app tables come later, once the site
   has an electricity meter and the dashboard is connected.
   ========================================================================= */

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE SCHEMA IF NOT EXISTS core;   -- asset register
CREATE SCHEMA IF NOT EXISTS ts;     -- readings
CREATE SCHEMA IF NOT EXISTS ops;    -- gateway health, data gaps

/* ---------------------------------------------------------------- core */

CREATE TABLE IF NOT EXISTS core.building (
    building_id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(6)  NOT NULL UNIQUE,      -- used in tags, e.g. VLT
    name            text        NOT NULL,
    building_type   text,
    city            text,
    country         text,
    timezone        text        NOT NULL,             -- e.g. Europe/Paris
    gross_area_m2   numeric(10,1),
    owner_org       text,
    is_active       boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.zone (
    zone_id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    building_id     integer     NOT NULL REFERENCES core.building,
    code            varchar(20) NOT NULL,             -- e.g. ATELIER
    name            text        NOT NULL,             -- as named on site (French)
    name_en         text,                             -- English name
    zone_type       text,                             -- Workshop, Corridor, Office, Outdoor
    area_m2         numeric(10,1),
    UNIQUE (building_id, code)
);

CREATE TABLE IF NOT EXISTS core.system_type (
    system_code     varchar(4)  PRIMARY KEY,
    name            text        NOT NULL,
    category        text
);

CREATE TABLE IF NOT EXISTS core.unit (
    unit_code       varchar(12) PRIMARY KEY,
    name            text        NOT NULL,
    quantity        text
);

CREATE TABLE IF NOT EXISTS core.gateway (
    gateway_id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    building_id     integer     NOT NULL REFERENCES core.building,
    code            varchar(30) NOT NULL UNIQUE,
    kind            text,                             -- LoRaWAN gateway, MQTT broker, ...
    model           text,
    address         text,                             -- address on the site network
    notes           text
);

CREATE TABLE IF NOT EXISTS core.equipment (
    equipment_id    integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    building_id     integer     NOT NULL REFERENCES core.building,
    zone_id         integer     REFERENCES core.zone,
    system_code     varchar(4)  NOT NULL REFERENCES core.system_type,
    gateway_id      integer     REFERENCES core.gateway,
    tag             varchar(20) NOT NULL,             -- e.g. S1, MIO
    name            text        NOT NULL,             -- English name
    name_fr         text,                             -- name used on site (French)
    equipment_type  text,
    manufacturer    text,
    model           text,
    dev_eui         varchar(16) UNIQUE,               -- LoRaWAN device id, lowercase
    is_active       boolean     NOT NULL DEFAULT true,
    UNIQUE (building_id, tag)
);

ALTER TABLE core.equipment ADD COLUMN IF NOT EXISTS name_fr text;

/* Every value the site sends is one data point with one unit.
   payload_key = the field name inside the device's JSON message. */
CREATE TABLE IF NOT EXISTS core.data_point (
    point_id        integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    point_code      varchar(60) NOT NULL UNIQUE,      -- BUILDING-SYSTEM-EQUIPMENT-POINT
    equipment_id    integer     NOT NULL REFERENCES core.equipment,
    payload_key     text        NOT NULL,             -- e.g. temperature
    quantity        text        NOT NULL,
    unit_code       varchar(12) NOT NULL REFERENCES core.unit,
    value_type      text        NOT NULL DEFAULT 'Analog',  -- Analog, Binary, Multistate
    valid_min       double precision,
    valid_max       double precision,
    interval_min    smallint    NOT NULL DEFAULT 30,  -- sensors report about every 30 min
    is_active       boolean     NOT NULL DEFAULT true,
    UNIQUE (equipment_id, payload_key)
);

/* ------------------------------------------------------------------ ts */

/* Every MQTT message exactly as received, before mapping.
   Keeps the original data, and shows fields we have not mapped yet. */
CREATE TABLE IF NOT EXISTS ts.raw_message (
    received_at     timestamptz NOT NULL DEFAULT now(),
    topic           text        NOT NULL,
    dev_eui         varchar(16),
    payload         jsonb       NOT NULL
);

/* One reading = one data point + one time + one value. */
CREATE TABLE IF NOT EXISTS ts.reading (
    point_id        integer     NOT NULL REFERENCES core.data_point,
    ts              timestamptz NOT NULL,             -- time of the reading (UTC)
    value           double precision NOT NULL,
    quality         smallint    NOT NULL DEFAULT 0,   -- 0 good, 1 estimated, 2 suspect, 3 bad
    received_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (point_id, ts)                        -- a resent reading is stored once
);

/* TimescaleDB: split by time, compress after 7 days */
SELECT create_hypertable('ts.raw_message', by_range('received_at', INTERVAL '7 days'), if_not_exists => TRUE);
SELECT create_hypertable('ts.reading',     by_range('ts',          INTERVAL '7 days'), if_not_exists => TRUE);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM timescaledb_information.compression_settings
                   WHERE hypertable_schema = 'ts' AND hypertable_name = 'reading') THEN
        ALTER TABLE ts.reading SET (timescaledb.compress, timescaledb.compress_segmentby = 'point_id');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM timescaledb_information.compression_settings
                   WHERE hypertable_schema = 'ts' AND hypertable_name = 'raw_message') THEN
        ALTER TABLE ts.raw_message SET (timescaledb.compress);
    END IF;
END $$;
SELECT add_compression_policy('ts.reading', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('ts.raw_message', INTERVAL '7 days', if_not_exists => TRUE);

/* Hourly summary, kept up to date automatically */
CREATE MATERIALIZED VIEW IF NOT EXISTS ts.reading_hourly
WITH (timescaledb.continuous) AS
SELECT point_id,
       time_bucket(INTERVAL '1 hour', ts) AS bucket,
       avg(value) AS avg_value,
       min(value) AS min_value,
       max(value) AS max_value,
       last(value, ts) AS last_value,
       count(*) AS samples
FROM ts.reading
WHERE quality <= 1
GROUP BY point_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('ts.reading_hourly',
    start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes', if_not_exists => TRUE);

/* ----------------------------------------------------------------- ops */

CREATE TABLE IF NOT EXISTS ops.collector_status (
    ts              timestamptz NOT NULL DEFAULT now(),
    gateway_id      integer     REFERENCES core.gateway,
    connected       boolean     NOT NULL,             -- collector connected to the broker
    note            text
);

CREATE TABLE IF NOT EXISTS ops.data_gap (
    gap_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    point_id        integer     REFERENCES core.data_point,
    gap_start       timestamptz NOT NULL,
    gap_end         timestamptz,
    reason          text                              -- Not reporting, Collector offline, Out of range
);

/* -------------------------------------------------------- reference data */

INSERT INTO core.system_type (system_code, name, category) VALUES
    ('IAQ', 'Indoor Air Quality and occupancy', 'Context'),
    ('WTH', 'Outdoor weather',                  'Context'),
    ('LTG', 'Lighting control',                 'Consumer')
ON CONFLICT DO NOTHING;

INSERT INTO core.unit (unit_code, name, quantity) VALUES
    ('degC',  'Degree Celsius',    'Temperature'),
    ('pctRH', 'Percent relative humidity', 'Humidity'),
    ('pct',   'Percent',           'Battery'),
    ('bool',  'On/off or yes/no',  'Status')
ON CONFLICT DO NOTHING;

/* ------------------------------------------------- Villetaneuse pilot site */

INSERT INTO core.building (code, name, building_type, city, country, timezone, owner_org)
VALUES ('VLT', 'Villetaneuse pilot site', 'Workshop and offices', 'Villetaneuse', 'France', 'Europe/Paris', 'EQUINOX GROUP')
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.zone (building_id, code, name, name_en, zone_type)
SELECT b.building_id, z.code, z.name, z.name_en, z.zone_type
FROM core.building b,
     (VALUES ('ATELIER',   'Atelier',          'Workshop',          'Workshop'),
             ('COULOIR',   'Couloir',          'Corridor',          'Corridor'),
             ('BUR-DIR',   'Bureau direction', 'Management office', 'Office'),
             ('BUR-COMPTA','Bureau compta',    'Accounts office',   'Office'),
             ('EXTERIEUR', 'Extérieur',        'Outdoor',           'Outdoor')) AS z(code, name, name_en, zone_type)
WHERE b.code = 'VLT'
ON CONFLICT (building_id, code) DO NOTHING;

INSERT INTO core.gateway (building_id, code, kind, model, address, notes)
SELECT b.building_id, g.code, g.kind, g.model, g.address, g.notes
FROM core.building b,
     (VALUES ('VLT-UG56',   'LoRaWAN gateway', 'Milesight UG56',   '192.168.1.175', 'Publishes decoded JSON to the Jeedom broker'),
             ('VLT-JEEDOM', 'MQTT broker',     'Jeedom Atlas Pro', '192.168.1.17:1883', 'Read only. Never publish on lorawan/downlink topics')) AS g(code, kind, model, address, notes)
WHERE b.code = 'VLT'
ON CONFLICT (code) DO NOTHING;

INSERT INTO core.equipment (building_id, zone_id, system_code, gateway_id, tag, name, name_fr, equipment_type, manufacturer, model, dev_eui)
SELECT b.building_id, z.zone_id, e.sys, g.gateway_id, e.tag, e.name, e.name_fr, e.etype, e.make, e.model, e.dev_eui
FROM core.building b
JOIN core.gateway g ON g.code = 'VLT-UG56'
JOIN (VALUES ('S1',  'ATELIER',    'IAQ', 'Workshop - Sensor 1',                'Atelier - Sonde 1',          'Room sensor',          'Milesight', 'WS203',    '24e12479105d08ff'),
             ('S2',  'ATELIER',    'IAQ', 'Workshop - Sensor 2',                'Atelier - Sonde 2',          'Room sensor',          'Milesight', 'WS203',    '24e12479105d617b'),
             ('S3',  'COULOIR',    'IAQ', 'Corridor - Sensor 3',                'Couloir - Sonde 3',          'Room sensor',          'Milesight', 'WS203',    '24e12479105d8d3a'),
             ('S4',  'BUR-DIR',    'IAQ', 'Management office - Sensor 4',       'Bureau direction - Sonde 4', 'Room sensor',          'Milesight', 'WS203',    '24e12479105d3494'),
             ('S5',  'BUR-COMPTA', 'IAQ', 'Accounts office - Sensor 5',         'Bureau compta - Sonde 5',    'Room sensor',          'Milesight', 'WS203',    '24e12479105de88d'),
             ('EXT', 'EXTERIEUR',  'WTH', 'Outdoor sensor',                     'Sonde extérieure',           'Outdoor sensor',       'Milesight', 'EM300-TH', '24e124136056b599'),
             ('MIO', 'ATELIER',    'LTG', 'Multi I/O relay card (lighting)',    'Carte Multi I/O',            'Lighting relay card',  'Domadoo',   'Multi I/O','70b3d5326007d034'))
     AS e(tag, zone, sys, name, name_fr, etype, make, model, dev_eui) ON true
JOIN core.zone z ON z.building_id = b.building_id AND z.code = e.zone
WHERE b.code = 'VLT'
ON CONFLICT (building_id, tag) DO NOTHING;

/* Data points (outdoor temperature is coded OAT, room temperature ZT): temperature, humidity, occupancy, battery for the five room
   sensors; temperature, humidity, battery for the outdoor sensor.
   The relay card's fields are not known yet: they will show up in
   ts.raw_message, and its points are added after we see them. */
INSERT INTO core.data_point (point_code, equipment_id, payload_key, quantity, unit_code, value_type, valid_min, valid_max)
SELECT 'VLT-' || e.system_code || '-' || e.tag || '-' || CASE WHEN e.system_code = 'WTH' AND p.suffix = 'ZT' THEN 'OAT' ELSE p.suffix END,
       e.equipment_id, p.payload_key, p.quantity, p.unit_code, p.value_type, p.vmin, p.vmax
FROM core.equipment e
JOIN core.building b ON b.building_id = e.building_id AND b.code = 'VLT'
JOIN (VALUES ('temperature', 'ZT',   'Temperature', 'degC',  'Analog', -40, 85, false),
             ('humidity',    'RHUM', 'Humidity',    'pctRH', 'Analog',   0, 100, false),
             ('occupancy',   'OCC',  'Occupancy',   'bool',  'Binary',   0, 1,  true),
             ('battery',     'BATT', 'Battery',     'pct',   'Analog',   0, 100, false))
     AS p(payload_key, suffix, quantity, unit_code, value_type, vmin, vmax, room_only)
  ON e.system_code IN ('IAQ', 'WTH') AND NOT (p.room_only AND e.system_code = 'WTH')
ON CONFLICT (point_code) DO NOTHING;

/* ----------------------------------------------------------- quick views */

/* Latest value of every data point, with room names: what the live tiles read */
CREATE OR REPLACE VIEW ts.latest AS
SELECT DISTINCT ON (r.point_id)
       z.name_en AS room, z.name AS room_fr, e.tag, e.name AS device, dp.point_code, dp.quantity,
       r.value, dp.unit_code, r.ts AT TIME ZONE 'Europe/Paris' AS time_paris, r.quality
FROM ts.reading r
JOIN core.data_point dp ON dp.point_id = r.point_id
JOIN core.equipment e   ON e.equipment_id = dp.equipment_id
LEFT JOIN core.zone z   ON z.zone_id = e.zone_id
ORDER BY r.point_id, r.ts DESC;

/* Check: should list 7 devices and 23 data points */
SELECT e.tag, e.name, e.name_fr, e.model, e.dev_eui, count(dp.point_id) AS data_points
FROM core.equipment e
LEFT JOIN core.data_point dp ON dp.equipment_id = e.equipment_id
GROUP BY e.equipment_id ORDER BY e.equipment_id;
