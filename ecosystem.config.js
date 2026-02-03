module.exports = {
  apps: [
    {
      name: "proxing-api",
      script: "server.js",
      cwd: "/root/proxing-enterprise",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
