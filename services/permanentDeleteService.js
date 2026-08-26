const mongoose = require("mongoose");
const { ObjectId } = require("mongodb");
const { getDatabases, tryGetDatabases } = require("./dualDb");

const DELETIONS_COLLECTION = "sync_deletions";
const META_COLLECTIONS = new Set([
  "sync_meta",
  "sync_deletions",
  "system.indexes",
]);

/** Live/online-only collections — never local↔remote sync or cross-DB purge. */
const SYNC_EXCLUDED_COLLECTIONS = new Set(["orders", "payments"]);

function isMetaCollection(name) {
  return META_COLLECTIONS.has(name);
}

function isSyncExcludedCollection(name) {
  return SYNC_EXCLUDED_COLLECTIONS.has(String(name || "").toLowerCase());
}

function shouldSkipSyncCollection(name) {
  return isMetaCollection(name) || isSyncExcludedCollection(name);
}

function currentDb() {
  return mongoose.connection?.db || null;
}

function toObjectId(id) {
  if (id == null) return null;
  if (id instanceof ObjectId) return id;
  if (typeof id === "object" && id._id) return toObjectId(id._id);
  const str = String(id);
  if (ObjectId.isValid(str) && String(new ObjectId(str)) === str) {
    return new ObjectId(str);
  }
  return null;
}

function idVariants(id) {
  const oid = toObjectId(id);
  const str = String(id);
  const variants = [str];
  if (oid) variants.push(oid);
  return variants;
}

