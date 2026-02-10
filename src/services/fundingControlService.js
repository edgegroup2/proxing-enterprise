let runtimeApproval = false;

function isEnvEnabled() {
  return process.env.ENABLE_AUTO_FUNDING === "true";
}

async function setFundingApproval(value) {
  runtimeApproval = Boolean(value);
}

async function isFundingApproved() {
  return isEnvEnabled() && runtimeApproval;
}

module.exports = {
  setFundingApproval,
  isFundingApproved,
};
