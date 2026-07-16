import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import relayPackage from "../package.json" with { type: "json" };
import { connect } from "../src/libsql-database.js";
import { createTursoPairingSessionStore } from "../src/pairing-store.js";

describe("pairing session store", () => {
  it("uses the libSQL client instead of the Intel-incompatible Turso database package", () => {
    expect(relayPackage.dependencies).toMatchObject({
      "@libsql/client": "0.17.4",
      libsql: "0.5.29",
      ws: "8.21.0",
    });
    expect(relayPackage.dependencies).not.toHaveProperty("@tursodatabase/database");
  });

  it("commits transactions in an in-memory store", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    const expiresAt = Date.now() + 60_000;
    await sessions.createSession("client-token", { expiresAt });
    await sessions.createPendingPairing({
      approvalCode: "1234-5678",
      approved: false,
      clientEphemeralPublicKey: "public-key",
      clientNonce: "nonce",
      expiresAt,
      serverUrl: "http://127.0.0.1:8787",
    });

    const cleared = await sessions.clearAll();

    expect(cleared).toEqual({ pendingPairingsCleared: 1, sessionsCleared: 1 });
    expect(await sessions.countActive(Date.now())).toBe(0);
    expect(await sessions.getPendingPairing("1234-5678", Date.now())).toBeUndefined();
  });

  it("isolates separate in-memory stores", async () => {
    const temporaryEntriesBefore = await memoryDatabaseEntries();
    const first = await createTursoPairingSessionStore(":memory:");
    const second = await createTursoPairingSessionStore(":memory:");
    await first.createSession("client-token", { expiresAt: Date.now() + 60_000 });

    expect(await first.countActive(Date.now())).toBe(1);
    expect(await second.countActive(Date.now())).toBe(0);
    expect(await memoryDatabaseEntries()).toEqual(temporaryEntriesBefore);
  });

  it("keeps push subscriptions with a stable paired device across token rotation", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    const expiresAt = Date.now() + 60_000;
    await sessions.createSession("old-client-token", {
      clientSessionId: "phone-session",
      expiresAt,
    });
    await sessions.upsertPushNotificationSubscription({
      actionRequired: true,
      clientSessionId: "phone-session",
      expoPushToken: "ExponentPushToken[phone-token]",
      platform: "ios",
      turnTerminal: true,
    });

    await sessions.rotateSession("old-client-token", "new-client-token", {
      clientSessionId: "phone-session",
      expiresAt,
    });

    expect(await sessions.getPushNotificationSubscription("phone-session")).toEqual({
      actionRequired: true,
      clientSessionId: "phone-session",
      expoPushToken: "ExponentPushToken[phone-token]",
      platform: "ios",
      turnTerminal: true,
    });
    expect(await sessions.listActivePushNotificationSubscriptions(Date.now())).toEqual([
      expect.objectContaining({ clientSessionId: "phone-session" }),
    ]);
  });

  it("does not dispatch push subscriptions for expired pairings and clears them with sessions", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    await sessions.createSession("expired-client-token", {
      clientSessionId: "expired-phone",
      expiresAt: Date.now() - 1,
    });
    await sessions.upsertPushNotificationSubscription({
      actionRequired: true,
      clientSessionId: "expired-phone",
      expoPushToken: "ExponentPushToken[expired-phone]",
      platform: "android",
      turnTerminal: true,
    });

    expect(await sessions.listActivePushNotificationSubscriptions(Date.now())).toEqual([]);
    await sessions.pruneExpired(Date.now());
    expect(await sessions.getPushNotificationSubscription("expired-phone")).toBeUndefined();

    await sessions.createSession("active-client-token", {
      clientSessionId: "active-phone",
      expiresAt: Date.now() + 60_000,
    });
    await sessions.upsertPushNotificationSubscription({
      actionRequired: false,
      clientSessionId: "active-phone",
      expoPushToken: "ExponentPushToken[active-phone]",
      platform: "android",
      turnTerminal: true,
    });
    await sessions.clearAll();

    expect(await sessions.getPushNotificationSubscription("active-phone")).toBeUndefined();
  });

  it("rolls back a token rotation when the replacement token already exists", async () => {
    const sessions = await createTursoPairingSessionStore(":memory:");
    const expiresAt = Date.now() + 60_000;
    await sessions.createSession("old-token", { clientName: "Old", expiresAt });
    await sessions.createSession("existing-token", { clientName: "Existing", expiresAt });

    await expect(
      sessions.rotateSession("old-token", "existing-token", {
        clientName: "Replacement",
        expiresAt,
      }),
    ).rejects.toThrow(/UNIQUE constraint failed/);

    expect(await sessions.getValidSession("old-token", Date.now())).toMatchObject({
      clientName: "Old",
      expiresAt,
    });
    expect(await sessions.getValidSession("existing-token", Date.now())).toMatchObject({
      clientName: "Existing",
      expiresAt,
    });
  });

  it("keeps concurrent writes outside a rolled-back in-memory transaction", async () => {
    const database = connect(":memory:");
    await database.exec("CREATE TABLE values_table (value TEXT PRIMARY KEY)");
    await database.prepare("INSERT INTO values_table (value) VALUES (?)").run("existing");
    let signalTransactionStarted!: () => void;
    const transactionStarted = new Promise<void>((resolve) => {
      signalTransactionStarted = resolve;
    });
    let resumeTransaction!: () => void;
    const transactionPaused = new Promise<void>((resolve) => {
      resumeTransaction = resolve;
    });
    const transaction = database.transaction(async (transactionDatabase) => {
      await transactionDatabase
        .prepare("INSERT INTO values_table (value) VALUES (?)")
        .run("rolled-back");
      signalTransactionStarted();
      await transactionPaused;
      throw new Error("rollback probe");
    })();
    await transactionStarted;

    const concurrentWrite = database
      .prepare("INSERT INTO values_table (value) VALUES (?)")
      .run("concurrent");
    resumeTransaction();

    await expect(transaction).rejects.toThrow("rollback probe");
    await concurrentWrite;
    expect(await database.prepare("SELECT value FROM values_table ORDER BY value").all()).toEqual([
      { value: "concurrent" },
      { value: "existing" },
    ]);
  });

  it("adds secure-session columns to an older auth database schema", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-relay-old-schema-"));
    const path = join(directory, "auth.db");
    createOldSchemaAuthDatabase(path);

    try {
      const sessions = await createTursoPairingSessionStore(path);

      expect(await sessions.getValidSession("old-schema-token", Date.now())).toMatchObject({
        clientName: "Old schema",
        secureSession: undefined,
      });

      const database = new DatabaseSync(path, { readOnly: true });
      const sessionColumns = database
        .prepare("PRAGMA table_info(pairing_sessions)")
        .all()
        .map((column) => column.name);
      const pendingColumns = database
        .prepare("PRAGMA table_info(pending_pairings)")
        .all()
        .map((column) => column.name);
      database.close();

      expect(sessionColumns).toEqual(
        expect.arrayContaining([
          "client_session_id",
          "key_epoch",
          "mobile_to_server_key",
          "server_to_mobile_key",
          "last_mobile_counter",
          "next_server_counter",
        ]),
      );
      expect(pendingColumns).toContain("client_session_id");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reads sessions and pending pairings from an existing SQLite auth database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-relay-legacy-auth-"));
    const path = join(directory, "auth.db");
    const expiresAt = Date.UTC(2099, 0, 1);
    createLegacyAuthDatabase(path, expiresAt);

    try {
      const sessions = await createTursoPairingSessionStore(path);

      const session = await sessions.getValidSession("legacy-token", Date.now());
      const pending = await sessions.getPendingPairing("1234-5678", Date.now());

      expect(session).toMatchObject({
        clientName: "Intel Mac",
        clientSessionId: "legacy-session",
        expiresAt,
        secureSession: {
          keyEpoch: 7,
          lastMobileCounter: 41,
          nextServerCounter: 42,
        },
      });
      expect(Array.from(session?.secureSession?.mobileToServerKey ?? [])).toEqual([1, 2, 3]);
      expect(Array.from(session?.secureSession?.serverToMobileKey ?? [])).toEqual([4, 5, 6]);
      expect(pending).toEqual({
        approvalCode: "1234-5678",
        approved: false,
        clientEphemeralPublicKey: "public-key",
        clientName: "Phone",
        clientNonce: "nonce",
        clientSessionId: "pending-session",
        expiresAt,
        serverUrl: "http://127.0.0.1:8787",
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("writes session updates back to an existing SQLite auth database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-relay-legacy-auth-"));
    const path = join(directory, "auth.db");
    createLegacyAuthDatabase(path, Date.UTC(2099, 0, 1));

    try {
      const sessions = await createTursoPairingSessionStore(path);

      await sessions.updateSecureSession("legacy-token", {
        keyEpoch: 8,
        lastMobileCounter: 43,
        mobileToServerKey: Uint8Array.from([7, 8, 9]),
        nextServerCounter: 44,
        serverToMobileKey: Uint8Array.from([10, 11, 12]),
      });
      await sessions.approvePendingPairing("1234-5678", Date.now());

      const database = new DatabaseSync(path, { readOnly: true });
      const storedSession = database
        .prepare(
          `SELECT key_epoch, mobile_to_server_key, server_to_mobile_key,
                  last_mobile_counter, next_server_counter
           FROM pairing_sessions
           WHERE token_hash = ?`,
        )
        .get("legacy-token");
      const storedPending = database
        .prepare("SELECT approved FROM pending_pairings WHERE approval_code = ?")
        .get("1234-5678");
      database.close();

      expect(storedSession).toEqual({
        key_epoch: 8,
        last_mobile_counter: 43,
        mobile_to_server_key: "BwgJ",
        next_server_counter: 44,
        server_to_mobile_key: "CgsM",
      });
      expect(storedPending).toEqual({ approved: 1 });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reads a live WAL database from a path containing URL-reserved characters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-relay-auth #"));
    const path = join(directory, "auth #1.db");
    const expiresAt = Date.UTC(2099, 0, 1);
    const database = createLegacyAuthDatabase(path, expiresAt, { journalMode: "WAL" });

    try {
      expect(database.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
      const sessions = await createTursoPairingSessionStore(path);

      expect(await sessions.getValidSession("legacy-token", Date.now())).toMatchObject({
        clientName: "Intel Mac",
        expiresAt,
      });
      await sessions.updateSecureSession("legacy-token", {
        keyEpoch: 9,
        lastMobileCounter: 45,
        mobileToServerKey: Uint8Array.from([13, 14, 15]),
        nextServerCounter: 46,
        serverToMobileKey: Uint8Array.from([16, 17, 18]),
      });
      expect(
        database
          .prepare(
            "SELECT key_epoch, last_mobile_counter FROM pairing_sessions WHERE token_hash = ?",
          )
          .get("legacy-token"),
      ).toEqual({ key_epoch: 9, last_mobile_counter: 45 });
    } finally {
      database.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function createLegacyAuthDatabase(
  path: string,
  expiresAt: number,
  options: { journalMode?: "WAL" } = {},
) {
  const database = new DatabaseSync(path);
  if (options.journalMode) {
    database.exec(`PRAGMA journal_mode = ${options.journalMode}`);
  }
  database.exec(`
    CREATE TABLE pairing_sessions (
      token_hash TEXT PRIMARY KEY,
      client_session_id TEXT,
      client_name TEXT,
      expires_at INTEGER NOT NULL,
      key_epoch INTEGER,
      mobile_to_server_key TEXT,
      server_to_mobile_key TEXT,
      last_mobile_counter INTEGER,
      next_server_counter INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE pending_pairings (
      approval_code TEXT PRIMARY KEY,
      client_session_id TEXT,
      client_name TEXT,
      client_ephemeral_public_key TEXT NOT NULL,
      client_nonce TEXT NOT NULL,
      server_url TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database
    .prepare(
      `INSERT INTO pairing_sessions (
         token_hash, client_session_id, client_name, expires_at, key_epoch,
         mobile_to_server_key, server_to_mobile_key, last_mobile_counter,
         next_server_counter, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("legacy-token", "legacy-session", "Intel Mac", expiresAt, 7, "AQID", "BAUG", 41, 42, 1, 1);
  database
    .prepare(
      `INSERT INTO pending_pairings (
         approval_code, client_session_id, client_name, client_ephemeral_public_key,
         client_nonce, server_url, approved, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "1234-5678",
      "pending-session",
      "Phone",
      "public-key",
      "nonce",
      "http://127.0.0.1:8787",
      0,
      expiresAt,
      1,
      1,
    );
  if (!options.journalMode) {
    database.close();
  }
  return database;
}

function createOldSchemaAuthDatabase(path: string) {
  const expiresAt = Date.UTC(2099, 0, 1);
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE pairing_sessions (
      token_hash TEXT PRIMARY KEY,
      client_name TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE pending_pairings (
      approval_code TEXT PRIMARY KEY,
      client_name TEXT,
      client_ephemeral_public_key TEXT NOT NULL,
      client_nonce TEXT NOT NULL,
      server_url TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database
    .prepare(
      `INSERT INTO pairing_sessions (
         token_hash, client_name, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run("old-schema-token", "Old schema", expiresAt, 1, 1);
  database.close();
}

async function memoryDatabaseEntries() {
  return (await readdir(tmpdir())).filter((entry) => entry.startsWith("codex-relay-memory-"));
}
