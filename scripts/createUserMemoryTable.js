const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

(async () => {
  const db = await open({
    filename: "./middleware.db",
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      label TEXT,
      phone TEXT,
      last_network TEXT,
      last_product TEXT,
      last_amount TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log("user_memory table created");
  process.exit();
})();
