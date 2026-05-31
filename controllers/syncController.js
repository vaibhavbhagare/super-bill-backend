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

// Maintain shared MongoDB clients so that if a connection does not exist
// during a sync request, it can be (re)initialized lazily here.
let localClient;
let remoteClient;

async function getDatabases() {
  if (!LOCAL_URI || !REMOTE_URI || !localDbName || !remoteDbName) {
    throw new Error("Database connection configuration is missing");
  }

  try {
    // Lazily initiate clients if they don't exist yet
    if (!localClient) {
      localClient = await MongoClient.connect(LOCAL_URI);
    }
    if (!remoteClient) {
      remoteClient = await MongoClient.connect(REMOTE_URI);
    }
  } catch (err) {
    // Normalize connection-related errors into a clearer message for the API
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

// Helper: natural key per collection for matching documents across databases
function getNaturalKeyFilter(collectionName, doc) {
  if (collectionName === "attendances") {
    const dateVal = doc?.date ? new Date(doc.date) : null;
    if (dateVal && !isNaN(dateVal.getTime())) {
      // Match any document for the same user on the same calendar day
      const startOfDay = new Date(
        dateVal.getFullYear(),
        dateVal.getMonth(),
        dateVal.getDate(),
        0,
        0,
        0,
        0,
      );
      const endOfDay = new Date(
        dateVal.getFullYear(),
        dateVal.getMonth(),
        dateVal.getDate() + 1,
        0,
        0,
        0,
        0,
      );
      return { user: doc.user, date: { $gte: startOfDay, $lt: endOfDay } };
    }
    // Fallback if date is missing/unparseable
    return { user: doc.user, date: doc.date };
  }
  // productstats has a unique index on `product`, so use that as the natural key
  if (collectionName === "productstats") {
    return { product: doc.product };
  }
  return { _id: doc._id };
}

// Helper: build a stable natural key string for full reconciliation
function buildNaturalKeyString(collectionName, doc) {
  if (collectionName === "attendances") {
    const dateVal = doc?.date ? new Date(doc.date) : null;
    if (dateVal && !isNaN(dateVal.getTime())) {
      const startOfDay = new Date(
        dateVal.getFullYear(),
        dateVal.getMonth(),
        dateVal.getDate(),
        0,
        0,
        0,
        0,
      );
      return `${doc.user || ""}::${startOfDay.toISOString()}`;
    }
    return `${doc.user || ""}::${doc.date || ""}`;
  }
  if (collectionName === "productstats") {
    return `product::${doc.product || ""}`;
  }
  return String(doc._id);
}

// Helper: full reconciliation for collections that rely heavily on natural keys
async function fullSyncByNaturalKey(collectionName, dbLocal, dbRemote) {
  const [localAll, remoteAll] = await Promise.all([
    dbLocal.collection(collectionName).find({}).toArray(),
    dbRemote.collection(collectionName).find({}).toArray(),
  ]);

  const toMap = (docs) => {
    const map = new Map();
    for (const doc of docs) {
      const key = buildNaturalKeyString(collectionName, doc);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, doc);
      } else {
        const existingUpdated =
          existing.updatedAt || existing.createdAt || new Date(0);
        const docUpdated = doc.updatedAt || doc.createdAt || new Date(0);
        if (new Date(docUpdated) > new Date(existingUpdated)) {
          map.set(key, doc);
        }
      }
    }
    return map;
  };

  const localMap = toMap(localAll);
  const remoteMap = toMap(remoteAll);

  const allKeys = new Set([
    ...Array.from(localMap.keys()),
    ...Array.from(remoteMap.keys()),
  ]);

  for (const key of allKeys) {
    const localDoc = localMap.get(key) || null;
    const remoteDoc = remoteMap.get(key) || null;

    let winner = localDoc || remoteDoc;
    if (localDoc && remoteDoc) {
      const localDeleted = !!(localDoc.deletedAt && localDoc.deletedAt !== null);
      const remoteDeleted = !!(
        remoteDoc.deletedAt && remoteDoc.deletedAt !== null
      );

      if (localDeleted || remoteDeleted) {
        winner = localDeleted ? localDoc : remoteDoc;
      } else {
        const localUpdated = localDoc.updatedAt || localDoc.createdAt || new Date(0);
        const remoteUpdated =
          remoteDoc.updatedAt || remoteDoc.createdAt || new Date(0);
        winner =
          new Date(remoteUpdated) > new Date(localUpdated) ? remoteDoc : localDoc;
      }
    }

    if (!winner) continue;

    const naturalKeyFilter = getNaturalKeyFilter(collectionName, winner);
    const { _id, ...docWithoutId } = winner;

    await Promise.all([
      dbLocal
        .collection(collectionName)
        .updateOne(naturalKeyFilter, { $set: docWithoutId }, { upsert: true }),
      dbRemote
        .collection(collectionName)
        .updateOne(naturalKeyFilter, { $set: docWithoutId }, { upsert: true }),
    ]);
  }

  const activeFilter = {
    $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
  };
  const [localCount, remoteCount] = await Promise.all([
    dbLocal.collection(collectionName).countDocuments(activeFilter),
    dbRemote.collection(collectionName).countDocuments(activeFilter),
  ]);

  const now = new Date();
  await Promise.all([
    setLastSync(dbLocal, collectionName, now),
    setLastSync(dbRemote, collectionName, now),
  ]);

  return { localCount, remoteCount, lastSync: now };
}

