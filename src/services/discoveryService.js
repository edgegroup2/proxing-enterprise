const { getDemoDiscoveryHome } = require('./discoveryDemoService');

async function getDiscoveryHome() {
  const live = await fetchLiveDiscovery();
  if (live && live.rails && live.rails.length) return live;
  return getDemoDiscoveryHome();
}
