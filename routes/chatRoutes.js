const express = require("express");
const router = express.Router();

// execute.js already exports a router
router.use("/execute", require("./chat/execute"));

module.exports = router;