// GET /api/sync/status
exports.getSyncStatus = async (req, res) => {
  try {
    const { dbLocal, dbRemote } = await getDatabases();

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
  }
};

// DELETE /api/sync/purge-deleted
// Hard delete all documents that have a deletedAt flag
exports.purgeDeletedRecords = async (req, res) => {
  const { collection } = req.body; // optional single collection
  try {
    const { dbLocal, dbRemote } = await getDatabases();

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
  }
};

// // POST /api/sync
// exports.syncCollections = async (req, res) => {
//   const { collection } = req.body;
//   try {
//     const { dbLocal, dbRemote } = await getDatabases();

//     // Get collections to sync
//     let collections = [];
//     if (collection) {
//       collections = [collection];
//     } else {
//       collections = await getUserCollections(dbLocal);
//     }

//     const results = [];
//     for (const col of collections) {
//       try {
//         // For attendances and productstats, do a stronger full reconciliation using natural keys.
//         if (["attendances", "productstats"].includes(col)) {
//           const { localCount, remoteCount, lastSync } = await syncForMultipleLocals(
//             col,
//             dbLocal,
//             dbRemote,
//           );
//           results.push({
//             collection: col,
//             localCount,
//             remoteCount,
//             lastSync,
//           });
//           continue;
//         }

//         // 1. Get last sync time
//         const lastSync = await getLastSync(dbLocal, col);

//         // 2. Get changes since last sync **and** any docs that are missing on the opposite side.
//         //    This guarantees we also catch documents that existed *before* lastSync but failed to
//         //    sync for some reason (the root cause of the empty change sets you observed).

//         // Fetch just the _ids to build quick lookup sets (memory-efficient for typical collection sizes).
//         const remoteIdsArr = await dbRemote.collection(col).distinct("_id");
//         const localIdsArr = await dbLocal.collection(col).distinct("_id");

//         // Local changes: updated recently OR completely absent on remote OR soft deleted
//         const localChanges = await dbLocal
//           .collection(col)
//           .find({
//             $or: [
//               { updatedAt: { $gt: lastSync } },
//               { _id: { $nin: remoteIdsArr } },
//               { deletedAt: { $exists: true, $ne: null } }, // Include soft-deleted records
//             ],
//           })
//           .toArray();

//         // Remote changes: updated recently OR completely absent on local OR soft deleted
//         const remoteChanges = await dbRemote
//           .collection(col)
//           .find({
//             $or: [
//               { updatedAt: { $gt: lastSync } },
//               { _id: { $nin: localIdsArr } },
//               { deletedAt: { $exists: true, $ne: null } }, // Include soft-deleted records
//             ],
//           })
//           .toArray();

