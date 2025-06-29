const express = require("express");
const router = express.Router();
const syncController = require("../controllers/syncController");
const { auth } = require("../middleware/auth");
const { syncDatabases } = require("../sync.js");

// router.use(auth);

router.get("/sync-status/:collection", syncController.getAllUnsyncedCount);

// TODO: Secure this endpoint (admin only!)
router.post("/", async (req, res) => {
  try {
    const syncResult = await syncDatabases();
    res.json({
      message: "Sync complete",
      newlySynced: syncResult.newlySynced,
      totalProcessed: syncResult.totalProcessed,
    });
  } catch (err) {
    res.status(500).json({ error: "Sync failed", details: err.message });
  }
});

module.exports = router;
