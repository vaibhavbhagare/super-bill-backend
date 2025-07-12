const express = require("express");
const router = express.Router();
const syncController = require("../controllers/syncController");

const { auth } = require("../middleware/auth");
router.use(auth);

router.get("/status", syncController.getSyncStatus);
router.post("/", syncController.syncCollections);

module.exports = router;