//         // Additional step: Check for records that exist in both but have different deletion states
//         const conflictResolution = [];
//         for (const localDoc of localChanges) {
//           if (localDoc.deletedAt && localDoc.deletedAt !== null) {
//             // Local is soft deleted, check if remote exists and is not deleted
//             const naturalKeyFilter = getNaturalKeyFilter(col, localDoc);
//             const remoteDoc = await dbRemote.collection(col).findOne({
//               ...naturalKeyFilter,
//               $or: [
//                 { deletedAt: { $exists: false } },
//                 { deletedAt: null }
//               ]
//             });
//             if (remoteDoc) {
//               conflictResolution.push({
//                 type: 'local_deleted_remote_exists',
//                 localDoc,
//                 remoteDoc
//               });
//             }
//           }
//         }

//         for (const remoteDoc of remoteChanges) {
//           if (remoteDoc.deletedAt && remoteDoc.deletedAt !== null) {
//             // Remote is soft deleted, check if local exists and is not deleted
//             const naturalKeyFilter = getNaturalKeyFilter(col, remoteDoc);
//             const localDoc = await dbLocal.collection(col).findOne({
//               ...naturalKeyFilter,
//               $or: [
//                 { deletedAt: { $exists: false } },
//                 { deletedAt: null }
//               ]
//             });
//             if (localDoc) {
//               conflictResolution.push({
//                 type: 'remote_deleted_local_exists',
//                 localDoc,
//                 remoteDoc
//               });
//             }
//           }
//         }

//         // 3. Merge local changes to remote
//         for (const doc of localChanges) {
//           const naturalKeyFilter = getNaturalKeyFilter(col, doc);

//           const remoteDoc = await dbRemote
//             .collection(col)
//             .findOne(naturalKeyFilter);

//           const { _id, ...docWithoutId } = doc;
//           const docUpdatedAt = doc.updatedAt ? new Date(doc.updatedAt) : null;
//           const remoteUpdatedAt = remoteDoc?.updatedAt
//             ? new Date(remoteDoc.updatedAt)
//             : null;

//           // Handle soft deletes - if local doc is soft deleted, soft delete remote too
//           if (doc.deletedAt && doc.deletedAt !== null) {
//             // Always soft delete remote if local is soft deleted, regardless of remote state
//             await dbRemote
//               .collection(col)
//               .updateOne(naturalKeyFilter, { 
//                 $set: { 
//                   deletedAt: doc.deletedAt,
//                   deletedBy: doc.deletedBy,
//                   updatedAt: doc.updatedAt || new Date()
//                 } 
//               }, { upsert: true });
//           } else if (!remoteDoc || (docUpdatedAt && (!remoteUpdatedAt || docUpdatedAt > remoteUpdatedAt))) {
//             // Only update if not soft deleted and remote is not soft deleted
//             if (!remoteDoc || !remoteDoc.deletedAt) {
//               await dbRemote
//                 .collection(col)
//                 .updateOne(naturalKeyFilter, { $set: docWithoutId }, { upsert: true });
//             }
//           }
//         }

//         // 4. Merge remote changes to local
//         for (const doc of remoteChanges) {
//           const naturalKeyFilter = getNaturalKeyFilter(col, doc);

//           const localDoc = await dbLocal
//             .collection(col)
//             .findOne(naturalKeyFilter);

//           const { _id, ...docWithoutId } = doc;
//           const docUpdatedAt = doc.updatedAt ? new Date(doc.updatedAt) : null;
//           const localUpdatedAt = localDoc?.updatedAt
//             ? new Date(localDoc.updatedAt)
//             : null;

