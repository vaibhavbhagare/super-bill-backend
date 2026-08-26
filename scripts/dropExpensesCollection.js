/**
 * One-shot: drop the expenses collection from local + remote Mongo DBs.
 * Run from user-crud-api: node scripts/dropExpensesCollection.js
 */
require("dotenv").config();
const { MongoClient } = require("mongodb");

async function dropExpenses(uri, label) {
  if (!uri) {
    console.log(`[${label}] skipped — no URI`);
    return { skipped: true };
  }
  const client = new MongoClient(uri);
  try {
    await client.connect();
    // Prefer explicit DB name; fall back to URI path / default
    const dbName =
      (label === "local"
        ? process.env.LOCAL_DB_NAME
        : process.env.REMOTE_DB_NAME) ||
      process.env.DB_NAME ||
      undefined;
    const db = dbName ? client.db(dbName) : client.db();
    const exists = await db.listCollections({ name: "expenses" }).hasNext();
    if (!exists) {
      console.log(`[${label}] expenses collection not found (${db.databaseName})`);
      return { dropped: false, db: db.databaseName };
    }
    await db.collection("expenses").drop();
    // Clear sync_meta / sync_deletions entries for expenses
    await db.collection("sync_meta").deleteMany({ collection: "expenses" });
    await db.collection("sync_deletions").deleteMany({ collection: "expenses" });
    console.log(`[${label}] dropped expenses + sync meta (${db.databaseName})`);
    return { dropped: true, db: db.databaseName };
  } finally {
    await client.close();
  }
}

(async () => {
  const localUri = process.env.LOCAL_MONGO_URI || process.env.MONGO_URI;
  const remoteUri = process.env.REMOTE_MONGO_URI || process.env.PROD_MONGO_URI;
  const results = {
    local: await dropExpenses(localUri, "local"),
    remote: await dropExpenses(remoteUri, "remote"),
  };
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
