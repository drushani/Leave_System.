// 20260817: 新增start_data和end_data兩個欄位
// 20260817: 新增兩欄位attachment_path、attachment_original_name
// 20260817: users 新增 department（部門）、annual_leave_hours（特休總時數）欄位
// 20260817: users 的 role 新增 section_chief（課長）身份
// 20260817: leaves 新增 department 欄位（申請當下的部門快照，方便分部門審核與查詢）
// 20260817: 既有資料庫的「年假」請假紀錄，遷移時全部改成「特休」
// 20260817: 新增 hire_date（到職日），特休天數改成依到職日自動計算，不再由管理員手動輸入

const path = require("path");
const { DatabaseSync } = require("node:sqlite"); // built into Node.js 22.5+, no native compilation needed

const db = new DatabaseSync(path.join(__dirname, "data.sqlite"));

const DEPARTMENTS = ["採購", "生產", "品管", "資訊", "環安"];

// 全新安裝時直接用新版結構建立
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('employee','section_chief','deputy_manager','manager','general_manager','admin')),
    department TEXT CHECK(department IS NULL OR department IN ('採購','生產','品管','資訊','環安')),
    annual_leave_hours REAL NOT NULL DEFAULT 0,
    hire_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
  );

  CREATE TABLE IF NOT EXISTS leaves (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    department TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    reviewed_by TEXT,
    reviewed_at TEXT,
    attachment_path TEXT,
    attachment_original_name TEXT,
    FOREIGN KEY(username) REFERENCES users(username)
  );
`);

// ---------- 舊資料庫遷移（既有資料庫是舊結構時，補齊新欄位、不影響既有資料） ----------

// 1) users 表：如果 role 的 CHECK 限制式裡還沒有 section_chief，代表是舊結構，
//    需要整張表重建（SQLite 沒辦法直接改 CHECK 限制式）。
const usersTableSql = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
  .get();
if (usersTableSql && !usersTableSql.sql.includes("section_chief")) {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE users_new (
      username TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('employee','section_chief','deputy_manager','manager','general_manager','admin')),
      department TEXT CHECK(department IS NULL OR department IN ('採購','生產','品管','資訊','環安')),
      annual_leave_hours REAL NOT NULL DEFAULT 0,
      hire_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
    );
    INSERT INTO users_new (username, name, password_hash, role, department, annual_leave_hours, hire_date, created_at)
      SELECT username, name, password_hash, role, NULL, 0, NULL, created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    PRAGMA foreign_keys = ON;
  `);
}

// 2) users 表：就算 CHECK 已經是新的，也可能缺 department / annual_leave_hours 欄位（保險起見再檢查一次）
const usersColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!usersColumns.includes("department")) {
  db.exec(`ALTER TABLE users ADD COLUMN department TEXT`);
}
if (!usersColumns.includes("annual_leave_hours")) {
  db.exec(`ALTER TABLE users ADD COLUMN annual_leave_hours REAL NOT NULL DEFAULT 0`);
}
if (!usersColumns.includes("hire_date")) {
  db.exec(`ALTER TABLE users ADD COLUMN hire_date TEXT`);
}

// 3) leaves 表：舊版資料庫可能還沒有以下欄位，自動補上，不會影響既有資料
const leavesColumns = db.prepare("PRAGMA table_info(leaves)").all().map(c => c.name);
if (!leavesColumns.includes("attachment_path")) {
  db.exec(`ALTER TABLE leaves ADD COLUMN attachment_path TEXT`);
}
if (!leavesColumns.includes("attachment_original_name")) {
  db.exec(`ALTER TABLE leaves ADD COLUMN attachment_original_name TEXT`);
}
if (!leavesColumns.includes("department")) {
  db.exec(`ALTER TABLE leaves ADD COLUMN department TEXT`);
}

// 4) 既有的「年假」請假紀錄，改成「特休」（年假已經被特休取代，避免舊資料的假別消失不見）
db.exec(`UPDATE leaves SET type = '特休' WHERE type = '年假'`);

module.exports = db;
module.exports.DEPARTMENTS = DEPARTMENTS;