//           // Handle soft deletes - if remote doc is soft deleted, soft delete local too
//           if (doc.deletedAt && doc.deletedAt !== null) {
//             // Always soft delete local if remote is soft deleted, regardless of local state
//             await dbLocal
//               .collection(col)
//               .updateOne(naturalKeyFilter, { 
//                 $set: { 
//                   deletedAt: doc.deletedAt,
//                   deletedBy: doc.deletedBy,
//                   updatedAt: doc.updatedAt || new Date()
//                 } 
//               }, { upsert: true });
//           } else if (!localDoc || (docUpdatedAt && (!localUpdatedAt || docUpdatedAt > localUpdatedAt))) {
//             // Only update if not soft deleted and local is not soft deleted
//             if (!localDoc || !localDoc.deletedAt) {
//               await dbLocal
//                 .collection(col)
//                 .updateOne(naturalKeyFilter, { $set: docWithoutId }, { upsert: true });
//             }
//           }
//         }

//         // 5. Handle conflict resolution - ensure deleted records stay deleted
//         for (const conflict of conflictResolution) {
//           if (conflict.type === 'local_deleted_remote_exists') {
//             // Local is deleted, remote exists - soft delete remote
//             const naturalKeyFilter = getNaturalKeyFilter(col, conflict.localDoc);
            
//             await dbRemote.collection(col).updateOne(naturalKeyFilter, {
//               $set: {
//                 deletedAt: conflict.localDoc.deletedAt,
//                 deletedBy: conflict.localDoc.deletedBy,
//                 updatedAt: conflict.localDoc.updatedAt || new Date()
//               }
//             });
//           } else if (conflict.type === 'remote_deleted_local_exists') {
//             // Remote is deleted, local exists - soft delete local
//             const naturalKeyFilter = getNaturalKeyFilter(col, conflict.remoteDoc);
            
//             await dbLocal.collection(col).updateOne(naturalKeyFilter, {
//               $set: {
//                 deletedAt: conflict.remoteDoc.deletedAt,
//                 deletedBy: conflict.remoteDoc.deletedBy,
//                 updatedAt: conflict.remoteDoc.updatedAt || new Date()
//               }
//             });
//           }
//         }

//         // 6. Return updated counts *before* deciding whether to persist the new lastSync
//         const activeFilter = {
//           $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
//         };
//         const localCount = await dbLocal
//           .collection(col)
//           .countDocuments(activeFilter);
//         const remoteCount = await dbRemote
//           .collection(col)
//           .countDocuments(activeFilter);

//         // 7. Only advance the lastSync timestamp if the two collections are now in sync.
//         //    This avoids skipping documents whose `updatedAt` precedes an erroneously
//         //    recorded `lastSync` (the main reason `localChanges` / `remoteChanges` were empty).
//         let now = null;
//         if (localCount === remoteCount) {
//           now = new Date();
//           await setLastSync(dbLocal, col, now);
//           await setLastSync(dbRemote, col, now);
//         }

//         results.push({
//           collection: col,
//           localCount,
//           remoteCount,
//           lastSync: now, // may be null if collections still differ
//         });
//       } catch (err) {
//         results.push({
//           collection: col,
//           error: err.message,
//         });
//       }
//     }
//     res.json(results);
//   } catch (err) {
//     res.status(500).json({ message: err.message });
//   }
// };


