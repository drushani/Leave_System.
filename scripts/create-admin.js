// One-off CLI script to create (or reset) an admin account.
// Run this once on the server to bootstrap the very first admin,
// since the app no longer has a public self-registration page.
//
// Usage:
//   node scripts/create-admin.js <username> <password> <name>
//
// Example:
//   node scripts/create-admin.js admin "a-strong-password" "系統管理員"

const path = require("path");
const bcrypt = require("bcryptjs");
const db = require("../db");

const [, , username, password, ...nameParts] = process.argv;
const name = nameParts.join(" ");                                 // 把後面輸入的名字若有輸入到空格則連起來

if (!username || !password || !name) {
  console.error("用法：node scripts/create-admin.js <帳號> <密碼> <姓名>");
  process.exit(1);
}
if (password.length < 4) {
  console.error("密碼至少需要 4 個字元");
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(password, 10);
const existing = db.prepare("SELECT username FROM users WHERE username = ?").get(username);

if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, name = ?, role = 'admin' WHERE username = ?").run(
    passwordHash,
    name,
    username
  );
  console.log(`已將既有帳號 "${username}" 更新為管理員，並重設密碼。`);
} else {
  db.prepare(
    "INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, 'admin')"
  ).run(username, name, passwordHash);
  console.log(`已建立管理員帳號 "${username}"。`);
}
