// 20260817: 填表單區塊新增判斷式，開始時間需要晚於結束時間(原本是允許同一天，只比較日期)
// 20260817: 新增 UPLOAD_DIR（預設是專案裡的 uploads/ 資料夾，可用環境變數 UPLOAD_DIR 改路徑，方便以後部署時指到持久化磁碟） 
// 20260817: 設定 multer：限制檔案類型（PDF/Word/Excel/圖片）、限制 10MB、上傳的檔案用亂數重新命名
// 20260817: POST /api/leaves 加上 upload.single("attachment") 中介軟體，處理上傳並把檔名寫進資料庫
// 20260817: 新增 GET /api/leaves/:id/attachment：下載附件用，會檢查「是不是本人，或是有審核權限的主管」才給下載
// 20260817: 新增「特休」制度：年假改成特休，每人有自己的特休時數額度，超過額度直接擋下、事先報錯
// 20260817: 新增部門欄位（採購/生產/品管/資訊/環安），請假、審核都要符合部門，只有同部門的上級才能審核
// 20260817: 新增 section_chief（課長）身份，介於員工與副理之間：課長可以審員工的假，但審不了跟自己同級或更高的；副理以上可以審課長的假
// 20260817: 新增依日期查詢「當天有誰請假」的功能，方便主管確認人力是否充足
// 20260817: 審核列表新增「身份」篩選（員工／課長），方便高階主管分開查看
// 20260817: 新增到職日欄位，特休天數改成依到職日自動計算（不再由管理員手動輸入天數/時數）
// 20260817: 新增「匯入員工 Excel」功能（管理員專用），可批次建立/更新帳號並帶入到職日

const path = require("path");                            // 用 __dirname 或設定好的資料夾為基準，安全地組出正確的檔案路徑
const fs = require("fs");                                // 下載或是開啟附件(讀寫)
const crypto = require("crypto");                        // 產生亂數給上傳附件的檔名和請假單的ID
const express = require("express");                      // 載入 Express 這個套件(library),回傳一個「函式」,存到 express 這個變數裡,等下要用它來建立應用程式。 
                                                         // 承上，Express 就是把這些「幾乎每個網站伺服器都需要」的功能，包成方便使用的形式
const session = require("express-session");              // session會產生一個id，然後被伺服器丟進cookie，他每次發出請求的時候都會喵一眼cookie，然後就看到欸這邊有一個session id是哪個傢伙的阿，然後發現喔是這個人啊就接受他的請求了
const bcrypt = require("bcryptjs");
const multer = require("multer");
const XLSX = require("xlsx"); // 用來讀取匯入的員工 Excel 檔案（npm install xlsx）
const db = require("./db");

const app = express();                                   // 呼叫剛剛那個函式,建立一個「應用程式實例」,存到 app。之後所有的路由(routes)、middleware 都會掛在這個 app 上
const PORT = process.env.PORT || 3000;                   // process.env.PORT 是從「環境變數」讀取,通常是部署到雲端平台(像 Heroku、Render)時,平台會指定一個 port 給你。

// 附件存放的資料夾。用環境變數 UPLOAD_DIR 可以指定，方便未來部署到雲端平台時
// 改指到「持久化磁碟」的掛載路徑，本機開發沒設定的話就用專案內的 uploads/ 資料夾。
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 允許傳入附件的檔案資料別有以下:
const ALLOWED_ATTACHMENT_TYPES = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx"
};

// 設定檔案要存去哪裡，檔名要改成亂數取名，限制傳入的大小
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    // 檔名用亂數重新產生，避免使用者上傳的原始檔名造成衝突或路徑問題
    filename: (req, file, cb) => {
      const ext = ALLOWED_ATTACHMENT_TYPES[file.mimetype] || path.extname(file.originalname);  // 副檔名是pdf之類的就跑前面，否則用後面的紀錄
      cb(null, `${crypto.randomUUID()}${ext}`);                                                // 前半段用亂數確保檔名不被看出來，後半段ext代表副檔名
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 限制 10MB
  fileFilter: (req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, "latin1").toString("utf8");
    if (!ALLOWED_ATTACHMENT_TYPES[file.mimetype]) {
      return cb(new Error("不支援的檔案格式，請上傳 PDF、Word、Excel 或圖片檔"));
    }
    cb(null, true);
  }
});

