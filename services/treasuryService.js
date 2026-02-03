const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./db.sqlite");

const MIN_FLOAT = 100000; // ₦100k minimum operating float

function getFloat() {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT balance FROM treasury_wallet WHERE id = 1",
      [],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.balance : 0);
      }
    );
  });
}

function increaseFloat(amount) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE treasury_wallet SET balance = balance + ? WHERE id = 1",
      [amount],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

function decreaseFloat(amount) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE treasury_wallet SET balance = balance - ? WHERE id = 1",
      [amount],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

function getRevenue() {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT balance FROM revenue_wallet WHERE id = 1",
      [],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.balance : 0);
      }
    );
  });
}

function increaseRevenue(amount) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE revenue_wallet SET balance = balance + ? WHERE id = 1",
      [amount],
      err => err ? reject(err) : resolve(true)
    );
  });
}

module.exports = {
  getFloat,
  increaseFloat,
  decreaseFloat,
  getRevenue,
  increaseRevenue,
  MIN_FLOAT
};
