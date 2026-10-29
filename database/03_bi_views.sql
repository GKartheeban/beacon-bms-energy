/* =========================================================================
   BEACON - data model for Power BI (schema "bi")
   Run in pgAdmin on the "beacon" database (open file, F5). Safe to run again.

   Power BI reads ONLY these views. They turn raw readings into clean,
   named, Paris-time tables. Change the thresholds in bi.settings, never
   in Power BI, so every report uses the same rules.

   Views
     bi.settings            comfort band, working hours (editable table)
     bi.dim_room            rooms (English + French)
     bi.dim_device          devices
     bi.fact_reading        every reading, one row each (long format)
     bi.room_30min          per room per 30 min: temperature, humidity, occupied
     bi.room_hourly         per room per hour, with comfort status
     bi.room_daily          per room per day: min/avg/max, occupied hours, comfort %
     bi.outdoor_hourly      outdoor temperature and humidity per hour
     bi.indoor_vs_outdoor   per room per hour: indoor minus outdoor
     bi.occupancy_sessions  each period a room was in use (start, end, minutes)
     bi.relay_state         relay outputs over time (lighting)
     bi.device_health       battery, last report, completeness per sensor
     bi.site_kpi_daily      headline numbers per day
   ========================================================================= */

CREATE SCHEMA IF NOT EXISTS bi;

/* ---------------------------------------------------------- settings */
CREATE TABLE IF NOT EXISTS bi.settings (
    id                smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    comfort_temp_min  numeric NOT NULL DEFAULT 19,    -- degC
    comfort_temp_max  numeric NOT NULL DEFAULT 24,
    comfort_rh_min    numeric NOT NULL DEFAULT 40,    -- %RH
    comfort_rh_max    numeric NOT NULL DEFAULT 60,
    humid_alert_rh    numeric NOT NULL DEFAULT 70,    -- mould / condensation risk
    work_start        time    NOT NULL DEFAULT '08:00',
    work_end          time    NOT NULL DEFAULT '18:00',
    work_days         int[]   NOT NULL DEFAULT '{1,2,3,4,5}',   -- ISO: 1 = Monday
    battery_low_pct   numeric NOT NULL DEFAULT 20,
    silent_after_min  int     NOT NULL DEFAULT 60     -- sensor counted silent after this
);
INSERT INTO bi.settings (id) VALUES (1) ON CONFLICT DO NOTHING;

/* -------------------------------------------------------- dimensions */
CREATE OR REPLACE VIEW bi.dim_room AS
SELECT z.zone_id AS room_id, z.name_en AS room, z.name AS room_fr, z.zone_type,
       b.code AS site_code, b.name AS site
FROM core.zone z
JOIN core.building b ON b.building_id = z.building_id;

CREATE OR REPLACE VIEW bi.dim_device AS
SELECT e.equipment_id AS device_id, e.tag, e.name AS device, e.name_fr AS device_fr,
       e.model, e.equipment_type, e.system_code, e.zone_id AS room_id, z.name_en AS room, e.dev_eui
FROM core.equipment e
LEFT JOIN core.zone z ON z.zone_id = e.zone_id;

/* ------------------------------------------------- all readings, long */
CREATE OR REPLACE VIEW bi.fact_reading AS
SELECT (r.ts AT TIME ZONE 'Europe/Paris')                          AS time_paris,
       (r.ts AT TIME ZONE 'Europe/Paris')::date                    AS date_paris,
       extract(hour FROM r.ts AT TIME ZONE 'Europe/Paris')::int    AS hour_paris,
       e.zone_id AS room_id, z.name_en AS room, e.equipment_id AS device_id, e.tag, e.name AS device,
       dp.point_code, dp.payload_key AS measure, dp.quantity, dp.unit_code AS unit,
       r.value, r.quality
