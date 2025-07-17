const { getAllUnsyncedCounts } = require("../services/syncService");

exports.getAllUnsyncedCount = async (req, res) => {
  try {
    const result = await getAllUnsyncedCounts();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get sync status" });
  }
};

// controllers/syncController.js
const { MongoClient } = require("mongodb");

// Configure your local and remote MongoDB URIs
const LOCAL_URI = process.env.LOCAL_MONGO_URI;
const REMOTE_URI = process.env.REMOTE_MONGO_URI;
const localDbName = process.env.LOCAL_DB_NAME;
const remoteDbName = process.env.REMOTE_DB_NAME; // Use your DB name
 
// Helper: get last sync time for a collection
async function getLastSync(db, collection) {
  const meta = await db.collection("sync_meta").findOne({ collection });
  return meta?.lastSync ? new Date(meta.lastSync) : new Date(0);
}

// Helper: set last sync time for a collection
async function setLastSync(db, collection, time) {
  await db.collection("sync_meta").updateOne(
    { collection },
    { $set: { lastSync: time } },
    { upsert: true }
  );
}

// Helper: get all collections except system/meta
async function getUserCollections(db) {
  const all = await db.listCollections().toArray();
  return all
    .map((c) => c.name)
    .filter((name) => !["sync_meta", "system.indexes"].includes(name));
}

// GET /api/sync/status
exports.getSyncStatus = async (req, res) => {
  let localClient, remoteClient;
  try {
    localClient = await MongoClient.connect(LOCAL_URI);
    remoteClient = await MongoClient.connect(REMOTE_URI);

    const dbLocal = localClient.db(localDbName);
    const dbRemote = remoteClient.db(remoteDbName);

    const collections = await getUserCollections(dbLocal);

    const result = [];
    for (const col of collections) {
      const localCount = await dbLocal.collection(col).countDocuments({ deletedAt: { $exists: false } });
      const remoteCount = await dbRemote.collection(col).countDocuments({ deletedAt: { $exists: false } });
      const meta = await dbLocal.collection("sync_meta").findOne({ collection: col });
      result.push({
        collection: col,
        localCount,
        remoteCount,
        lastSync: meta?.lastSync || null,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (localClient) await localClient.close();
    if (remoteClient) await remoteClient.close();
  }
};

// POST /api/sync
exports.syncCollections = async (req, res) => {
  const { collection } = req.body;
  let localClient, remoteClient;
  try {
    localClient = await MongoClient.connect(LOCAL_URI);
    remoteClient = await MongoClient.connect(REMOTE_URI);

    const dbLocal = localClient.db(localDbName);
    const dbRemote = remoteClient.db(remoteDbName);

    // Get collections to sync
    let collections = [];
    if (collection) {
      collections = [collection];
    } else {
      collections = await getUserCollections(dbLocal);
    }

    const results = [];
    for (const col of collections) {
      try {
        // 1. Get last sync time
        const lastSync = await getLastSync(dbLocal, col);

        // 2. Get changes since last sync **and** any docs that are missing on the opposite side.
        //    This guarantees we also catch documents that existed *before* lastSync but failed to
        //    sync for some reason (the root cause of the empty change sets you observed).

        // Fetch just the _ids to build quick lookup sets (memory-efficient for typical collection sizes).
        const remoteIdsArr = await dbRemote.collection(col).distinct("_id");
        const localIdsArr = await dbLocal.collection(col).distinct("_id");

        // Local changes: updated recently OR completely absent on remote.
        const localChanges = await dbLocal
          .collection(col)
          .find({
            $or: [
              { updatedAt: { $gt: lastSync } },
              { _id: { $nin: remoteIdsArr } },
            ],
          })
          .toArray();

        // Remote changes: updated recently OR completely absent on local.
        const remoteChanges = await dbRemote
          .collection(col)
          .find({
            $or: [
              { updatedAt: { $gt: lastSync } },
              { _id: { $nin: localIdsArr } },
            ],
          })
          .toArray();

        // 3. Merge local changes to remote
        for (const doc of localChanges) {
          const remoteDoc = await dbRemote.collection(col).findOne({ _id: doc._id });
          if (!remoteDoc || (doc.updatedAt > remoteDoc.updatedAt)) {
            await dbRemote
              .collection(col)
              .updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
          }
        }

        // 4. Merge remote changes to local
        for (const doc of remoteChanges) {
          const localDoc = await dbLocal.collection(col).findOne({ _id: doc._id });
          if (!localDoc || (doc.updatedAt > localDoc.updatedAt)) {
            await dbLocal
              .collection(col)
              .updateOne({ _id: doc._id }, { $set: doc }, { upsert: true });
          }
        }

        // 5. Optionally, handle deletions (soft delete)
        // Already handled above: if a doc is deleted (has deletedAt), it will be synced

        // 6. Return updated counts *before* deciding whether to persist the new lastSync
        const localCount = await dbLocal.collection(col).countDocuments({ deletedAt: { $exists: false } });
        const remoteCount = await dbRemote.collection(col).countDocuments({ deletedAt: { $exists: false } });

        // 7. Only advance the lastSync timestamp if the two collections are now in sync.
        //    This avoids skipping documents whose `updatedAt` precedes an erroneously
        //    recorded `lastSync` (the main reason `localChanges` / `remoteChanges` were empty).
        let now = null;
        if (localCount === remoteCount) {
          now = new Date();
          await setLastSync(dbLocal, col, now);
          await setLastSync(dbRemote, col, now);
        }

        results.push({
          collection: col,
          localCount,
          remoteCount,
          lastSync: now, // may be null if collections still differ
        });
      } catch (err) {
        results.push({
          collection: col,
          error: err.message,
        });
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  } finally {
    if (localClient) await localClient.close();
    if (remoteClient) await remoteClient.close();
  }
};