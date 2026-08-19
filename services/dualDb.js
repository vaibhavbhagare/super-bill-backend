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

/**
 * Shared local + remote MongoDB handles used by sync and permanent delete.
 * Only available on the desktop/local API (NODE_ENV development/local/dev).
 */
async function getDatabases() {
  if (!canUseDualDb()) {
    throw new Error(
      "Dual-database sync is only available on the local desktop API.",
    );
  }

  try {
    if (!localClient) {
      localClient = await MongoClient.connect(LOCAL_URI, {
        serverSelectionTimeoutMS: 5000,
      });
    }
    if (!remoteClient) {
      remoteClient = await MongoClient.connect(REMOTE_URI, {
        serverSelectionTimeoutMS: 8000,
      });
    }
  } catch (err) {
    if (err && (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND")) {
      throw new Error(
        "Unable to connect to remote MongoDB. Please check internet connection and REMOTE_MONGO_URI.",
      );
    }
    if (err && err.name === "MongoServerSelectionError") {
      throw new Error(
        "MongoDB server selection failed. Remote cluster may be unreachable or blocked.",
      );
    }
    throw err;
  }

  const dbLocal = localClient.db(localDbName);
  const dbRemote = remoteClient.db(remoteDbName);

  if (!dbLocal || !dbRemote) {
    throw new Error("Database connection could not be initialized");
  }

  return { dbLocal, dbRemote };
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
  canUseDualDb,
  isLocalDevApi,
};