FROM ts.reading r
JOIN core.data_point dp ON dp.point_id = r.point_id
JOIN core.equipment e   ON e.equipment_id = dp.equipment_id
LEFT JOIN core.zone z   ON z.zone_id = e.zone_id
WHERE r.quality <= 1;

/* -------------------------------------------- room sensors, by 30 min
   Room sensors report about every 30 minutes, so 30 min is the finest
   honest grid. Rooms with two sensors (Workshop) are averaged; a room
   counts as occupied if any of its sensors saw someone. */
CREATE OR REPLACE VIEW bi.room_30min AS
SELECT date_bin(INTERVAL '30 minutes', r.ts AT TIME ZONE 'Europe/Paris', TIMESTAMP '2000-01-01') AS slot_paris,
       e.zone_id AS room_id, z.name_en AS room,
       round(avg(r.value) FILTER (WHERE dp.payload_key = 'temperature')::numeric, 2) AS temp_c,
       round(avg(r.value) FILTER (WHERE dp.payload_key = 'humidity')::numeric, 1)    AS humidity_pct,
       max(r.value)       FILTER (WHERE dp.payload_key = 'occupancy')                AS occupied,
       count(DISTINCT r.ts)                                                          AS reports
FROM ts.reading r
JOIN core.data_point dp ON dp.point_id = r.point_id
JOIN core.equipment e   ON e.equipment_id = dp.equipment_id AND e.system_code = 'IAQ'
JOIN core.zone z        ON z.zone_id = e.zone_id
WHERE r.quality <= 1 AND dp.payload_key IN ('temperature', 'humidity', 'occupancy')
GROUP BY 1, 2, 3;

/* ------------------------------------------------- room sensors, hourly */
CREATE OR REPLACE VIEW bi.room_hourly AS
WITH h AS (
    SELECT date_trunc('hour', slot_paris) AS hour_paris, room_id, room,
           round(avg(temp_c), 2)              AS temp_c,
           round(avg(humidity_pct), 1)        AS humidity_pct,
           round(avg(occupied)::numeric, 2)   AS occupied_share     -- 0..1
    FROM bi.room_30min
    GROUP BY 1, 2, 3
)
SELECT h.hour_paris,
       h.hour_paris::date                          AS date_paris,
       extract(hour FROM h.hour_paris)::int        AS hour_of_day,
       extract(isodow FROM h.hour_paris)::int      AS iso_weekday,
       h.room_id, h.room, h.temp_c, h.humidity_pct, h.occupied_share,
       CASE
         WHEN h.temp_c IS NULL                    THEN 'No data'
         WHEN h.humidity_pct >= s.humid_alert_rh  THEN 'Too humid'
         WHEN h.temp_c <  s.comfort_temp_min      THEN 'Too cold'
         WHEN h.temp_c >  s.comfort_temp_max      THEN 'Too warm'
         WHEN h.humidity_pct > s.comfort_rh_max   THEN 'Humid'
         WHEN h.humidity_pct < s.comfort_rh_min   THEN 'Dry'
         ELSE 'Comfortable'
       END                                         AS comfort_status,
       (extract(isodow FROM h.hour_paris)::int = ANY (s.work_days)
        AND h.hour_paris::time >= s.work_start
        AND h.hour_paris::time <  s.work_end)      AS working_hours
FROM h CROSS JOIN bi.settings s;

/* ------------------------------------------------- room sensors, daily */
CREATE OR REPLACE VIEW bi.room_daily AS
SELECT h.date_paris, h.room_id, h.room,
       min(h.temp_c) AS temp_min_c, round(avg(h.temp_c), 2) AS temp_avg_c, max(h.temp_c) AS temp_max_c,
       round(avg(h.humidity_pct), 1)                                        AS humidity_avg_pct,
       max(h.humidity_pct)                                                  AS humidity_max_pct,
       round(sum(h.occupied_share), 1)                                      AS occupied_hours,
       count(*)                                                             AS hours_with_data,
       round(100.0 * count(*) FILTER (WHERE h.comfort_status = 'Comfortable') / nullif(count(*), 0), 1) AS comfortable_pct,
       round(100.0 * count(*) FILTER (WHERE h.comfort_status = 'Comfortable' AND h.working_hours)
                   / nullif(count(*) FILTER (WHERE h.working_hours), 0), 1)  AS comfortable_working_pct