app.set("trust proxy", 1);                               // 跟 Express 說：「我知道我前面有一層轉發站，它講的話你可以信」。

app.use(express.json());                                 // 解析进来的 JSON body
app.use(express.static(path.join(__dirname, "public"))); // 这行是让 Express 直接把 public 资料夹里的档案（HTML/CSS/JS/图片）当成静态网页服务送出去。

app.use(                                                 // session(...) 這個 middleware 執行完之後,每一支 API 裡都能用 req.session(不管是登入、请假、审核……全部都能用
  session({ 
    name: "leave.sid",
    secret: process.env.SESSION_SECRET || "change-this-secret-before-deploying",    // 簽章用的密鑰，防止有人仿冒一個session id塞進cookie裡面騙過伺服器
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8 
    }
  })
);

// 特休取代了原本的年假：每人的特休額度依到職日（users.hire_date）自動計算，其餘假別沒有額度限制
const LEAVE_TYPES = ["特休", "病假", "事假", "婚假", "喪假", "其他"];

const DEPARTMENTS = db.DEPARTMENTS; // 採購／生產／品管／資訊／環安

// 職級由低到高：員工 < 課長 < 副理 < 經理 < 總經理 < 管理員
// 課長是新增的身份，可以審核員工的假，但審不了跟自己同級（課長）或更高的；
// 副理以上（副理、經理、總經理、管理員）則可以審核課長的假。這件事直接靠職級數字的大小比較就會成立，不用額外寫特例。
const RANK = {
  employee: 1,
  section_chief: 2,
  deputy_manager: 3,
  manager: 4,
  general_manager: 5,
  admin: 6
};
const ROLE_LABEL = {
  employee: "員工",
  section_chief: "課長",
  deputy_manager: "副經理/副廠長",
  manager: "經理/廠長",
  general_manager: "總經理",
  admin: "管理員"
};
const VALID_ROLES = Object.keys(RANK);                    // 把一个物件所有的key,抓出来变成一个阵列

// 職位屬於「總部／跨部門」層級，部門欄位可以留空（可以看、審全公司的申請）
const COMPANY_WIDE_ROLES = ["general_manager", "admin"];

// 看有沒有登入
function requireAuth(req, res, next) {  
  if (!req.session.user) return res.status(401).json({ error: "尚未登入" });    // 登入後user相關的資訊都會存進session，也較是session.user
  next();
}

// 看職位是不是至少有課長，代表有審核權限
function requireReviewer(req, res, next) {
  if (!req.session.user || RANK[req.session.user.role] < RANK.section_chief) {
    return res.status(403).json({ error: "沒有權限" });
  }
  next();
}

// 只有管理員可以通過
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "只有管理員可以執行這個操作" });
  }
  next();
}

// 這個人的職位是否需要一定要有部門（總經理／管理員屬於總部層級，可以不設部門）
function roleRequiresDepartment(role) {
  return !COMPANY_WIDE_ROLES.includes(role);
}

// 判斷 reviewer 能不能審核某一筆申請：職級要嚴格比申請人高，而且如果 reviewer 有設定部門，部門也要一致
// （reviewer 部門是 null，代表是總部層級的總經理/管理員，可以跨部門審核）
function canReview(reviewer, row) {
  if (RANK[row.requester_role] >= RANK[reviewer.role]) return false;
  if (reviewer.department && row.department !== reviewer.department) return false;
  return true;
}

// 計算 start ~ end 之間總共多少小時
function computeHours(start, end) {
  const ms = new Date(end) - new Date(start);
  return ms > 0 ? ms / 3600000 : 0;
}
function round1(n) {
  return Math.round(n * 10) / 10;    // 四捨五入到小數點後一位
}

