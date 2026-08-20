-- NSW G-NAF denormalized address index (server-side only).
-- Populated by: node scripts/import-gnaf-nsw/import.mjs

CREATE TABLE IF NOT EXISTS gnaf_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gnaf_address (
  address_detail_pid TEXT PRIMARY KEY,
  -- Primary street address (subpremise excluded)
  house_number TEXT,
  house_number_norm TEXT,
  street_name TEXT NOT NULL,
  street_name_norm TEXT NOT NULL,
  street_type TEXT,
  street_type_norm TEXT,
  -- Locality
  locality TEXT NOT NULL,
  locality_norm TEXT NOT NULL,
  postcode TEXT,
  state TEXT NOT NULL DEFAULT 'NSW',
  -- Coordinates (GDA2020 / G-NAF default geocode)
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  -- Optional unit/level from G-NAF (not used for primary match)
  subpremise TEXT,
  confidence INTEGER DEFAULT 0,
  address_label TEXT
);

CREATE INDEX IF NOT EXISTS idx_gnaf_pc_loc_street_hn
  ON gnaf_address (postcode, locality_norm, street_name_norm, house_number_norm);

CREATE INDEX IF NOT EXISTS idx_gnaf_pc_street_hn
  ON gnaf_address (postcode, street_name_norm, house_number_norm);

CREATE INDEX IF NOT EXISTS idx_gnaf_loc_street_hn
  ON gnaf_address (locality_norm, street_name_norm, house_number_norm);

CREATE INDEX IF NOT EXISTS idx_gnaf_street_fuzzy
  ON gnaf_address (street_name_norm, locality_norm);