FROM bi.room_hourly h
GROUP BY 1, 2, 3;

/* ------------------------------------------------------------ outdoor */
CREATE OR REPLACE VIEW bi.outdoor_hourly AS
SELECT date_trunc('hour', r.ts AT TIME ZONE 'Europe/Paris') AS hour_paris,
       round(avg(r.value) FILTER (WHERE dp.payload_key = 'temperature')::numeric, 2) AS outdoor_temp_c,
       round(avg(r.value) FILTER (WHERE dp.payload_key = 'humidity')::numeric, 1)    AS outdoor_humidity_pct
FROM ts.reading r
JOIN core.data_point dp ON dp.point_id = r.point_id
JOIN core.equipment e   ON e.equipment_id = dp.equipment_id AND e.system_code = 'WTH'
WHERE r.quality <= 1
GROUP BY 1;

CREATE OR REPLACE VIEW bi.indoor_vs_outdoor AS
SELECT h.hour_paris, h.room_id, h.room, h.temp_c AS indoor_temp_c, o.outdoor_temp_c,
       round(h.temp_c - o.outdoor_temp_c, 2) AS indoor_minus_outdoor_c
FROM bi.room_hourly h
JOIN bi.outdoor_hourly o ON o.hour_paris = h.hour_paris;

/* ------------------------------------------------ occupancy sessions
   Consecutive "occupied" reports of a room form one session. A session
   ends at the first "empty" report (or is still open). */
CREATE OR REPLACE VIEW bi.occupancy_sessions AS
WITH s AS (
    SELECT room_id, room, slot_paris, occupied,
           CASE WHEN occupied = 1 AND coalesce(lag(occupied) OVER w, 0) = 0 THEN 1 ELSE 0 END AS starts
    FROM bi.room_30min
    WHERE occupied IS NOT NULL
    WINDOW w AS (PARTITION BY room_id ORDER BY slot_paris)
), g AS (
    SELECT *, sum(starts) OVER (PARTITION BY room_id ORDER BY slot_paris) AS session_no
    FROM s
), sessions AS (
    SELECT room_id, room, session_no,
           min(slot_paris) FILTER (WHERE occupied = 1) AS start_paris,
           max(slot_paris) FILTER (WHERE occupied = 1) AS last_seen_paris
    FROM g WHERE session_no > 0
    GROUP BY room_id, room, session_no
)
SELECT room_id, room, start_paris::date AS date_paris, start_paris,
       last_seen_paris + INTERVAL '30 minutes' AS end_paris,
       extract(epoch FROM (last_seen_paris + INTERVAL '30 minutes' - start_paris))::int / 60 AS minutes
FROM sessions
WHERE start_paris IS NOT NULL;

/* --------------------------------------------------- relay (lighting) */
CREATE OR REPLACE VIEW bi.relay_state AS
SELECT (r.ts AT TIME ZONE 'Europe/Paris') AS time_paris,
       (r.ts AT TIME ZONE 'Europe/Paris')::date AS date_paris,
       dp.point_code, dp.payload_key AS output, dp.quantity, r.value AS state
FROM ts.reading r
JOIN core.data_point dp ON dp.point_id = r.point_id
JOIN core.equipment e   ON e.equipment_id = dp.equipment_id AND e.tag = 'MIO'
WHERE dp.payload_key ~ '^sortie[0-9]+$';

