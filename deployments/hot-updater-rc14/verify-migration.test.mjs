import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const baseline = readFileSync(
  new URL("./worker/migrations/0001_hot-updater_1.0.0.sql", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("./worker/migrations/0002_modex_rc14_insights.sql", import.meta.url),
  "utf8",
);
const finalize = readFileSync(
  new URL("./worker/migrations/0003_modex_rc14_finalize.sql", import.meta.url),
  "utf8",
);
const targetSchema = readFileSync(new URL("./reference/rc14-schema.sql", import.meta.url), "utf8");
const metadata = {
  username: "migration-test",
  cohort: "42",
  update_strategy: "appVersion",
  fingerprint_hash: null,
  sdk_version: "1.0.0-rc.14",
};

function oldEvent(db, id, time, type = "UPDATE_APPLIED") {
  db.prepare(`INSERT INTO bundle_events (
    id, type, install_id, user_id, username, from_bundle_id, to_bundle_id,
    platform, app_version, channel, cohort, update_strategy, sdk_version, received_at_ms
  ) VALUES (?, ?, 'installation', 'user', 'migration-test', ?, 'bundle',
    'ios', '1.5.0', 'production', '42', ?, '1.0.0-rc.4', ?)`).run(
    id,
    type,
    type === "UNCHANGED" ? null : "embedded",
    type === "UNCHANGED" ? null : "appVersion",
    time,
  );
}

function newEvent(db, id, time, type = "UPDATE_DOWNLOADED") {
  db.prepare(`INSERT INTO bundle_events (
    id, type, install_id, user_id, from_bundle_id, to_bundle_id,
    platform, app_version, channel, metadata, received_at_ms
  ) VALUES (?, ?, 'installation', 'user', 'bundle', 'next-bundle',
    'ios', '1.5.0', 'production', ?, ?)`).run(id, type, JSON.stringify(metadata), time);
}

test("preserves every legacy event and builds heads using time then ID", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(baseline);
    oldEvent(db, "a", 100, "UNCHANGED");
    oldEvent(db, "c", 200);
    oldEvent(db, "b", 200, "RECOVERED");
    const before = db.prepare("SELECT * FROM bundle_events ORDER BY id").all();
    db.exec(migration);
    const after = db.prepare("SELECT * FROM bundle_events ORDER BY id").all();
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i++) {
      const { metadata: encoded, ...legacy } = after[i];
      assert.deepEqual({ ...legacy }, { ...before[i] });
      assert.deepEqual(JSON.parse(encoded), {
        username: before[i].username,
        cohort: before[i].cohort,
        update_strategy: before[i].update_strategy,
        fingerprint_hash: before[i].fingerprint_hash,
        sdk_version: before[i].sdk_version,
      });
    }
    assert.equal(db.prepare("SELECT id FROM bundle_event_heads").get().id, "c");
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    db.close();
  }
});

test("accepts old and new writers without moving heads backwards or activating downloads", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(baseline);
    db.exec(migration);
    oldEvent(db, "a", 100);
    assert.equal(
      JSON.parse(db.prepare("SELECT metadata FROM bundle_events WHERE id = 'a'").get().metadata)
        .sdk_version,
      "1.0.0-rc.4",
    );
    newEvent(db, "c", 300);
    assert.equal(db.prepare("SELECT id FROM bundle_event_heads").get().id, "c");
    assert.equal(db.prepare("SELECT id FROM bundle_installations").get().id, "a");
    oldEvent(db, "b", 200, "UNCHANGED");
    assert.equal(db.prepare("SELECT id FROM bundle_event_heads").get().id, "c");
    newEvent(db, "d", 300, "UPDATE_APPLIED");
    assert.equal(db.prepare("SELECT id FROM bundle_event_heads").get().id, "d");
    assert.equal(
      db.prepare("SELECT to_bundle_id FROM bundle_installations").get().to_bundle_id,
      "next-bundle",
    );
    assert.equal(db.prepare("SELECT cohort FROM bundle_events WHERE id = 'd'").get().cohort, "42");
    assert.throws(() => newEvent(db, "invalid", 400, "UNCHANGED"), /CHECK constraint/);
    assert.equal(db.prepare("SELECT id FROM bundle_event_heads").get().id, "d");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM bundle_events").get().count, 4);
  } finally {
    db.close();
  }
});

function schema(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all();
  return tables.map(({ name }) => ({
    name,
    columns: db.prepare(`PRAGMA table_info(${name})`).all(),
    foreignKeys: db.prepare(`PRAGMA foreign_key_list(${name})`).all(),
    indexes: db
      .prepare(`PRAGMA index_list(${name})`)
      .all()
      .map((index) => ({
        unique: index.unique,
        origin: index.origin,
        partial: index.partial,
        columns: db.prepare(`PRAGMA index_info(${index.name})`).all(),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  }));
}

test("finalization preserves events and restores the official schema for future migrations", () => {
  const db = new DatabaseSync(":memory:");
  const target = new DatabaseSync(":memory:");
  try {
    db.exec(baseline);
    oldEvent(db, "a", 100);
    db.exec(migration);
    newEvent(db, "b", 200);
    const before = db.prepare("SELECT id, metadata FROM bundle_events ORDER BY id").all();
    db.exec(finalize);
    target.exec(targetSchema);
    assert.deepEqual(schema(db), schema(target));
    assert.deepEqual(
      db.prepare("SELECT id, metadata FROM bundle_events ORDER BY id").all(),
      before,
    );
    assert.equal(
      db.prepare("SELECT value FROM private_hot_updater_settings WHERE key = 'schema.core'").get()
        .value,
      "1.0.0",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger'").get().count,
      0,
    );
    newEvent(db, "c", 300, "UPDATE_APPLIED");
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    db.close();
    target.close();
  }
});
