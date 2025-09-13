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
  await db
    .collection("sync_meta")
    .updateOne({ collection }, { $set: { lastSync: time } }, { upsert: true });
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
      const localCount = await dbLocal.collection(col).countDocuments({
        $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
      });
      const remoteCount = await dbRemote.collection(col).countDocuments({
        $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
      });

      // Count soft-deleted docs (deletedAt set to a non-null date)
      const localDeleted = await dbLocal
        .collection(col)
        .countDocuments({ deletedAt: { $exists: true, $ne: null } });
      const remoteDeleted = await dbRemote
        .collection(col)
        .countDocuments({ deletedAt: { $exists: true, $ne: null } });
      const meta = await dbLocal
        .collection("sync_meta")
        .findOne({ collection: col });
      result.push({
        collection: col,
        localCount,
        remoteCount,
        localDeleted,
        remoteDeleted,
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

// DELETE /api/sync/purge-deleted
// Hard delete all documents that have a deletedAt flag
exports.purgeDeletedRecords = async (req, res) => {
  const { collection } = req.body; // optional single collection
  let localClient, remoteClient;
  try {
    localClient = await MongoClient.connect(LOCAL_URI);
    remoteClient = await MongoClient.connect(REMOTE_URI);

    const dbLocal = localClient.db(localDbName);
    const dbRemote = remoteClient.db(remoteDbName);

    const collections = collection
      ? [collection]
      : await getUserCollections(dbLocal);

    const result = [];
    for (const col of collections) {
      try {
        const localDelRes = await dbLocal
          .collection(col)
          .deleteMany({ deletedAt: { $exists: true, $ne: null } });
        const remoteDelRes = await dbRemote
          .collection(col)
          .deleteMany({ deletedAt: { $exists: true, $ne: null } });
        result.push({
          collection: col,
          localDeletedRemoved: localDelRes.deletedCount,
          remoteDeletedRemoved: remoteDelRes.deletedCount,
        });
      } catch (err) {
        result.push({
          collection: col,
          error: err.message,
        });
      }
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

        // Local changes: updated recently OR completely absent on remote OR soft deleted
        const localChanges = await dbLocal
          .collection(col)
          .find({
            $or: [
              { updatedAt: { $gt: lastSync } },
              { _id: { $nin: remoteIdsArr } },
              { deletedAt: { $exists: true, $ne: null } }, // Include soft-deleted records
            ],
          })
          .toArray();

        // Remote changes: updated recently OR completely absent on local OR soft deleted
        const remoteChanges = await dbRemote
          .collection(col)
          .find({
            $or: [
              { updatedAt: { $gt: lastSync } },
              { _id: { $nin: localIdsArr } },
              { deletedAt: { $exists: true, $ne: null } }, // Include soft-deleted records
            ],
          })
          .toArray();

        // Additional step: Check for records that exist in both but have different deletion states
        const conflictResolution = [];
        for (const localDoc of localChanges) {
          if (localDoc.deletedAt && localDoc.deletedAt !== null) {
            // Local is soft deleted, check if remote exists and is not deleted
            const remoteDoc = await dbRemote.collection(col).findOne({
              _id: localDoc._id,
              $or: [
                { deletedAt: { $exists: false } },
                { deletedAt: null }
              ]
            });
            if (remoteDoc) {
              conflictResolution.push({
                type: 'local_deleted_remote_exists',
                localDoc,
                remoteDoc
              });
            }
          }
        }

        for (const remoteDoc of remoteChanges) {
          if (remoteDoc.deletedAt && remoteDoc.deletedAt !== null) {
            // Remote is soft deleted, check if local exists and is not deleted
            const localDoc = await dbLocal.collection(col).findOne({
              _id: remoteDoc._id,
              $or: [
                { deletedAt: { $exists: false } },
                { deletedAt: null }
              ]
            });
            if (localDoc) {
              conflictResolution.push({
                type: 'remote_deleted_local_exists',
                localDoc,
                remoteDoc
              });
            }
          }
        }

        // 3. Merge local changes to remote
        for (const doc of localChanges) {
          const naturalKeyFilter =
            col === "attendances"
              ? { user: doc.user, date: doc.date }
              : { _id: doc._id };

          const remoteDoc = await dbRemote
            .collection(col)
            .findOne(naturalKeyFilter);

          const { _id, ...docWithoutId } = doc;
          const docUpdatedAt = doc.updatedAt ? new Date(doc.updatedAt) : null;
          const remoteUpdatedAt = remoteDoc?.updatedAt
            ? new Date(remoteDoc.updatedAt)
            : null;

          // Handle soft deletes - if local doc is soft deleted, soft delete remote too
          if (doc.deletedAt && doc.deletedAt !== null) {
            // Always soft delete remote if local is soft deleted, regardless of remote state
            await dbRemote
              .collection(col)
              .updateOne(naturalKeyFilter, { 
                $set: { 
                  deletedAt: doc.deletedAt,
                  deletedBy: doc.deletedBy,
                  updatedAt: doc.updatedAt || new Date()
                } 
              }, { upsert: true });
          } else if (!remoteDoc || (docUpdatedAt && (!remoteUpdatedAt || docUpdatedAt > remoteUpdatedAt))) {
            // Only update if not soft deleted and remote is not soft deleted
            if (!remoteDoc || !remoteDoc.deletedAt) {
              await dbRemote
                .collection(col)
                .updateOne(naturalKeyFilter, { $set: docWithoutId }, { upsert: true });
            }
          }
        }

        // 4. Merge remote changes to local
        for (const doc of remoteChanges) {
          const naturalKeyFilter =
            col === "attendances"
              ? { user: doc.user, date: doc.date }
              : { _id: doc._id };

          const localDoc = await dbLocal
            .collection(col)
            .findOne(naturalKeyFilter);

          const { _id, ...docWithoutId } = doc;
          const docUpdatedAt = doc.updatedAt ? new Date(doc.updatedAt) : null;
          const localUpdatedAt = localDoc?.updatedAt
            ? new Date(localDoc.updatedAt)
            : null;

          // Handle soft deletes - if remote doc is soft deleted, soft delete local too
          if (doc.deletedAt && doc.deletedAt !== null) {
            // Always soft delete local if remote is soft deleted, regardless of local state
            await dbLocal
              .collection(col)
              .updateOne(naturalKeyFilter, { 
                $set: { 
                  deletedAt: doc.deletedAt,
                  deletedBy: doc.deletedBy,
                  updatedAt: doc.updatedAt || new Date()
                } 
              }, { upsert: true });
          } else if (!localDoc || (docUpdatedAt && (!localUpdatedAt || docUpdatedAt > localUpdatedAt))) {
            // Only update if not soft deleted and local is not soft deleted
            if (!localDoc || !localDoc.deletedAt) {
              await dbLocal
                .collection(col)
                .updateOne(naturalKeyFilter, { $set: docWithoutId }, { upsert: true });
            }
          }
        }

        // 5. Handle conflict resolution - ensure deleted records stay deleted
        for (const conflict of conflictResolution) {
          if (conflict.type === 'local_deleted_remote_exists') {
            // Local is deleted, remote exists - soft delete remote
            const naturalKeyFilter =
              col === "attendances"
                ? { user: conflict.localDoc.user, date: conflict.localDoc.date }
                : { _id: conflict.localDoc._id };
            
            await dbRemote.collection(col).updateOne(naturalKeyFilter, {
              $set: {
                deletedAt: conflict.localDoc.deletedAt,
                deletedBy: conflict.localDoc.deletedBy,
                updatedAt: conflict.localDoc.updatedAt || new Date()
              }
            });
          } else if (conflict.type === 'remote_deleted_local_exists') {
            // Remote is deleted, local exists - soft delete local
            const naturalKeyFilter =
              col === "attendances"
                ? { user: conflict.remoteDoc.user, date: conflict.remoteDoc.date }
                : { _id: conflict.remoteDoc._id };
            
            await dbLocal.collection(col).updateOne(naturalKeyFilter, {
              $set: {
                deletedAt: conflict.remoteDoc.deletedAt,
                deletedBy: conflict.remoteDoc.deletedBy,
                updatedAt: conflict.remoteDoc.updatedAt || new Date()
              }
            });
          }
        }

        // 6. Return updated counts *before* deciding whether to persist the new lastSync
        const activeFilter = {
          $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
        };
        const localCount = await dbLocal
          .collection(col)
          .countDocuments(activeFilter);
        const remoteCount = await dbRemote
          .collection(col)
          .countDocuments(activeFilter);

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