// ---------- 年資特休（依到職日自動計算，管理員不能手動調整） ----------

const HOURS_PER_LEAVE_DAY = 8; // 特休天數換算成小時數的基準：一天算 8 小時
const DEFAULT_IMPORT_PASSWORD = "88888888"; // Excel 匯入時，如果沒有填密碼，新帳號預設用這組密碼

// 計算到職滿了幾個「完整月」，用年/月/日分開比較，比用毫秒相減準確（不會被閏年、月份天數不一誤導）
function monthsOfService(hireDateStr, asOf) {
  const hire = new Date(`${hireDateStr}T00:00:00+08:00`);
  const now = asOf || new Date();
  if (isNaN(hire)) return null;
  let months = (now.getFullYear() - hire.getFullYear()) * 12 + (now.getMonth() - hire.getMonth());
  if (now.getDate() < hire.getDate()) months -= 1;
  return Math.max(0, months);
}

// 依勞基法級距，算出特休「天數」：
// 滿半年3天／滿1年7天／滿2年10天／滿3年14天／滿5年15天／滿10年起每滿1年加1天，最多30天
function seniorityLeaveDays(hireDateStr, asOf) {
  const months = monthsOfService(hireDateStr, asOf);
  if (months === null) return 0;
  if (months < 6) return 0;
  if (months < 12) return 3;
  if (months < 24) return 7;
  if (months < 36) return 10;
  if (months < 60) return 14;
  if (months < 120) return 15;
  const yearsOfService = Math.floor(months / 12);
  return Math.min(30, 15 + (yearsOfService - 9));
}

// 把特休天數換算成系統內部使用的「小時數」
function annualLeaveHoursFromHireDate(hireDateStr, asOf) {
  return seniorityLeaveDays(hireDateStr, asOf) * HOURS_PER_LEAVE_DAY;
}

// 把各種可能的日期輸入（Excel 日期物件、"2026-01-01"、"2026/1/1"）統一整理成 "YYYY-MM-DD"，格式不對就回傳 null
function normalizeDateCell(v) {
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "string") {
    const s = v.trim().replace(/\//g, "-");
    const match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      const [, y, m, d] = match;
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }
  return null;
}

// 把 Excel「身份」欄位的值（中文顯示名稱或英文代碼都接受）對應回系統用的角色代碼
function parseRoleCell(v) {
  const s = String(v || "").trim();
  if (VALID_ROLES.includes(s)) return s;
  const found = Object.entries(ROLE_LABEL).find(([, label]) => label === s);
  return found ? found[0] : null;
}

// ---------- auth routes ----------

// 只有管理員可以新增帳號
app.post("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const { username, password, name, role } = req.body || {};
  let { department, hireDate } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: "請填寫所有欄位" });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: "密碼至少需要 4 個字元" });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "身份不正確" });
  }

  department = department || null;      // 正規畫，如果department是Nan、undefined..就會變成null，不然就保持原本該有的值
  if (roleRequiresDepartment(role)) {
    if (!department || !DEPARTMENTS.includes(department)) {
      return res.status(400).json({ error: "請選擇正確的部門" });
    }
  } else if (department && !DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: "部門不正確" });
  }

  // 到職日：選填。有填的話必須是正確格式，之後特休天數會依這個日期自動計算，不用手動輸入天數/時數。
  if (hireDate) {
    hireDate = normalizeDateCell(hireDate);
    if (!hireDate) {
      return res.status(400).json({ error: "到職日格式不正確，請使用 YYYY-MM-DD" });
    }
  } else {
    hireDate = null;
  }

  const existing = db.prepare("SELECT username FROM users WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).json({ error: "這個帳號已經存在了" });
  }

  const passwordHash = bcrypt.hashSync(password, 10); // bcrypt 把密码「杂凑」成一串看起来乱码的东西存起来。
  db.prepare(
    "INSERT INTO users (username, name, password_hash, role, department, hire_date) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(username, name, passwordHash, role, department, hireDate);

  res.json({ ok: true, user: { username, name, role, department, hireDate } });
});

