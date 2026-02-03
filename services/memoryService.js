const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./db.sqlite");

db.run(`
CREATE TABLE IF NOT EXISTS user_memory (
  user_id TEXT,
  label TEXT,
  phone TEXT,
  network TEXT,
  intent TEXT,
  amount TEXT
)
`);

async function saveMemory(userId, label, phone, network, intent, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      `
      INSERT INTO user_memory 
      (user_id, label, phone, network, intent, amount)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [userId, label, phone, network, intent, amount], // ✅ 6 = 6
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

module.exports = { saveMemory };
