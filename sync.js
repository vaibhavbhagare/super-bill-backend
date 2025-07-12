// MongoDB sync script
const { MongoClient } = require("mongodb");
require("dotenv").config();
const { ObjectId } = require("mongodb");
const { markDocumentAsSynced } = require("./services/syncService");
const localUri = process.env.LOCAL_MONGO_URI;
const remoteUri = process.env.REMOTE_MONGO_URI;
const localDbName = process.env.LOCAL_DB_NAME;
const remoteDbName = process.env.REMOTE_DB_NAME;

async function syncDatabases() {
  const localClient = new MongoClient(localUri);
  const remoteClient = new MongoClient(remoteUri);

  let newlySynced = 0;
  let totalProcessed = 0;

  try {
    console.log("Connecting to local and remote databases...");
    await localClient.connect();
    await remoteClient.connect();
    console.log("Connected to both databases.");

    const localDb = localClient.db(localDbName);
    const remoteDb = remoteClient.db(remoteDbName);

    console.log("Listing collections in localDB...");
    const collectionNames = await localDb.listCollections().toArray();
    console.log(`Found ${collectionNames.length} collections.`);

    for (const { name } of collectionNames) {
      console.log(`\nSyncing collection: ${name}`);
      const localCol = localDb.collection(name);
      const remoteCol = remoteDb.collection(name);

      // 1. Remote → Local (sync remote docs into local first)
      const remoteDocs = await remoteCol.find({}).toArray();
      console.log(
        `Found ${remoteDocs.length} documents in remote collection '${name}'.`,
      );
      let remoteToLocalCount = 0;
      for (const doc of remoteDocs) {
        await localCol.updateOne(
          { _id: doc._id },
          { $set: doc },
          { upsert: true },
        );
        remoteToLocalCount++;
        if (remoteToLocalCount % 100 === 0) {
          console.log(
            `  [Remote→Local] Synced ${remoteToLocalCount} documents in '${name}' so far...`,
          );
        }
      }
      console.log(
        `[Remote→Local] Finished syncing collection '${name}'. Total documents synced: ${remoteToLocalCount}`,
      );

      // 2. Local → Remote (then push local docs to remote)
      const localDocs = await localCol.find().toArray();
      totalProcessed += localDocs.length;
      console.log(
        `Found ${localDocs.length} unsynced documents in local collection '${name}'.`,
      );
      let localToRemoteCount = 0;
      for (const doc of localDocs) {
        // //update isSynced as true
        // await markDocumentAsSynced(name, doc._id);

        await remoteCol.updateOne(
          { _id: doc._id },
          { $set: doc },
          { upsert: true },
        );
        // Only count as newly synced if was not already synced
        if (doc.isSynced === false) {
          newlySynced++;
        }

        localToRemoteCount++;
        if (localToRemoteCount % 100 === 0) {
          console.log(
            `  [Local→Remote] Synced ${localToRemoteCount} documents in '${name}' so far...`,
          );
        }
      }
      console.log(
        `[Local→Remote] Finished syncing collection '${name}'. Total documents synced: ${localToRemoteCount}`,
      );
    }

    console.log("\nTwo-way sync complete");
    return { newlySynced, totalProcessed };
  } catch (err) {
    console.error("Sync error:", err);
    throw err;
  } finally {
    console.log("Closing database connections...");
    await localClient.close();
    await remoteClient.close();
    console.log("Connections closed.");
  }
}

module.exports = { syncDatabases };
