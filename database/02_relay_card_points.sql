/* =========================================================================
   BEACON - data points for the Multi I/O relay card (lighting), Villetaneuse
   Run once in pgAdmin on the "beacon" database (open file, F5).
   Safe to run again.

   The card sends French field names:
     entree1..4      = inputs (entrée)          -> VLT-LTG-MIO-IN1..4      on/off
     sortie1..4      = relay outputs (sortie)   -> VLT-LTG-MIO-OUT1..4     on/off (lighting)
     instantanee1..n = instantaneous values     -> VLT-LTG-MIO-INST1..n
     temperature     = card temperature         -> VLT-LTG-MIO-TEMP        degC
     any other field = kept as its own point    -> VLT-LTG-MIO-<FIELD>
   'type' is the message type, not a measurement, so it is skipped.

   The points are created from the fields the card has actually sent
   (stored in ts.raw_message), then the readings already received are
   copied into ts.reading so nothing collected so far is lost.
   ========================================================================= */

INSERT INTO core.unit (unit_code, name, quantity) VALUES
    ('raw', 'Value as sent by the device (unit not known yet)', 'Unknown')
ON CONFLICT DO NOTHING;

/* 1. One data point per field the card sends */
WITH card AS (
    SELECT e.equipment_id
    FROM core.equipment e
    JOIN core.building b ON b.building_id = e.building_id
    WHERE b.code = 'VLT' AND e.tag = 'MIO'
),
fields AS (
    SELECT DISTINCT k.key
    FROM ts.raw_message m,
         jsonb_each(m.payload) AS k
    WHERE m.dev_eui = '70b3d5326007d034'
      AND k.key <> 'type'
      AND jsonb_typeof(k.value) IN ('number', 'boolean')
),
defs AS (
    SELECT key,
        CASE
            WHEN key ~ '^entree[0-9]+$'       THEN 'IN'   || substring(key from '[0-9]+$')
            WHEN key ~ '^sortie[0-9]+$'       THEN 'OUT'  || substring(key from '[0-9]+$')
            WHEN key ~ '^instantanee[0-9]+$'  THEN 'INST' || substring(key from '[0-9]+$')
            WHEN key = 'temperature'          THEN 'TEMP'
            ELSE upper(regexp_replace(key, '[^A-Za-z0-9]+', '', 'g'))
        END AS suffix,
        CASE
            WHEN key ~ '^entree[0-9]+$'       THEN 'Input '  || substring(key from '[0-9]+$') || ' state'
            WHEN key ~ '^sortie[0-9]+$'       THEN 'Relay output ' || substring(key from '[0-9]+$') || ' (lighting) state'
            WHEN key ~ '^instantanee[0-9]+$'  THEN 'Instantaneous value ' || substring(key from '[0-9]+$')
            WHEN key = 'temperature'          THEN 'Card temperature'
            ELSE key
        END AS quantity,
        CASE
            WHEN key ~ '^(entree|sortie)[0-9]+$' THEN 'bool'
            WHEN key = 'temperature'             THEN 'degC'
            ELSE 'raw'
        END AS unit_code,
        CASE WHEN key ~ '^(entree|sortie)[0-9]+$' THEN 'Binary' ELSE 'Analog' END AS value_type,
        CASE WHEN key ~ '^(entree|sortie)[0-9]+$' THEN 0
             WHEN key = 'temperature' THEN -40 END AS vmin,
        CASE WHEN key ~ '^(entree|sortie)[0-9]+$' THEN 1
             WHEN key = 'temperature' THEN 85 END AS vmax
    FROM fields
)
INSERT INTO core.data_point (point_code, equipment_id, payload_key, quantity, unit_code, value_type, valid_min, valid_max)
SELECT 'VLT-LTG-MIO-' || d.suffix, c.equipment_id, d.key, d.quantity, d.unit_code, d.value_type, d.vmin, d.vmax
FROM defs d CROSS JOIN card c
ON CONFLICT DO NOTHING;

/* 2. Copy the card's messages already received into ts.reading */
INSERT INTO ts.reading (point_id, ts, value, quality, received_at)
SELECT dp.point_id, m.received_at,
       CASE jsonb_typeof(k.value)
            WHEN 'boolean' THEN CASE WHEN k.value::text = 'true' THEN 1 ELSE 0 END
            ELSE (k.value::text)::double precision END,
       0, m.received_at
FROM ts.raw_message m
CROSS JOIN LATERAL jsonb_each(m.payload) AS k
JOIN core.equipment e  ON e.dev_eui = m.dev_eui
JOIN core.data_point dp ON dp.equipment_id = e.equipment_id AND dp.payload_key = k.key
WHERE m.dev_eui = '70b3d5326007d034'
  AND jsonb_typeof(k.value) IN ('number', 'boolean')
ON CONFLICT (point_id, ts) DO NOTHING;

/* 3. Check: the card's data points and their latest values */
SELECT dp.point_code, dp.payload_key, dp.quantity, dp.unit_code, l.value, l.time_paris
FROM core.data_point dp
JOIN core.equipment e ON e.equipment_id = dp.equipment_id AND e.tag = 'MIO'
LEFT JOIN ts.latest l ON l.point_code = dp.point_code
ORDER BY dp.point_id;
