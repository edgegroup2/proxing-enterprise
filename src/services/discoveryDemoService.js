function getDemoDiscoveryHome() {
  return {
    success: true,
    rails: [
      {
        key: 'featured_services',
        title: 'Featured Services',
        items: [
          { id: 'demo-cleaner-1', title: 'Home Cleaning', category: 'artisan' },
          { id: 'demo-rider-1', title: 'Fast Dispatch Rider', category: 'driver' }
        ]
      },
      {
        key: 'live_market',
        title: 'Marketplace Deals',
        items: [
          { id: 'demo-phone-1', title: 'iPhone 13 Pro', category: 'marketplace' }
        ]
      }
    ]
  };
}

module.exports = { getDemoDiscoveryHome };