// 重設密碼
app.post("/api/admin/users/:username/password", requireAuth, requireAdmin, (req, res) => {
  const {newPassword} = req.body || {};
  if (!newPassword || newPassword.length<4) {
    return res.status(400).json({ error: "密碼至少需要 4 個字元" });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10); 
  const result = db.prepare(
    "UPDATE users SET password_hash = ? WHERE username = ?"
  ).run(passwordHash, req.params.username)

  if (result.changes === 0) {
    return res.status(404).json({ error: "找不到這個帳號" });
  }

  res.json({ ok: true });
});

// 設定／修改某個帳號的部門
app.post("/api/admin/users/:username/department", requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare("SELECT role FROM users WHERE username = ?").get(req.params.username);
  if (!user) return res.status(404).json({ error: "找不到這個帳號" });

  let { department } = req.body || {};
  department = department || null;

  if (roleRequiresDepartment(user.role)) {
    if (!department || !DEPARTMENTS.includes(department)) {
      return res.status(400).json({ error: "請選擇正確的部門" });
    }
  } else if (department && !DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: "部門不正確" });
  }

  db.prepare("UPDATE users SET department = ? WHERE username = ?").run(department, req.params.username);
  res.json({ ok: true, department });
});

// 設定／修改某個帳號的到職日。特休天數是依到職日自動算出來的，這裡不能直接改天數/時數，
// 只能改到職日這個「源頭」——這樣算出來的特休額度才會一直是對的，不用管理員每年手動調整。
app.post("/api/admin/users/:username/hire-date", requireAuth, requireAdmin, (req, res) => {
  const hireDate = normalizeDateCell((req.body || {}).hireDate);
  if (!hireDate) {
    return res.status(400).json({ error: "到職日格式不正確，請使用 YYYY-MM-DD" });
  }
  const result = db.prepare("UPDATE users SET hire_date = ? WHERE username = ?").run(hireDate, req.params.username);
  if (result.changes === 0) {
    return res.status(404).json({ error: "找不到這個帳號" });
  }
  res.json({ ok: true, hireDate, seniorityDays: seniorityLeaveDays(hireDate), annualLeaveHours: annualLeaveHoursFromHireDate(hireDate) });
});

// 匯入員工 Excel：批次建立／更新帳號。帳號已存在就更新資料（含到職日），不存在就新增。
// 特休天數不用填在 Excel 裡，系統會依「到職日」自動算出來。
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 匯入檔案限制 5MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
      "application/vnd.ms-excel" // .xls
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("請上傳 Excel 檔案（.xlsx 或 .xls）"));
    }
    cb(null, true);
  }
});

