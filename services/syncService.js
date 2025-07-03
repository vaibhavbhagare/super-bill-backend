const { MongoClient } = require("mongodb");
require("dotenv").config();

const localUri = process.env.LOCAL_MONGO_URI;
const dbName = process.env.LOCAL_DB_NAME || "localDB";
const models = {
  products: require("../models/Product"),
  users: require("../models/User"),
  customers: require("../models/Customer"),
  // add more as needed
};

async function markDocumentAsSynced(collectionName, id) {
  const model = models[collectionName];
  if (model && model.markAsSynced) {
    return model.markAsSynced(id);
  } else {
    throw new Error(`No markAsSynced method for collection: ${collectionName}`);
  }
}

async function getAllUnsyncedCounts() {
  const client = new MongoClient(localUri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collections = await db.listCollections().toArray();
    const result = {};
    for (const { name } of collections) {
      const count = await db
        .collection(name)
        .countDocuments({ isSynced: false });
      result[name] = count;
    }
    return result;
  } finally {
    await client.close();
  }
}

module.exports = { getAllUnsyncedCounts, markDocumentAsSynced };
