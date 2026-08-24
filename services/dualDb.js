const { MongoClient } = require("mongodb");

const LOCAL_URI = process.env.LOCAL_MONGO_URI;
const REMOTE_URI = process.env.REMOTE_MONGO_URI;
const localDbName = process.env.LOCAL_DB_NAME;
const remoteDbName = process.env.REMOTE_DB_NAME;

let localClient;
let remoteClient;

const isLocalDevApi =
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV === "local" ||
  process.env.NODE_ENV === "dev";

function canUseDualDb() {
  return Boolean(
    isLocalDevApi && LOCAL_URI && REMOTE_URI && localDbName && remoteDbName,
  );
}

function logRemote(event, details) {
  const extra = details ? ` | ${details}` : "";
  console.log(`[Sync][RemoteDB] ${event}${extra}`);
}

function isClientConnected(client) {
  if (!client) return false;
  try {
    return Boolean(client.topology && client.topology.isConnected());
  } catch {
    return false;
  }
}

async function closeRemoteClient() {
  const client = remoteClient;
  remoteClient = null;
  if (!client) return;
  try {
    await client.close(true);
  } catch (err) {
    logRemote("close_error", err.message);
  }
}

async function connectLocal() {
  if (isClientConnected(localClient)) return;
  if (localClient) {
    try {
      await localClient.close(true);
    } catch {
      // ignore stale local close errors
    }
    localClient = null;
  }
  localClient = await MongoClient.connect(LOCAL_URI, {
    serverSelectionTimeoutMS: 5000,
  });
}

async function connectRemoteOnce() {
  await closeRemoteClient();
  remoteClient = await MongoClient.connect(REMOTE_URI, {
    serverSelectionTimeoutMS: 8000,
  });
}

function wrapConnectError(err) {
  if (err && (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND")) {
    return new Error(
      "Unable to connect to remote MongoDB. Please check internet connection and REMOTE_MONGO_URI.",
    );
  }
  if (err && err.name === "MongoServerSelectionError") {
    return new Error(
      "MongoDB server selection failed. Remote cluster may be unreachable or blocked.",
    );
  }
  return err;
}

/**
 * Shared local + remote MongoDB handles used by sync and permanent delete.
 * Only available on the desktop/local API (NODE_ENV development/local/dev).
 * Does not ping the remote cluster; connects only when no client exists.
 */
async function getDatabases() {
  if (!canUseDualDb()) {
    throw new Error(
      "Dual-database sync is only available on the local desktop API.",
    );
  }

  try {
    await connectLocal();
    if (!isClientConnected(remoteClient)) {
      await connectRemoteOnce();
    }
  } catch (err) {
    throw wrapConnectError(err);
  }

  const dbLocal = localClient.db(localDbName);
  const dbRemote = remoteClient.db(remoteDbName);

  if (!dbLocal || !dbRemote) {
    throw new Error("Database connection could not be initialized");
  }

  return { dbLocal, dbRemote };
}

/**
 * Called only at the start of the Sync API: if remote is down, try to
 * connect twice, then fail with an error. No continuous ping.
 */
async function ensureRemoteForSync() {
  await connectLocal();

  if (isClientConnected(remoteClient)) {
    logRemote("connection_ok", "remote database already connected");
    return {
      dbLocal: localClient.db(localDbName),
      dbRemote: remoteClient.db(remoteDbName),
    };
  }

  logRemote("disconnected", "remote database is not connected");

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      logRemote("reconnect_attempt", `${attempt}/2`);
      await connectRemoteOnce();
      logRemote("reconnected", "connection restored");
      return {
        dbLocal: localClient.db(localDbName),
        dbRemote: remoteClient.db(remoteDbName),
      };
    } catch (err) {
      lastError = wrapConnectError(err);
      logRemote("reconnect_failed", `attempt ${attempt}/2: ${lastError.message}`);
      await closeRemoteClient();
    }
  }

  const wrapped = new Error(
    lastError?.message ||
      "Unable to connect to remote MongoDB after 2 attempts.",
  );
  wrapped.code = "REMOTE_DB_UNAVAILABLE";
  throw wrapped;
}

/**
 * Best-effort dual DB access. Returns null sides when dual DB is unavailable
 * (production/web API) instead of failing.
 */
async function tryGetDatabases() {
  if (!canUseDualDb()) {
    return { dbLocal: null, dbRemote: null, skipped: true };
  }
  try {
    return await getDatabases();
  } catch (err) {
    console.warn("Dual DB unavailable:", err.message);
    return { dbLocal: null, dbRemote: null, error: err };
  }
}

module.exports = {
  getDatabases,
  tryGetDatabases,
  ensureRemoteForSync,
  canUseDualDb,
  isLocalDevApi,
};