app.post("/api/admin/users/import", requireAuth, requireAdmin, (req, res, next) => {
  importUpload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "檔案上傳失敗" });
    next();
  });
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: "請選擇要匯入的 Excel 檔案" });

  let rows;
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  } catch (e) {
    return res.status(400).json({ error: "無法讀取這個 Excel 檔案，請確認格式正確" });
  }
  if (!rows.length) {
    return res.status(400).json({ error: "這個檔案裡沒有資料，請確認第一列是欄位標題（帳號、姓名、密碼、身份、部門、到職日）" });
  }

  const created = []; // { username, usedDefaultPassword }
  const updated = []; // username
  const failed = [];  // { row, username, error }

  rows.forEach((row, idx) => {
    const rowNum = idx + 2; // Excel 第一列是標題，資料從第二列開始
    try {
      const username = String(row["帳號"] || "").trim();
      const name = String(row["姓名"] || "").trim();
      const role = parseRoleCell(row["身份"]);
      let department = String(row["部門"] || "").trim() || null;
      const hireDate = normalizeDateCell(row["到職日"]);
      const rawPassword = String(row["密碼"] || "").trim();

      if (!username || !name) throw new Error("帳號或姓名未填寫");
      if (!role) throw new Error(`身份「${row["身份"]}」不正確`);

      if (roleRequiresDepartment(role)) {
        if (!department || !DEPARTMENTS.includes(department)) throw new Error("部門不正確或未填寫");
      } else if (department && !DEPARTMENTS.includes(department)) {
        throw new Error("部門不正確");
      }

      if (!hireDate) throw new Error("到職日格式不正確，請使用 YYYY-MM-DD");

      const existing = db.prepare("SELECT username FROM users WHERE username = ?").get(username);

      if (existing) {
        if (rawPassword) {
          if (rawPassword.length < 4) throw new Error("密碼至少需要 4 個字元");
          const passwordHash = bcrypt.hashSync(rawPassword, 10);
          db.prepare(
            "UPDATE users SET name = ?, role = ?, department = ?, hire_date = ?, password_hash = ? WHERE username = ?"
          ).run(name, role, department, hireDate, passwordHash, username);
        } else {
          // 沒填密碼欄位 → 保留原本的密碼，不動它
          db.prepare(
            "UPDATE users SET name = ?, role = ?, department = ?, hire_date = ? WHERE username = ?"
          ).run(name, role, department, hireDate, username);
        }
        updated.push(username);
      } else {
        const password = rawPassword || DEFAULT_IMPORT_PASSWORD;
        if (password.length < 4) throw new Error("密碼至少需要 4 個字元");
        const passwordHash = bcrypt.hashSync(password, 10);
        db.prepare(
          "INSERT INTO users (username, name, password_hash, role, department, hire_date) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(username, name, passwordHash, role, department, hireDate);
        created.push({ username, usedDefaultPassword: !rawPassword });
      }
    } catch (e) {
      failed.push({ row: rowNum, username: row["帳號"] || "（未填帳號）", error: e.message });
    }
  });

  res.json({
    ok: true,
    createdCount: created.length,
    updatedCount: updated.length,
    failedCount: failed.length,
    created,
    failed,
    defaultPassword: DEFAULT_IMPORT_PASSWORD
  });
});

// 取得所有user的名單（特休天數／時數是即時依到職日算出來的，不是資料庫存的固定值）
app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare("SELECT username, name, role, department, hire_date, created_at FROM users ORDER BY created_at DESC")
    .all();
  const users = rows.map(u => ({
    ...u,
    seniorityDays: seniorityLeaveDays(u.hire_date),
    annualLeaveHours: annualLeaveHoursFromHireDate(u.hire_date)
  }));
  res.json({ users });
});

// 登入
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "帳號或密碼不正確" });
  }
  req.session.user = { username: user.username, name: user.name, role: user.role, department: user.department };
  res.json({ user: req.session.user });
});

// 登出
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// 查詢我目前的登入狀態，指定時間內都還算登入，就算F5畫面也還在
app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// 提供「有哪些身份可以选」的清单
app.get("/api/roles", (req, res) => {
  res.json({ roles: VALID_ROLES.map(r => ({ value: r, label: ROLE_LABEL[r], rank: RANK[r], requiresDepartment: roleRequiresDepartment(r) })) });
});

// 提供「有哪些部門可以選」的清單
app.get("/api/departments", (req, res) => {
  res.json({ departments: DEPARTMENTS });
});

// ---------- leave routes ----------

// 查詢我自己的特休額度（總額度／已使用／剩餘），送出申請前先看一下還有多少可以請
app.get("/api/leaves/leave-balance", requireAuth, (req, res) => {
  const { username } = req.session.user;
  const user = db.prepare("SELECT hire_date FROM users WHERE username = ?").get(username);
  const used = db
    .prepare(`SELECT start_date, end_date FROM leaves WHERE username = ? AND type = '特休' AND status IN ('pending','approved')`)
    .all(username);
  const usedHours = used.reduce((sum, l) => sum + computeHours(l.start_date, l.end_date), 0);
  const totalHours = annualLeaveHoursFromHireDate(user ? user.hire_date : null); // 依到職日即時算出來，不是資料庫存的固定值
  res.json({
    totalHours: round1(totalHours),
    usedHours: round1(usedHours),
    remainingHours: round1(totalHours - usedHours),
    hireDate: user ? user.hire_date : null
  });
});