// POST /api/sync
exports.syncCollections = async (req, res) => {
  const { collection } = req.body;
  try {
    const { dbLocal, dbRemote } = await getDatabases();
    let collections = collection ? [collection] : await getUserCollections(dbLocal);
    const results = [];

    for (const col of collections) {
      try {
        if (["attendances", "productstats"].includes(col)) {
          const { localCount, remoteCount, lastSync } =
            await fullSyncByNaturalKey(col, dbLocal, dbRemote);
          results.push({ collection: col, localCount, remoteCount, lastSync });
          continue;
        }

        const lastSync = await getLastSync(dbLocal, col);
        const now = new Date();

        const remoteIdsArr = await dbRemote.collection(col).distinct("_id");
        const localIdsArr = await dbLocal.collection(col).distinct("_id");

        const remoteChanges = await dbRemote
          .collection(col)
          .find({
            $or: [
              { updatedAt: { $gt: lastSync } },
              { _id: { $nin: localIdsArr } },
              { deletedAt: { $exists: true, $ne: null } },
            ],
          })
          .toArray();

        for (const remoteDoc of remoteChanges) {
          const filter = getNaturalKeyFilter(col, remoteDoc);
          const localDoc = await dbLocal.collection(col).findOne(filter);
          const { _id, ...remoteDataWithoutId } = remoteDoc;

          if (remoteDoc.deletedAt) {
            await dbLocal.collection(col).updateOne(
              filter,
              { $set: { deletedAt: remoteDoc.deletedAt, updatedAt: now } },
              { upsert: true },
            );
          } else if (
            !localDoc ||
            new Date(remoteDoc.updatedAt || 0) >
              new Date(localDoc.updatedAt || 0)
          ) {
            if (!localDoc || !localDoc.deletedAt) {
              await dbLocal
                .collection(col)
                .updateOne(filter, { $set: remoteDataWithoutId }, { upsert: true });
            }
          }
        }

        const localChanges = await dbLocal
          .collection(col)
          .find({
            $or: [
              { updatedAt: { $gt: lastSync } },
              { _id: { $nin: remoteIdsArr } },
              { deletedAt: { $exists: true, $ne: null } },
            ],
          })
          .toArray();

        for (const localDoc of localChanges) {
          const filter = getNaturalKeyFilter(col, localDoc);
          const remoteDoc = await dbRemote.collection(col).findOne(filter);
          const { _id, ...localDataWithoutId } = localDoc;

          if (localDoc.deletedAt) {
            await dbRemote.collection(col).updateOne(
              filter,
              { $set: { deletedAt: localDoc.deletedAt, updatedAt: now } },
              { upsert: true },
            );
          } else if (
            !remoteDoc ||
            new Date(localDoc.updatedAt || 0) >
              new Date(remoteDoc.updatedAt || 0)
          ) {
            if (!remoteDoc || !remoteDoc.deletedAt) {
              await dbRemote
                .collection(col)
                .updateOne(filter, { $set: localDataWithoutId }, { upsert: true });
            }
          }
        }

        const activeFilter = {
          $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
        };
        const [localCount, remoteCount] = await Promise.all([
          dbLocal.collection(col).countDocuments(activeFilter),
          dbRemote.collection(col).countDocuments(activeFilter),
        ]);

        let syncedAt = null;
        if (localCount === remoteCount) {
          syncedAt = now;
          await setLastSync(dbLocal, col, syncedAt);
        }

        results.push({
          collection: col,
          localCount,
          remoteCount,
          lastSync: syncedAt,
          inSync: localCount === remoteCount,
        });
      } catch (err) {
        results.push({ collection: col, error: err.message });
      }
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Optimized Logic for Multiple Locals
async function syncForMultipleLocals(col, dbLocal, dbRemote) {
  console.log("syncForMultipleLocals")
  const lastSync = await getLastSync(dbLocal, col);
  
  // 1. PULL: Get everything from Prod updated since WE last checked
  const remoteChanges = await dbRemote.collection(col).find({
    updatedAt: { $gt: lastSync }
  }).toArray();

  // 2. MERGE: Apply remote changes to Local first
  for (const doc of remoteChanges) {
    const filter = getNaturalKeyFilter(col, doc);
    const localDoc = await dbLocal.collection(col).findOne(filter);
    
    // Only update local if remote is actually newer
    if (!localDoc || new Date(doc.updatedAt) > new Date(localDoc.updatedAt)) {
      const { _id, ...cleanDoc } = doc;
      await dbLocal.collection(col).updateOne(filter, { $set: cleanDoc }, { upsert: true });
    }
  }

  // 3. PUSH: Now take Local changes and push to Prod
  const localChanges = await dbLocal.collection(col).find({
    updatedAt: { $gt: lastSync }
  }).toArray();

  for (const doc of localChanges) {
    const filter = getNaturalKeyFilter(col, doc);
    const { _id, ...cleanDoc } = doc;
    
    // Use $max on updatedAt to prevent an older local sync from overwriting newer prod data
    await dbRemote.collection(col).updateOne(
      filter, 
      { 
        $set: cleanDoc,
        $setOnInsert: { createdAt: new Date() } 
      }, 
      { upsert: true }
    );
  }
  
  await setLastSync(dbLocal, col, new Date());
}