/* ------------------------------------------------------ device health */
CREATE OR REPLACE VIEW bi.device_health AS
WITH last_msg AS (
    SELECT e.equipment_id,
           max(r.ts) AS last_ts,
           count(DISTINCT r.ts) FILTER (WHERE r.ts > now() - INTERVAL '24 hours') AS messages_24h
    FROM core.equipment e
    LEFT JOIN core.data_point dp ON dp.equipment_id = e.equipment_id
    LEFT JOIN ts.reading r       ON r.point_id = dp.point_id
    GROUP BY e.equipment_id
), batt AS (
    SELECT DISTINCT ON (dp.equipment_id) dp.equipment_id, r.value AS battery_pct
    FROM ts.reading r JOIN core.data_point dp ON dp.point_id = r.point_id
    WHERE dp.payload_key = 'battery'
    ORDER BY dp.equipment_id, r.ts DESC
)
SELECT e.equipment_id AS device_id, e.tag, e.name AS device, z.name_en AS room, e.model,
       (l.last_ts AT TIME ZONE 'Europe/Paris') AS last_report_paris,
       greatest(0, round(extract(epoch FROM now() - l.last_ts)::numeric / 60)) AS minutes_since_report,
       b.battery_pct,
       l.messages_24h,
       CASE e.system_code WHEN 'IAQ' THEN 48 WHEN 'WTH' THEN 144 ELSE NULL END AS expected_24h,
       CASE WHEN e.system_code IN ('IAQ', 'WTH')
            THEN least(100, round(100.0 * l.messages_24h / CASE e.system_code WHEN 'IAQ' THEN 48 ELSE 144 END, 1)) END AS completeness_pct,
       CASE
         WHEN l.last_ts IS NULL                                        THEN 'Never reported'
         WHEN now() - l.last_ts > make_interval(mins => s.silent_after_min) THEN 'Silent'
         WHEN b.battery_pct < s.battery_low_pct                        THEN 'Battery low'
         ELSE 'OK'
       END AS status
FROM core.equipment e
LEFT JOIN core.zone z ON z.zone_id = e.zone_id
LEFT JOIN last_msg l  ON l.equipment_id = e.equipment_id
LEFT JOIN batt b      ON b.equipment_id = e.equipment_id
CROSS JOIN bi.settings s;

/* ----------------------------------------------------- site KPIs, daily */
CREATE OR REPLACE VIEW bi.site_kpi_daily AS
SELECT d.date_paris,
       round(avg(d.temp_avg_c), 2)               AS indoor_temp_avg_c,
       min(d.temp_min_c)                         AS indoor_temp_min_c,
       max(d.temp_max_c)                         AS indoor_temp_max_c,
       round(avg(d.humidity_avg_pct), 1)         AS indoor_humidity_avg_pct,
       round(sum(d.occupied_hours), 1)           AS room_hours_occupied,
       round(avg(d.comfortable_pct), 1)          AS comfortable_pct,
       round(avg(d.comfortable_working_pct), 1)  AS comfortable_working_pct,
       (SELECT round(avg(o.outdoor_temp_c), 2) FROM bi.outdoor_hourly o
         WHERE o.hour_paris::date = d.date_paris) AS outdoor_temp_avg_c
FROM bi.room_daily d
GROUP BY d.date_paris;

/* Check: one line per view with its row count */
SELECT 'room_30min' AS view, count(*) FROM bi.room_30min
UNION ALL SELECT 'room_hourly', count(*) FROM bi.room_hourly
UNION ALL SELECT 'room_daily', count(*) FROM bi.room_daily
UNION ALL SELECT 'outdoor_hourly', count(*) FROM bi.outdoor_hourly
UNION ALL SELECT 'occupancy_sessions', count(*) FROM bi.occupancy_sessions
UNION ALL SELECT 'relay_state', count(*) FROM bi.relay_state
UNION ALL SELECT 'device_health', count(*) FROM bi.device_health
UNION ALL SELECT 'site_kpi_daily', count(*) FROM bi.site_kpi_daily;
