const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1); // needed if deployed behind a reverse proxy / load balancer (Render, Railway, etc.)

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    name: "leave.sid",
    secret: process.env.SESSION_SECRET || "change-this-secret-before-deploying",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // Set secure:true automatically once the app is served over HTTPS in production.
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8 // 8 hours
    }
  })
);

const LEAVE_TYPES = ["年假", "病假", "事假", "婚假", "喪假", "其他"];

// Rank order, low to high. A user can review anyone with a strictly lower rank.
const RANK = {
  employee: 1,
  deputy_manager: 2,
  manager: 3,
  general_manager: 4,
  admin: 5
};
const ROLE_LABEL = {
  employee: "員工",
  deputy_manager: "副經理/副廠長",
  manager: "經理/廠長",
  general_manager: "總經理",
  admin: "管理員"
};
const VALID_ROLES = Object.keys(RANK);

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "尚未登入" });
  next();
}

// Anyone above plain "employee" rank can access the review screen/API.
function requireReviewer(req, res, next) {
  if (!req.session.user || RANK[req.session.user.role] < RANK.deputy_manager) {
    return res.status(403).json({ error: "沒有權限" });
  }
  next();
}

// ---------- auth routes ----------

app.post("/api/register", (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: "請填寫所有欄位" });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "密碼至少需要 4 個字元" });
  }
  const safeRole = VALID_ROLES.includes(role) ? role : "employee";

  const existing = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).json({ error: "這個帳號已經被註冊了" });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, ?)"
  ).run(username, name, passwordHash, safeRole);

  req.session.user = { username, name, role: safeRole };
  res.json({ user: req.session.user });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "帳號或密碼不正確" });
  }
  req.session.user = { username: user.username, name: user.name, role: user.role };
  res.json({ user: req.session.user });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.get("/api/roles", (req, res) => {
  res.json({ roles: VALID_ROLES.map(r => ({ value: r, label: ROLE_LABEL[r], rank: RANK[r] })) });
});

// ---------- leave routes ----------

app.post("/api/leaves", requireAuth, (req, res) => {
  const { type, start, end, reason } = req.body || {};
  if (!LEAVE_TYPES.includes(type)) return res.status(400).json({ error: "假別不正確" });
  if (!start || !end || !reason) return res.status(400).json({ error: "請填寫所有欄位" });
  if (new Date(end) < new Date(start)) {
    return res.status(400).json({ error: "結束日期必須晚於或等於開始日期" });
  }

  const id = crypto.randomUUID();
  const { username, name } = req.session.user;
  db.prepare(
    `INSERT INTO leaves (id, username, name, type, start_date, end_date, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(id, username, name, type, start, end, reason);

  res.json({ ok: true, id });
});

app.get("/api/leaves/mine", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM leaves WHERE username = ? ORDER BY created_at DESC")
    .all(req.session.user.username);
  res.json({ leaves: rows });
});

// Returns only leaves submitted by someone with a strictly lower rank than the viewer —
// i.e. the set of requests the viewer is actually allowed to act on.
app.get("/api/leaves/all", requireReviewer, (req, res) => {
  const myRank = RANK[req.session.user.role];
  const rows = db
    .prepare(
      `SELECT leaves.*, users.role AS requester_role
       FROM leaves JOIN users ON leaves.username = users.username
       ORDER BY leaves.created_at DESC`
    )
    .all()
    .filter(row => RANK[row.requester_role] < myRank);
  res.json({ leaves: rows });
});

app.post("/api/leaves/:id/review", requireReviewer, (req, res) => {
  const { action } = req.body || {};
  if (!["approved", "rejected"].includes(action)) {
    return res.status(400).json({ error: "動作不正確" });
  }

  const target = db
    .prepare(
      `SELECT leaves.username, leaves.status, users.role AS requester_role
       FROM leaves JOIN users ON leaves.username = users.username
       WHERE leaves.id = ?`
    )
    .get(req.params.id);
  if (!target) return res.status(404).json({ error: "找不到這筆申請" });
  if (target.status !== "pending") {
    return res.status(409).json({ error: "這筆申請已經被審核過了" });
  }
  if (RANK[target.requester_role] >= RANK[req.session.user.role]) {
    return res.status(403).json({ error: "你的階級不足以審核這筆申請，需交由更高階的主管處理" });
  }

  const result = db
    .prepare(
      `UPDATE leaves SET status = ?, reviewed_by = ?, reviewed_at = datetime('now')
       WHERE id = ? AND status = 'pending'`
    )
    .run(action, req.session.user.name, req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "找不到這筆申請，或已經被審核過了" });
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`請假系統伺服器已啟動： http://localhost:${PORT}`);
});
