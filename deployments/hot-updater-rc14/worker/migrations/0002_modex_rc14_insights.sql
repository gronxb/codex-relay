-- Modex generation 1: upgrade the already-applied RC Insights schema in place.
-- 0001 keeps its original contents; never replay rc.14's replacement initializer.
-- D1 migrations apply this file transactionally. Delivery policy and keys are untouched.

CREATE TABLE bundle_events_rc14 (
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
  metadata TEXT NOT NULL DEFAULT '{}',
  -- Keep rc.3 writers working during deployment and retain the original fields.
  username TEXT,
  cohort TEXT,
  update_strategy TEXT,
  fingerprint_hash TEXT,
  sdk_version TEXT,
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


INSERT INTO bundle_events_rc14 (
  id, type, install_id, user_id, from_release_id, from_bundle_id,
  to_release_id, to_bundle_id, platform, app_version, channel, metadata,
  received_at_ms, username, cohort, update_strategy, fingerprint_hash, sdk_version
)
SELECT id, type, install_id, user_id, from_release_id, from_bundle_id,
  to_release_id, to_bundle_id, platform, app_version, channel,
  json_object('username', username, 'cohort', cohort,
    'update_strategy', update_strategy, 'fingerprint_hash', fingerprint_hash,
    'sdk_version', sdk_version),
  received_at_ms, username, cohort, update_strategy, fingerprint_hash, sdk_version
FROM bundle_events;

DROP TABLE bundle_events;
ALTER TABLE bundle_events_rc14 RENAME TO bundle_events;

CREATE INDEX bundle_events_received_at_idx ON bundle_events(received_at_ms, id);
CREATE INDEX bundle_events_install_idx ON bundle_events(install_id, type, received_at_ms, id);
CREATE INDEX bundle_events_from_bundle_idx ON bundle_events(type, platform, channel, from_bundle_id, received_at_ms, id);
CREATE INDEX bundle_events_to_bundle_idx ON bundle_events(type, platform, channel, to_bundle_id, received_at_ms, id);

CREATE TABLE bundle_event_heads (
  install_id TEXT PRIMARY KEY NOT NULL,
  id TEXT NOT NULL,
  received_at_ms REAL NOT NULL,
  user_id TEXT,
  platform TEXT NOT NULL,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  from_bundle_id TEXT,
  to_bundle_id TEXT NOT NULL
);

CREATE INDEX bundle_events_latest_idx ON bundle_events(install_id, received_at_ms, id);
CREATE INDEX bundle_event_heads_user_idx ON bundle_event_heads(user_id, install_id);
CREATE INDEX bundle_event_heads_scope_idx ON bundle_event_heads(platform, channel, received_at_ms);
CREATE INDEX bundle_event_heads_from_idx ON bundle_event_heads(type, platform, channel, from_bundle_id, received_at_ms);
CREATE INDEX bundle_event_heads_to_idx ON bundle_event_heads(type, platform, channel, to_bundle_id, received_at_ms);

INSERT INTO bundle_event_heads (
  install_id, id, received_at_ms, user_id, platform, channel, type, from_bundle_id, to_bundle_id
)
SELECT install_id, id, received_at_ms, user_id, platform, channel, type, from_bundle_id, to_bundle_id
FROM (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY install_id ORDER BY received_at_ms DESC, id DESC
  ) AS position FROM bundle_events
) WHERE position = 1;

-- Synchronize metadata for rc.3 inserts, and retain legacy fields for rc.14 inserts.
CREATE TRIGGER modex_insights_rc_compat AFTER INSERT ON bundle_events
BEGIN
  UPDATE bundle_events SET
    metadata = CASE WHEN NEW.metadata = '{}' THEN json_object(
      'username', NEW.username, 'cohort', NEW.cohort,
      'update_strategy', NEW.update_strategy, 'fingerprint_hash', NEW.fingerprint_hash,
      'sdk_version', NEW.sdk_version) ELSE NEW.metadata END,
    username = CASE WHEN NEW.metadata = '{}' THEN NEW.username ELSE json_extract(NEW.metadata, '$.username') END,
    cohort = CASE WHEN NEW.metadata = '{}' THEN NEW.cohort ELSE json_extract(NEW.metadata, '$.cohort') END,
    update_strategy = CASE WHEN NEW.metadata = '{}' THEN NEW.update_strategy ELSE json_extract(NEW.metadata, '$.update_strategy') END,
    fingerprint_hash = CASE WHEN NEW.metadata = '{}' THEN NEW.fingerprint_hash ELSE json_extract(NEW.metadata, '$.fingerprint_hash') END,
    sdk_version = CASE WHEN NEW.metadata = '{}' THEN NEW.sdk_version ELSE json_extract(NEW.metadata, '$.sdk_version') END
  WHERE id = NEW.id;

  INSERT INTO bundle_event_heads (
    install_id, id, received_at_ms, user_id, platform, channel, type, from_bundle_id, to_bundle_id
  ) VALUES (
    NEW.install_id, NEW.id, NEW.received_at_ms, NEW.user_id, NEW.platform,
    NEW.channel, NEW.type, NEW.from_bundle_id, NEW.to_bundle_id
  ) ON CONFLICT(install_id) DO UPDATE SET
    id = excluded.id, received_at_ms = excluded.received_at_ms, user_id = excluded.user_id,
    platform = excluded.platform, channel = excluded.channel, type = excluded.type,
    from_bundle_id = excluded.from_bundle_id, to_bundle_id = excluded.to_bundle_id
  WHERE (excluded.received_at_ms, excluded.id) > (bundle_event_heads.received_at_ms, bundle_event_heads.id);

  -- A download has not changed the active bundle seen by the old installations table.
  INSERT INTO bundle_installations (
    install_id, id, user_id, username, to_bundle_id, type, platform,
    app_version, channel, cohort, received_at_ms
  ) SELECT install_id, id, user_id, username, to_bundle_id, type, platform,
    app_version, channel, cohort, received_at_ms
  FROM bundle_events WHERE id = NEW.id AND type <> 'UPDATE_DOWNLOADED'
  ON CONFLICT(install_id) DO UPDATE SET
    id = excluded.id, user_id = excluded.user_id, username = excluded.username,
    to_bundle_id = excluded.to_bundle_id, type = excluded.type, platform = excluded.platform,
    app_version = excluded.app_version, channel = excluded.channel, cohort = excluded.cohort,
    received_at_ms = excluded.received_at_ms
  WHERE (excluded.received_at_ms, excluded.id) > (bundle_installations.received_at_ms, bundle_installations.id);
END;
