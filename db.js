// 20260817: 新增start_data和end_data兩個欄位
// 20260817: 新增兩欄位attachment_path、attachment_original_name
// 20260817: users 新增 department（部門）、annual_leave_hours（特休總時數）欄位
// 20260817: users 的 role 新增 section_chief（課長）身份
// 20260817: leaves 新增 department 欄位（申請當下的部門快照，方便分部門審核與查詢）
// 20260817: 既有資料庫的「年假」請假紀錄，遷移時全部改成「特休」
// 20260817: 新增 hire_date（到職日），特休天數改成依到職日自動計算，不再由管理員手動輸入
// 20260818: users 新增 email 欄位（忘記密碼、審核/核決通知都要用）
// 20260818: 新增 password_reset_tokens 表，忘記密碼流程用來存一次性、有時效性的重設密碼 token
// 20260818: leaves 的 status 新增 cancelled（取消申請），新增 reject_reason 欄位（主管拒絕時要附理由）
// 20260818: 新增 annual_leave_reminders 表，記錄年底特休提醒信「這個人這一年寄過了沒」，避免重複寄送
// 20260818: users 新增 active 欄位（帳號啟用/停用），離職員工停用帳號後不能登入，但歷史請假紀錄仍保留
// 20260818: leaves 新增 reminder_sent_at 欄位，記錄「這筆待審核申請有沒有寄過逾時未審核提醒」，同一筆只提醒一次

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
    email TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
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
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
    department TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    reviewed_by TEXT,
    reviewed_at TEXT,
    reject_reason TEXT,
    attachment_path TEXT,
    attachment_original_name TEXT,
    reminder_sent_at TEXT,
    FOREIGN KEY(username) REFERENCES users(username)
  );

  -- 忘記密碼用的一次性、有時效性 token。每個 token 對應一個帳號，用過一次或過期就不能再用。
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    FOREIGN KEY(username) REFERENCES users(username)
  );

  -- 年底特休提醒：記錄「這個人在這一年已經被提醒過了」，避免伺服器重啟或每天排程重複檢查時同一年寄好幾封信。
  CREATE TABLE IF NOT EXISTS annual_leave_reminders (
    username TEXT NOT NULL,
    year INTEGER NOT NULL,
    remaining_hours REAL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    PRIMARY KEY (username, year),
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
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
    );
    INSERT INTO users_new (username, name, password_hash, role, department, annual_leave_hours, hire_date, must_change_password, created_at)
      SELECT username, name, password_hash, role, NULL, 0, NULL, 0, created_at FROM users;
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
if (!usersColumns.includes("must_change_password")) {
  db.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`);
}
if (!usersColumns.includes("email")) {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
}
if (!usersColumns.includes("active")) {
  // 預設 1（啟用），保證舊資料庫升級後，既有帳號都還能正常登入，不會因為升級就被鎖住
  db.exec(`ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1`);
}

// 3) leaves 表：如果 status 的 CHECK 限制式裡還沒有 cancelled，代表是舊結構，
//    需要整張表重建（SQLite 沒辦法直接改 CHECK 限制式）。重建時把舊資料裡「有的欄位」搬過去，
//    沒有的欄位（例如更舊的資料庫可能連 department、attachment 都還沒有）就補 NULL，不會炸掉。
const leavesTableSql = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'leaves'")
  .get();
if (leavesTableSql && !leavesTableSql.sql.includes("cancelled")) {
  const oldLeavesColumns = db.prepare("PRAGMA table_info(leaves)").all().map(c => c.name);
  const hasCol = c => oldLeavesColumns.includes(c);
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE leaves_new (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
      department TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
      reviewed_by TEXT,
      reviewed_at TEXT,
      reject_reason TEXT,
      attachment_path TEXT,
      attachment_original_name TEXT,
      reminder_sent_at TEXT,
      FOREIGN KEY(username) REFERENCES users(username)
    );
  `);
  const fixedCols = ["id", "username", "name", "type", "start_date", "end_date", "reason", "status", "created_at", "reviewed_by", "reviewed_at"];
  const optionalCols = ["department", "reject_reason", "attachment_path", "attachment_original_name", "reminder_sent_at"];
  const allCols = fixedCols.concat(optionalCols);
  const selectExprs = allCols.map(c => (hasCol(c) ? c : "NULL"));
  db.exec(`
    INSERT INTO leaves_new (${allCols.join(", ")})
      SELECT ${selectExprs.join(", ")} FROM leaves;
    DROP TABLE leaves;
    ALTER TABLE leaves_new RENAME TO leaves;
    PRAGMA foreign_keys = ON;
  `);
}

// 4) leaves 表：就算 CHECK 已經是新的，也可能單獨缺某個欄位（保險起見再檢查一次）
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
if (!leavesColumns.includes("reject_reason")) {
  db.exec(`ALTER TABLE leaves ADD COLUMN reject_reason TEXT`);
}
if (!leavesColumns.includes("reminder_sent_at")) {
  db.exec(`ALTER TABLE leaves ADD COLUMN reminder_sent_at TEXT`);
}

// 5) 既有的「年假」請假紀錄，改成「特休」（年假已經被特休取代，避免舊資料的假別消失不見）
db.exec(`UPDATE leaves SET type = '特休' WHERE type = '年假'`);

module.exports = db;
module.exports.DEPARTMENTS = DEPARTMENTS;
