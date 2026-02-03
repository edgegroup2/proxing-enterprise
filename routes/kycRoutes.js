const express = require("express");
const router = express.Router();
const kyc = require("../controllers/kycController");

router.post("/bvn", kyc.submitBVN);

module.exports = router;
