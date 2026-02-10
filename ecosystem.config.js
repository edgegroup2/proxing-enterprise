module.exports = {
  apps: [
    {
      name: "proxing-api",
      script: "src/index.js",
      cwd: "/root/proxing-enterprise",
      instances: 1,
      exec_mode: "fork",

      env: {
        // =========================
        // CORE
        // =========================
        PORT: "4000",
        NODE_ENV: "production",

        // =========================
        // GLOBAL SWITCHES
        // =========================
        ENABLE_CRONS: "true",
        ENABLE_AUTO_FUNDING: "false", // start SAFE
        ENABLE_SMS_AI: "true",
        SMS_REPLY_MODE: "silent",

        // =========================
        // VTPASS
        // =========================
        VTPASS_API_KEY: "10cf91a7060a3d566b23ca5af0694ce0",
        VTPASS_PUBLIC_KEY: "PK_2062d008878de081d91907e45ab553d516e1c663c9f",
        VTPASS_SECRET_KEY: "SK_578e52fa85ba30b936b0ddf39f42602c9d548f37ad8",
        VTPASS_BASE_URL: "https://vtpass.com/api",

        VTPASS_MIN_BALANCE: "50000",
        VTPASS_AUTO_FUND_AMOUNT: "100000",

        // =========================
        // MONNIFY
        // =========================
        MONNIFY_API_KEY: "MK_PROD_DUEMAU81T",
        MONNIFY_SECRET_KEY: "5D3DAQJ3QWY5U3UK9PBJN2RFQ1GO",
        MONNIFY_CONTRACT_CODE: "020315760107",
        MONNIFY_WEBHOOK_SECRET: "e42f05d378cdc78781682fa0c5903e606628927e97565bbef582d7",

        // =========================
        // RESERVED ACCOUNT (VTPASS)
        // =========================
        VTPASS_RESERVED_ACCOUNT_NUMBER: "6567667943",
        VTPASS_RESERVED_BANK_CODE: "50515", // Moniepoint
        VTPASS_RESERVED_ACCOUNT_NAME: "Nurudeen Ajibola Alliiyu",

        // =========================
        // SAFETY LIMITS
        // =========================
        VTPASS_DAILY_TRANSFER_LIMIT: "100000",
        VTPASS_MAX_TRANSFERS_PER_DAY: "5",

        // =========================
        // TELEGRAM ALERTS (OPTIONAL)
        // =========================
        TELEGRAM_BOT_TOKEN: "8598775157:AAE5zEUPwtFqiZfdW77_tq3RGmr3-sV0eQ",
        TELEGRAM_CHAT_ID: "@ProxiNGonlineBot"
      }
    }
  ]
};
