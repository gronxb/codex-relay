-- Apply only after the OTA Worker and every active Console runtime run rc.14.
-- Every legacy metadata value is preserved in bundle_events.metadata.
-- Remove temporary compatibility objects so future upstream migrations see the official schema.
DROP TRIGGER modex_insights_rc_compat;

CREATE TABLE bundle_events_final (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  install_id TEXT NOT NULL,
  user_id TEXT,
  from_release_id TEXT,
  from_bundle_id TEXT,
  to_release_id TEXT,
  to_bundle_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT NOT NULL,
  channel TEXT NOT NULL,
  metadata TEXT NOT NULL,
  received_at_ms REAL NOT NULL,
  CONSTRAINT bundle_events_type_check CHECK (
    type IN ('UPDATE_DOWNLOADED', 'UPDATE_APPLIED', 'RECOVERED', 'UNCHANGED')
  ),
  CONSTRAINT bundle_events_platform_check CHECK (
    platform IN ('ios', 'android')
  ),
  CONSTRAINT bundle_events_shape_check CHECK (
    (
      type IN ('UPDATE_DOWNLOADED', 'UPDATE_APPLIED', 'RECOVERED')
      AND from_bundle_id IS NOT NULL
    ) OR (
      type = 'UNCHANGED'
      AND from_bundle_id IS NULL
    )
  ),
  CONSTRAINT bundle_events_received_at_check CHECK (received_at_ms >= 0)
);


INSERT INTO bundle_events_final (id, type, install_id, user_id, from_release_id, from_bundle_id, to_release_id, to_bundle_id, platform, app_version, channel, metadata, received_at_ms)
SELECT id, type, install_id, user_id, from_release_id, from_bundle_id, to_release_id, to_bundle_id, platform, app_version, channel, metadata, received_at_ms FROM bundle_events;

DROP TABLE bundle_events;
ALTER TABLE bundle_events_final RENAME TO bundle_events;

CREATE INDEX bundle_events_received_at_idx ON bundle_events(received_at_ms, id);
CREATE INDEX bundle_events_install_idx ON bundle_events(install_id, type, received_at_ms, id);
CREATE INDEX bundle_events_from_bundle_idx ON bundle_events(type, platform, channel, from_bundle_id, received_at_ms, id);
CREATE INDEX bundle_events_to_bundle_idx ON bundle_events(type, platform, channel, to_bundle_id, received_at_ms, id);
CREATE INDEX bundle_events_latest_idx ON bundle_events(install_id, received_at_ms, id);

DROP TABLE bundle_installations;