// 使用者填好请假表单、按下送出时，会打到的这支 API。
// upload.single("attachment") 會先處理檔案上傳（如果有的話），
// 上傳失敗（格式不對/太大）會呼叫 next(err)，交給下面的錯誤處理中介軟體統一回應。
app.post("/api/leaves", requireAuth, (req, res, next) => {
  upload.single("attachment")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "檔案上傳失敗" });
    next();
  });
}, (req, res) => {
  const { type, start, end,reason } = req.body || {};
  if (!LEAVE_TYPES.includes(type)) return res.status(400).json({ error: "假別不正確" });
  if (!start || !end || !reason) return res.status(400).json({ error: "請填寫所有欄位" });
  if (isNaN(new Date(start)) || isNaN(new Date(end))) {
    return res.status(400).json({ error: "開始或結束時間格式不正確" });
  }
  if (new Date(end) <= new Date(start)) {
    return res.status(400).json({ error: "結束時間必須晚於開始時間" });
  }

  const { username, name, role } = req.session.user;
  const dbUser = db.prepare("SELECT department, hire_date FROM users WHERE username = ?").get(username);

  // 請假需要分部門，才能交給對的部門主管審核；總部層級（總經理／管理員）可以沒有部門
  if (roleRequiresDepartment(role) && !dbUser.department) {
    return res.status(400).json({ error: "你的帳號尚未設定部門，請聯繫管理員設定部門後再申請" });
  }

  const requestedHours = computeHours(start, end);

  // 特休超過剩餘額度就事先擋下來，不能送出申請（額度依到職日自動計算）
  if (type === "特休") {
    if (!dbUser.hire_date) {
      return res.status(400).json({ error: "你的帳號尚未設定到職日，無法計算特休額度，請聯繫管理員設定到職日後再申請" });
    }
    const used = db
      .prepare(`SELECT start_date, end_date FROM leaves WHERE username = ? AND type = '特休' AND status IN ('pending','approved')`)
      .all(username);
    const usedHours = used.reduce((sum, l) => sum + computeHours(l.start_date, l.end_date), 0);
    const remaining = annualLeaveHoursFromHireDate(dbUser.hire_date) - usedHours;
    if (requestedHours > remaining + 1e-6) {
      return res.status(400).json({
        error: `特休時數不足，你剩餘可用的特休為 ${round1(remaining)} 小時，本次申請需要 ${round1(requestedHours)} 小時`
      });
    }
  }

  const id = crypto.randomUUID();
  const attachmentPath = req.file ? req.file.filename : null;
  const attachmentOriginalName = req.file ? req.file.originalname : null;
  db.prepare(
    `INSERT INTO leaves (id, username, name, type, start_date, end_date, reason, status, department, attachment_path, attachment_original_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).run(id, username, name, type, start, end, reason, dbUser.department, attachmentPath, attachmentOriginalName);

  res.json({ ok: true, id });
});

// 下載某一筆請假申請的附件。只有申請人本人，或是有審核權限（課長以上，且部門相符）的人可以下載。
app.get("/api/leaves/:id/attachment", requireAuth, (req, res) => {
  const leave = db
    .prepare(
      `SELECT leaves.*, users.role AS requester_role
       FROM leaves JOIN users ON leaves.username = users.username
       WHERE leaves.id = ?`
    )
    .get(req.params.id);
  if (!leave || !leave.attachment_path) return res.status(404).json({ error: "找不到附件" });

  const isOwner = leave.username === req.session.user.username;
  const isReviewer = RANK[req.session.user.role] >= RANK.section_chief && canReview(req.session.user, leave);
  if (!isOwner && !isReviewer) return res.status(403).json({ error: "沒有權限查看這個附件" });

  const filePath = path.join(UPLOAD_DIR, leave.attachment_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "附件檔案已遺失" });

  res.download(filePath, leave.attachment_original_name || leave.attachment_path);
});

// 依 from／to（皆為 YYYY-MM-DD，兩者皆可選填）篩出「起訖時間跟這個區間有重疊」的假單
// 只給 from → 該日之後（含）都算；只給 to → 該日之前（含）都算；兩個都給 → 落在區間內的都算
function applyDateRangeFilter(rows, req) {
  const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  const fromStr = req.query.from;
  const toStr = req.query.to;
  let rangeStart = null, rangeEnd = null;
  if (fromStr && validDate(fromStr)) {
    const d = new Date(`${fromStr}T00:00:00`);
    if (!isNaN(d)) rangeStart = d;
  }
  if (toStr && validDate(toStr)) {
    const d = new Date(`${toStr}T23:59:59.999`);
    if (!isNaN(d)) rangeEnd = d;
  }
  if (!rangeStart && !rangeEnd) return rows;
  return rows.filter(row => {
    const start = new Date(row.start_date);
    const end = new Date(row.end_date);
    if (rangeStart && end < rangeStart) return false;
    if (rangeEnd && start > rangeEnd) return false;
    return true;
  });
}

// 查我自己的请假记录
// 可以用 ?from=YYYY-MM-DD&to=YYYY-MM-DD 查某個區間內的所有紀錄（兩個都選填）
app.get("/api/leaves/mine", requireAuth, (req, res) => {
  let rows = db
    .prepare("SELECT * FROM leaves WHERE username = ? ORDER BY created_at DESC")
    .all(req.session.user.username);
  rows = applyDateRangeFilter(rows, req);
  res.json({ leaves: rows });
});

// 查看职级低于我、且同部門（若我有設定部門）的人所送出的假单
// 可以用 query string 加篩選條件：
//   ?role=employee／section_chief／deputy_manager／manager／general_manager → 只看該身份送出的申請
//   ?date=YYYY-MM-DD → 只看「這一天有請假」的申請（起訖時間有涵蓋到這一天），方便確認當天人力
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD → 只看「這個區間內」的申請（兩個都選填，用法同 applyDateRangeFilter）
app.get("/api/leaves/all", requireReviewer, (req, res) => {
  const reviewer = req.session.user;
  let rows = db
    .prepare(
      `SELECT leaves.*, users.role AS requester_role
       FROM leaves JOIN users ON leaves.username = users.username
       ORDER BY leaves.created_at DESC`
    )
    .all()
    .filter(row => canReview(reviewer, row));

  // 篩選條件可以是任何職級比自己低的身份（不只員工／課長），只要是合法的職稱都接受；
  // rows 這時候已經先被 canReview 篩過職級了，所以就算傳進職級比自己高（或不存在）的身份，篩完也只會是空清單，不會外洩資料
  const roleFilter = req.query.role;
  if (roleFilter && VALID_ROLES.includes(roleFilter)) {
    rows = rows.filter(row => row.requester_role === roleFilter);
  }

  const dateFilter = req.query.date;
  if (dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
    const dayStart = new Date(`${dateFilter}T00:00:00`);
    const dayEnd = new Date(`${dateFilter}T23:59:59.999`);
    if (!isNaN(dayStart) && !isNaN(dayEnd)) {
      rows = rows.filter(row => new Date(row.start_date) <= dayEnd && new Date(row.end_date) >= dayStart);
    }
  }

  rows = applyDateRangeFilter(rows, req);

  res.json({ leaves: rows });
});

// 審核某一筆假單
app.post("/api/leaves/:id/review", requireReviewer, (req, res) => {
  const { action } = req.body || {};
  if (!["approved", "rejected"].includes(action)) {
    return res.status(400).json({ error: "動作不正確" });
  }

  const target = db
    .prepare(
      `SELECT leaves.username, leaves.status, leaves.department, users.role AS requester_role
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
  if (req.session.user.department && target.department && req.session.user.department !== target.department) {
    return res.status(403).json({ error: "這筆申請屬於其他部門，你沒有權限審核" });
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

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`請假系統伺服器已啟動： http://localhost:${PORT}`);
});