async function upsertDeletionRecord(db, collection, docId, deletedBy) {
  if (!db) return;
  const now = new Date();
  const docIdStr = String(docId);
  await db.collection(DELETIONS_COLLECTION).updateOne(
    { collection, docId: docIdStr },
    {
      $set: {
        collection,
        docId: docIdStr,
        deletedAt: now,
        deletedBy: deletedBy || "system",
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
}

async function hardDeleteById(db, collection, docId) {
  if (!db) return 0;
  const oid = toObjectId(docId);
  let deleted = 0;
  if (oid) {
    const res = await db.collection(collection).deleteOne({ _id: oid });
    deleted += res.deletedCount || 0;
  }
  const res2 = await db.collection(collection).deleteOne({ _id: String(docId) });
  deleted += res2.deletedCount || 0;
  return deleted;
}

async function isInDeletionLog(dbs, collection, docId) {
  const docIdStr = String(docId);
  const filter = {
    collection,
    $or: [{ docId: docIdStr }, ...idVariants(docId).map((v) => ({ docId: v }))],
  };
  const dbsToCheck = [dbs?.dbLocal, dbs?.dbRemote, currentDb()].filter(Boolean);
  for (const db of dbsToCheck) {
    const found = await db.collection(DELETIONS_COLLECTION).findOne(filter);
    if (found) return true;
  }
  return false;
}

/**
 * On desktop/local API: delete from local + remote.
 * On production/web API: delete only the current Mongo DB (no dual-DB connect).
 */
async function permanentDeleteById(collection, docId, deletedBy = "system") {
  if (!collection || META_COLLECTIONS.has(collection)) {
    throw new Error(`Cannot permanently delete from collection: ${collection}`);
  }
  if (!docId) {
    throw new Error("Document id is required");
  }

  const docIdStr = String(docId);
  const dual = await tryGetDatabases();
  const primary = currentDb();

  await Promise.all([
    upsertDeletionRecord(dual.dbLocal, collection, docIdStr, deletedBy),
    upsertDeletionRecord(dual.dbRemote, collection, docIdStr, deletedBy),
  ]);

  if (primary) {
    await upsertDeletionRecord(primary, collection, docIdStr, deletedBy);
  }

  const [localRemoved, remoteRemoved] = await Promise.all([
    hardDeleteById(dual.dbLocal, collection, docIdStr),
    hardDeleteById(dual.dbRemote, collection, docIdStr),
  ]);

  let primaryRemoved = 0;
  if (primary) {
    primaryRemoved = await hardDeleteById(primary, collection, docIdStr);
  }

  return {
    collection,
    docId: docIdStr,
    localRemoved,
    remoteRemoved,
    primaryRemoved,
    deletedBy,
    deletedAt: new Date(),
  };
}

async function permanentDeleteMany(collection, docIds, deletedBy = "system") {
  const results = [];
  for (const id of docIds) {
    if (!id) continue;
    results.push(await permanentDeleteById(collection, id, deletedBy));
  }
  return results;
}

async function applyDeletionLog(dbLocal, dbRemote) {
  if (!dbLocal || !dbRemote) return { applied: 0 };

  const [localEntries, remoteEntries] = await Promise.all([
    dbLocal.collection(DELETIONS_COLLECTION).find({}).toArray(),
    dbRemote.collection(DELETIONS_COLLECTION).find({}).toArray(),
  ]);

  const byKey = new Map();
  for (const entry of [...localEntries, ...remoteEntries]) {
    if (!entry?.collection || entry.docId == null) continue;
    const key = `${entry.collection}::${String(entry.docId)}`;
    const existing = byKey.get(key);
    if (
      !existing ||
      new Date(entry.deletedAt || 0) > new Date(existing.deletedAt || 0)
    ) {
      byKey.set(key, entry);
    }
  }

  let applied = 0;
  for (const entry of byKey.values()) {
    const collection = entry.collection;
    if (shouldSkipSyncCollection(collection)) continue;
    const docId = String(entry.docId);
    const deletedBy = entry.deletedBy || "system";

    await Promise.all([
      upsertDeletionRecord(dbLocal, collection, docId, deletedBy),
      upsertDeletionRecord(dbRemote, collection, docId, deletedBy),
      hardDeleteById(dbLocal, collection, docId),
      hardDeleteById(dbRemote, collection, docId),
    ]);
    applied += 1;
  }

  return { applied };
}

async function promoteSoftDeleteToPermanent(
  dbLocal,
  dbRemote,
  collection,
  doc,
  deletedBy = "system",
) {
  if (!doc?._id) return;
  const docId = String(doc._id);
  await Promise.all([
    upsertDeletionRecord(dbLocal, collection, docId, deletedBy || doc.deletedBy),
    upsertDeletionRecord(dbRemote, collection, docId, deletedBy || doc.deletedBy),
    hardDeleteById(dbLocal, collection, docId),
    hardDeleteById(dbRemote, collection, docId),
  ]);
}

async function purgeSoftDeletedRecords(collection) {
  const { dbLocal, dbRemote } = await getDatabases();
  const softFilter = { deletedAt: { $exists: true, $ne: null } };

  const collections = collection
    ? [collection]
    : (await dbLocal.listCollections().toArray())
        .map((c) => c.name)
        .filter((name) => !shouldSkipSyncCollection(name));

  if (collection && isSyncExcludedCollection(collection)) {
    return [
      {
        collection,
        skipped: true,
        reason: "ONLINE_ONLY",
        localDeletedRemoved: 0,
        remoteDeletedRemoved: 0,
        idsPurged: 0,
      },
    ];
  }

  const result = [];
  for (const col of collections) {
    try {
      const [localSoft, remoteSoft] = await Promise.all([
        dbLocal
          .collection(col)
          .find(softFilter)
          .project({ _id: 1, deletedBy: 1 })
          .toArray(),
        dbRemote
          .collection(col)
          .find(softFilter)
          .project({ _id: 1, deletedBy: 1 })
          .toArray(),
      ]);

      const idMap = new Map();
      for (const doc of [...localSoft, ...remoteSoft]) {
        idMap.set(String(doc._id), doc.deletedBy || "system");
      }

      let localDeletedRemoved = 0;
      let remoteDeletedRemoved = 0;

      for (const [docId, deletedBy] of idMap.entries()) {
        await Promise.all([
          upsertDeletionRecord(dbLocal, col, docId, deletedBy),
          upsertDeletionRecord(dbRemote, col, docId, deletedBy),
        ]);
        localDeletedRemoved += await hardDeleteById(dbLocal, col, docId);
        remoteDeletedRemoved += await hardDeleteById(dbRemote, col, docId);
      }

      result.push({
        collection: col,
        localDeletedRemoved,
        remoteDeletedRemoved,
        idsPurged: idMap.size,
      });
    } catch (err) {
      result.push({ collection: col, error: err.message });
    }
  }

  return result;
}

module.exports = {
  DELETIONS_COLLECTION,
  META_COLLECTIONS,
  SYNC_EXCLUDED_COLLECTIONS,
  toObjectId,
  permanentDeleteById,
  permanentDeleteMany,
  applyDeletionLog,
  promoteSoftDeleteToPermanent,
  purgeSoftDeletedRecords,
  isInDeletionLog,
  isMetaCollection,
  isSyncExcludedCollection,
  shouldSkipSyncCollection,
  upsertDeletionRecord,
  hardDeleteById,
};
