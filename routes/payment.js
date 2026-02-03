const express = require("express");
const router = express.Router();

const VtpassController = require("../controllers/VtpassController");

router.post("/airtime", VtpassController.purchase);

module.exports = router;
