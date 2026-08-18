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
// 20260818: 安全性強化：
//   1) SESSION_SECRET 在正式環境（NODE_ENV=production）沒設定時直接擋下啟動，避免用到寫死在原始碼裡的預設密鑰
//   2) session cookie 加上 sameSite: "lax"，降低 CSRF（跨站請求偽造）風險
//   3) 登入加上失敗次數限制（同帳號+同IP，連續失敗會鎖定一段時間），防暴力破解密碼
//   4) 所有登入後的寫入型 API（POST/PUT/DELETE）都要求帶上 CSRF token，token 綁在 session 上，跨站的請求拿不到
//   5) 匯入 Excel 或管理員建立帳號時，如果密碼是系統預設/由管理員指定，會標記 must_change_password，
//      該帳號登入後只能先改密碼，才能使用系統其他功能
// 20260818: 登入鎖定新增「管理員手動解鎖」：帳號管理頁面會顯示某個帳號目前是否被鎖定（含還剩幾分鐘），
//   管理員可以按「解除鎖定」立即清掉，不用乾等鎖定時間過期
// 20260818: 新增使用者 email 欄位（自行綁定，管理員也能協助設定/修改），忘記密碼跟通知信都要用
// 20260818: 新增「忘記密碼」流程：寄一組限時（15分鐘）、一次性的重設連結到綁定信箱，不會洩漏帳號是否存在
// 20260818: 新增「取消申請」：本人可以取消自己還在 pending 狀態的假單
// 20260818: 主管拒絕假單時，一定要附上拒絕理由（reject_reason），沒填不給送出
// 20260818: 新增通知機制（mailer.js）：新申請送出通知有審核權限的主管、審核結果通知申請人（拒絕會附理由）
// 20260818: 新增 GET /api/leaves/export：主管可以把目前篩選條件下看得到的請假明細匯出成 Excel（只給明細，彙總交給使用者自己用樞紐分析表）
// 20260818: 新增年底特休提醒：每年 12 月自動寄信給還有剩餘特休的人，提醒安排休假（annual_leave_reminders 表記錄避免重複寄送）
// 20260818: 新增帳號停用/啟用（active 欄位）：離職員工的帳號可以停用，登入會被擋下、已登入的 session 下次操作也會被登出，但歷史請假紀錄保留
// 20260818: 新增逾時未審核提醒：假單送出超過 48 小時還沒被審核，會再寄一次通知信給有權審核的主管（每筆只提醒一次）
// 20260818: 密碼規則加強：至少 8 個字元、且需同時包含英文字母與數字（不要求大小寫混合或特殊符號）

// 讀取專案根目錄下的 .env 檔案，把裡面的設定值（例如 SESSION_SECRET、MAIL_PROVIDER…）載入到 process.env。
// 一定要放在最上面、在其他任何會讀 process.env 的 require 之前，不然那些模組載入時會抓不到設定值。
// 如果沒有 .env 檔案也沒關係，這行不會報錯，就跟原本一樣要嘛用系統本身的環境變數，要嘛用預設值。
require("dotenv").config();

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
const { sendMail } = require("./mailer"); // 忘記密碼、審核結果通知都靠這支寄信

const app = express();                                   // 呼叫剛剛那個函式,建立一個「應用程式實例」,存到 app。之後所有的路由(routes)、middleware 都會掛在這個 app 上
const PORT = process.env.PORT || 3000;                   // process.env.PORT 是從「環境變數」讀取,通常是部署到雲端平台(像 Heroku、Render)時,平台會指定一個 port 給你。

// 正式環境一定要自己設定 SESSION_SECRET，不能用寫死在原始碼裡的預設值，
// 不然任何看得到原始碼的人都能偽造 session cookie，直接假冒成任何使用者登入。
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  console.error("錯誤：正式環境（NODE_ENV=production）必須設定 SESSION_SECRET 環境變數，伺服器已停止啟動。");
  process.exit(1);
}

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
      sameSite: "lax",            // 跨站的請求（例如惡意網站偷偷送過來的表單）瀏覽器不會自動附上這顆 cookie，防 CSRF 的第一道防線
      maxAge: 1000 * 60 * 60 * 8 
    }
  })
);

// ---------- CSRF 防護 ----------
// 登入後，session 上會有一組隨機的 csrfToken（登入時產生，見 /api/login）。
// 前端每次呼叫「寫入型」的 API 都要把這組 token 放進 X-CSRF-Token 標頭帶回來。
// 惡意網站沒辦法讀到別人網域下的 session/CSRF token，就算它能讓瀏覽器帶著 cookie 發請求，也拿不出正確的 token，會被這裡擋下來。
// /api/login 本身不需要帶 token（登入前還沒有 session），其他 GET 請求也不用（GET 不應該有副作用，不檢查）。
// /api/forgot-password、/api/reset-password 也不需要 token：使用者這時候還沒登入，
// 沒有 session 也就沒有 CSRF token 可以帶；這兩支 API 本身有各自的驗證機制（一次性 reset token）把關。
const CSRF_EXEMPT_PATHS = new Set(["/api/login", "/api/forgot-password", "/api/reset-password"]);
function csrfProtection(req, res, next) {
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (!isMutating || CSRF_EXEMPT_PATHS.has(req.path)) return next();
  const tokenFromClient = req.get("X-CSRF-Token");
  if (!req.session.user || !req.session.csrfToken || tokenFromClient !== req.session.csrfToken) {
    return res.status(403).json({ error: "驗證失敗，請重新整理頁面後再試一次" });
  }
  next();
}
app.use(csrfProtection);

// 帳號被標記「必須先改密碼」時（匯入 Excel 的預設密碼、或管理員新建/重設的密碼），
// 除了改密碼跟登出以外，其他寫入型操作一律擋下來，避免有人一直用系統預設/管理員知道的密碼在使用系統。
const MUST_CHANGE_PW_EXEMPT_PATHS = new Set(["/api/me/password", "/api/logout"]);
app.use((req, res, next) => {
  const isMutating = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  if (isMutating && req.session.user && req.session.user.mustChangePassword && !MUST_CHANGE_PW_EXEMPT_PATHS.has(req.path)) {
    return res.status(403).json({ error: "請先修改密碼後再繼續使用系統" });
  }
  next();
});

// ---------- 登入暴力破解防護 ----------
// 用記憶體記錄「帳號＋IP」最近的登入失敗次數，連續失敗太多次就先鎖一段時間，
// 沒有連到外部服務，重啟伺服器後會重置（正式環境如果有多台伺服器/會重啟，之後可以考慮換成 Redis 之類的共用儲存）。
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000; // 鎖定 15 分鐘
const loginAttempts = new Map(); // key: "username|ip" -> { count, lockedUntil }

function loginRateLimit(req, res, next) {
  const username = String((req.body && req.body.username) || "").trim();
  const key = `${username}|${req.ip}`;
  const entry = loginAttempts.get(key);
  if (entry && entry.lockedUntil && entry.lockedUntil > Date.now()) {
    const waitMin = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `登入失敗次數過多，請於約 ${waitMin} 分鐘後再試一次` });
  }
  next();
}
function recordLoginFailure(req) {
  const username = String((req.body && req.body.username) || "").trim();
  const key = `${username}|${req.ip}`;
  const entry = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOGIN_LOCK_MS;
    entry.count = 0; // 鎖定期間過後重新計次
  }
  loginAttempts.set(key, entry);
}
function clearLoginFailures(req) {
  const username = String((req.body && req.body.username) || "").trim();
  loginAttempts.delete(`${username}|${req.ip}`);
}

// 查某個帳號目前是不是被鎖定（掃描這個帳號在所有 IP 底下的鎖定紀錄，取最晚解除的那筆）
// 因為鎖定是用「帳號＋IP」當 key，同一個帳號可能同時從好幾個 IP 被記錄失敗次數
function getLockStatus(username) {
  const prefix = `${username}|`;
  let lockedUntil = 0;
  for (const [key, entry] of loginAttempts.entries()) {
    if (key.startsWith(prefix) && entry.lockedUntil > lockedUntil) {
      lockedUntil = entry.lockedUntil;
    }
  }
  const isLocked = lockedUntil > Date.now();
  return { isLocked, lockedUntil: isLocked ? lockedUntil : null };
}

// 管理員手動解鎖：清掉這個帳號在所有 IP 底下的失敗次數紀錄
function unlockLogin(username) {
  const prefix = `${username}|`;
  for (const key of loginAttempts.keys()) {
    if (key.startsWith(prefix)) loginAttempts.delete(key);
  }
}

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
const STATUS_LABEL_EXPORT = { pending: "待審核", approved: "已核准", rejected: "已拒絕", cancelled: "已取消" };
const VALID_ROLES = Object.keys(RANK);                    // 把一个物件所有的key,抓出来变成一个阵列

// 職位屬於「總部／跨部門」層級，部門欄位可以留空（可以看、審全公司的申請）
const COMPANY_WIDE_ROLES = ["general_manager", "admin"];

// 看有沒有登入。除了看 session 裡有沒有 user，還會每次都查一下資料庫確認帳號「目前」還是啟用中的——
// 這樣管理員停用一個帳號時可以立刻生效，不用等對方 session 過期或重新登入才會被擋下來
// （例如員工剛離職，人資當下就把帳號停用，這個人手上如果還開著網頁分頁，下一個操作就會被登出，不會有空窗期）。
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "尚未登入" });    // 登入後user相關的資訊都會存進session，也較是session.user
  const dbUser = db.prepare("SELECT active FROM users WHERE username = ?").get(req.session.user.username);
  if (!dbUser || !dbUser.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "此帳號已被停用，請聯繫管理員" });
  }
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

// 簡單檢查一下 email 格式，不用太嚴謹，主要是擋掉明顯打錯的
function isValidEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

// 密碼規則：至少 8 個字元，且要同時包含英文字母與數字（不要求大小寫混合或特殊符號，太嚴格反而大家會把密碼寫在便利貼上）
const PASSWORD_RULE_MESSAGE = "密碼至少需要 8 個字元，且需包含英文字母與數字";
function isValidPassword(pw) {
  return typeof pw === "string" && pw.length >= 8 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw);
}

// 找出「有權審核某一筆假單」的主管清單（職級比申請人高，且部門相符或審核者是總部層級），
// 且要有綁定 email、帳號還是啟用中，才會列進來 —— 用來發送「有新申請待審核」「逾時未審核提醒」的通知信。
// 帳號被停用的主管（例如離職了但資料還留著）不應該再收到審核通知。
function getReviewerEmails(leaveRow) {
  const candidates = db
    .prepare("SELECT username, name, role, department, email FROM users WHERE email IS NOT NULL AND email != '' AND active = 1")
    .all();
  return candidates
    .filter(u => canReview(u, leaveRow))
    .map(u => u.email);
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
const DEFAULT_IMPORT_PASSWORD = "welcome1"; // Excel 匯入時，如果沒有填密碼，新帳號預設用這組密碼（8碼、含英文與數字，符合密碼規則）

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

// 計算某個人的特休額度（總額度／已使用／剩餘），特休提醒信、送出申請前的餘額檢查、送出申請時的額度擋下，都共用這支邏輯，
// 確保「畫面上看到的剩餘特休」跟「實際會不會被擋下來」永遠是同一套計算方式算出來的。
function getAnnualLeaveBalance(username, hireDate) {
  const used = db
    .prepare(`SELECT start_date, end_date FROM leaves WHERE username = ? AND type = '特休' AND status IN ('pending','approved')`)
    .all(username);
  const usedHours = used.reduce((sum, l) => sum + computeHours(l.start_date, l.end_date), 0);
  const totalHours = annualLeaveHoursFromHireDate(hireDate); // 依到職日即時算出來，不是資料庫存的固定值
  return { totalHours, usedHours, remainingHours: totalHours - usedHours };
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
  let { department, hireDate, email } = req.body || {};
  if (!username || !password || !name) {
    return res.status(400).json({ error: "請填寫所有欄位" });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: "身份不正確" });
  }
  email = String(email || "").trim();
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: "email 格式不正確" });
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
  // 密碼是管理員設定的，不是使用者自己選的，所以標記「必須先改密碼」，第一次登入要先換掉才能用系統
  db.prepare(
    "INSERT INTO users (username, name, password_hash, role, department, hire_date, email, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
  ).run(username, name, passwordHash, role, department, hireDate, email || null);

  res.json({ ok: true, user: { username, name, role, department, hireDate, email: email || null } });
});

// 重設密碼
app.post("/api/admin/users/:username/password", requireAuth, requireAdmin, (req, res) => {
  const {newPassword} = req.body || {};
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10); 
  // 這組密碼是管理員設定的，不是本人選的，標記「必須先改密碼」，本人下次登入要先換掉
  const result = db.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = 1 WHERE username = ?"
  ).run(passwordHash, req.params.username)

  if (result.changes === 0) {
    return res.status(404).json({ error: "找不到這個帳號" });
  }

  res.json({ ok: true });
});

// 解除某個帳號的登入鎖定（不用乾等鎖定時間過期）
app.post("/api/admin/users/:username/unlock-login", requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare("SELECT username FROM users WHERE username = ?").get(req.params.username);
  if (!user) return res.status(404).json({ error: "找不到這個帳號" });
  unlockLogin(req.params.username);
  res.json({ ok: true });
});

// 停用／重新啟用某個帳號（例如員工離職）。停用後不能登入、既有登入的 session 下次操作就會被登出，
// 但歷史請假紀錄不會被刪除或動到，因為 leaves 表的 username 只是外鍵參照，帳號本身還在（只是不能用而已）。
// 不允許管理員把自己停用，避免手滑把自己鎖在外面、沒有其他管理員可以救援。
app.post("/api/admin/users/:username/active", requireAuth, requireAdmin, (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== "boolean") {
    return res.status(400).json({ error: "缺少 active 參數" });
  }
  if (req.params.username === req.session.user.username) {
    return res.status(400).json({ error: "不能停用自己的帳號" });
  }
  const user = db.prepare("SELECT username FROM users WHERE username = ?").get(req.params.username);
  if (!user) return res.status(404).json({ error: "找不到這個帳號" });
  db.prepare("UPDATE users SET active = ? WHERE username = ?").run(active ? 1 : 0, req.params.username);
  res.json({ ok: true, active });
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
      const email = String(row["Email"] || row["email"] || row["信箱"] || "").trim();

      if (!username || !name) throw new Error("帳號或姓名未填寫");
      if (!role) throw new Error(`身份「${row["身份"]}」不正確`);
      if (email && !isValidEmail(email)) throw new Error("Email 格式不正確");

      if (roleRequiresDepartment(role)) {
        if (!department || !DEPARTMENTS.includes(department)) throw new Error("部門不正確或未填寫");
      } else if (department && !DEPARTMENTS.includes(department)) {
        throw new Error("部門不正確");
      }

      if (!hireDate) throw new Error("到職日格式不正確，請使用 YYYY-MM-DD");

      const existing = db.prepare("SELECT username FROM users WHERE username = ?").get(username);

      if (existing) {
        // email 欄位沒填的話保留原本的值，不要用空白蓋掉既有設定
        const emailClause = email ? ", email = @email" : "";
        if (rawPassword) {
          // 密碼是這次匯入時管理員填在 Excel 裡的，不是本人選的，標記必須先改密碼
          if (!isValidPassword(rawPassword)) throw new Error(PASSWORD_RULE_MESSAGE);
          const passwordHash = bcrypt.hashSync(rawPassword, 10);
          db.prepare(
            `UPDATE users SET name = @name, role = @role, department = @department, hire_date = @hireDate,
             password_hash = @passwordHash, must_change_password = 1${emailClause} WHERE username = @username`
          ).run({ name, role, department, hireDate, passwordHash, username, email });
        } else {
          // 沒填密碼欄位 → 保留原本的密碼，不動它，也不用強制改密碼
          db.prepare(
            `UPDATE users SET name = @name, role = @role, department = @department, hire_date = @hireDate${emailClause}
             WHERE username = @username`
          ).run({ name, role, department, hireDate, username, email });
        }
        updated.push(username);
      } else {
        const password = rawPassword || DEFAULT_IMPORT_PASSWORD;
        if (!isValidPassword(password)) throw new Error(PASSWORD_RULE_MESSAGE);
        const passwordHash = bcrypt.hashSync(password, 10);
        // 新帳號的密碼（不管是 Excel 填的還是系統預設值）都是別人設定的，標記必須先改密碼
        db.prepare(
          "INSERT INTO users (username, name, password_hash, role, department, hire_date, email, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
        ).run(username, name, passwordHash, role, department, hireDate, email || null);
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
    .prepare("SELECT username, name, role, department, hire_date, email, must_change_password, active, created_at FROM users ORDER BY created_at DESC")
    .all();
  const users = rows.map(u => ({
    ...u,
    seniorityDays: seniorityLeaveDays(u.hire_date),
    annualLeaveHours: annualLeaveHoursFromHireDate(u.hire_date),
    ...getLockStatus(u.username)
  }));
  res.json({ users });
});

// 登入
app.post("/api/login", loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    recordLoginFailure(req);
    return res.status(401).json({ error: "帳號或密碼不正確" });
  }
  // 帳密是對的，但帳號已經被停用（例如離職）——這不算暴力破解嘗試，不計入失敗次數，
  // 但也明確告訴他「帳號被停用」而不是含糊帶過，讓他知道要找管理員，不用一直懷疑自己是不是打錯密碼
  if (!user.active) {
    return res.status(403).json({ error: "此帳號已被停用，請聯繫管理員" });
  }
  clearLoginFailures(req);
  req.session.user = {
    username: user.username,
    name: user.name,
    role: user.role,
    department: user.department,
    email: user.email || null,
    mustChangePassword: !!user.must_change_password
  };
  // 每次登入重新產生一組 CSRF token，綁在這個 session 上
  req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  res.json({ user: req.session.user, csrfToken: req.session.csrfToken });
});

// 登出
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// 查詢我目前的登入狀態，指定時間內都還算登入，就算F5畫面也還在
app.get("/api/me", (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString("hex");
  res.json({ user: req.session.user, csrfToken: req.session.csrfToken });
});

// 讓已登入的使用者自己改密碼（需要輸入目前的密碼確認本人操作）。
// 改完之後會把 must_change_password 清掉，代表不用再強制改密碼了。
app.post("/api/me/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.session.user.username);
  if (!user || !bcrypt.compareSync(currentPassword || "", user.password_hash)) {
    return res.status(401).json({ error: "目前的密碼不正確" });
  }
  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = ?")
    .run(passwordHash, user.username);
  req.session.user.mustChangePassword = false;
  res.json({ ok: true, user: req.session.user });
});

// 讓已登入的使用者自己綁定／修改 email。忘記密碼跟各種通知信都要寄到這個信箱，
// 所以格式要檢查，但不強制一定要填（沒填的人就不能用忘記密碼功能，也收不到通知信）。
app.post("/api/me/email", requireAuth, (req, res) => {
  const email = String((req.body || {}).email || "").trim();
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: "email 格式不正確" });
  }
  db.prepare("UPDATE users SET email = ? WHERE username = ?").run(email || null, req.session.user.username);
  req.session.user.email = email || null; // 同步一下 session，避免之後其他 API（例如改密碼）回傳的 user 資訊是舊的
  res.json({ ok: true, user: req.session.user, email: email || null });
});

// 管理員協助設定／修改某個帳號的 email（例如員工自己不會操作、或是要改成公司內部信箱）
app.post("/api/admin/users/:username/email", requireAuth, requireAdmin, (req, res) => {
  const email = String((req.body || {}).email || "").trim();
  if (email && !isValidEmail(email)) {
    return res.status(400).json({ error: "email 格式不正確" });
  }
  const result = db.prepare("UPDATE users SET email = ? WHERE username = ?").run(email || null, req.params.username);
  if (result.changes === 0) {
    return res.status(404).json({ error: "找不到這個帳號" });
  }
  res.json({ ok: true, email: email || null });
});

// ---------- 忘記密碼 ----------

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000; // 重設連結 15 分鐘內有效
const FORGOT_PW_MAX_ATTEMPTS = 5;
const FORGOT_PW_WINDOW_MS = 15 * 60 * 1000;
const forgotPasswordAttempts = new Map(); // key: "username|ip" -> { count, windowStart }

// 簡單防濫用：同帳號＋同IP，15分鐘內最多觸發5次「寄重設信」，避免有人拿系統當轟炸信箱的工具
function forgotPasswordRateLimit(req, res, next) {
  const username = String((req.body && req.body.username) || "").trim();
  const key = `${username}|${req.ip}`;
  const now = Date.now();
  const entry = forgotPasswordAttempts.get(key);
  if (entry && now - entry.windowStart < FORGOT_PW_WINDOW_MS) {
    if (entry.count >= FORGOT_PW_MAX_ATTEMPTS) {
      return res.status(429).json({ error: "請求次數過多，請稍後再試" });
    }
    entry.count += 1;
  } else {
    forgotPasswordAttempts.set(key, { count: 1, windowStart: now });
  }
  next();
}

// 使用者按「忘記密碼」時打的 API。不管帳號存不存在、有沒有綁 email，一律回傳同樣的成功訊息，
// 避免有心人士拿這支 API 來測試「哪些帳號存在系統裡」（帳號列舉攻擊）。
app.post("/api/forgot-password", forgotPasswordRateLimit, (req, res) => {
  const username = String((req.body || {}).username || "").trim();
  const genericMessage = "如果這個帳號有綁定信箱，系統已經寄出一封重設密碼的信，請至信箱查收（含垃圾郵件匣）。";

  if (!username) return res.status(400).json({ error: "請輸入帳號" });

  const user = db.prepare("SELECT username, name, email FROM users WHERE username = ?").get(username);
  if (user && user.email) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
    db.prepare("INSERT INTO password_reset_tokens (token, username, expires_at) VALUES (?, ?, ?)")
      .run(token, user.username, expiresAt);

    const resetUrl = `${req.protocol}://${req.get("host")}/?resetToken=${token}`;
    sendMail({
      to: user.email,
      subject: "【請假系統】重設密碼",
      text: `${user.name} 您好，\n\n收到您的重設密碼請求。請在 15 分鐘內點擊以下連結設定新密碼：\n${resetUrl}\n\n如果這不是您本人的操作，請忽略這封信，您的密碼不會被更動。`
    });
  }
  // 不管使用者存不存在／有沒有信箱，都回傳一樣的訊息
  res.json({ ok: true, message: genericMessage });
});

// 使用者點擊重設連結、輸入新密碼後打的 API
app.post("/api/reset-password", (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token) return res.status(400).json({ error: "缺少重設密碼的驗證資訊，請重新申請忘記密碼" });
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: PASSWORD_RULE_MESSAGE });
  }

  const record = db.prepare("SELECT * FROM password_reset_tokens WHERE token = ?").get(token);
  if (!record || record.used || new Date(record.expires_at) < new Date()) {
    return res.status(400).json({ error: "這個重設密碼連結已失效或已經使用過，請重新申請忘記密碼" });
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE username = ?")
    .run(passwordHash, record.username);
  db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE token = ?").run(token);
  // 保險起見，把這個帳號其他還沒用過的舊 token 也一併作廢
  db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE username = ? AND used = 0").run(record.username);

  // 順便清掉這個帳號的登入失敗鎖定紀錄，避免密碼剛設好卻因為之前試錯密碼被鎖住
  unlockLogin(record.username);

  res.json({ ok: true });
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
  const { totalHours, usedHours, remainingHours } = getAnnualLeaveBalance(username, user ? user.hire_date : null);
  res.json({
    totalHours: round1(totalHours),
    usedHours: round1(usedHours),
    remainingHours: round1(remainingHours),
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
    const { remainingHours } = getAnnualLeaveBalance(username, dbUser.hire_date);
    if (requestedHours > remainingHours + 1e-6) {
      return res.status(400).json({
        error: `特休時數不足，你剩餘可用的特休為 ${round1(remainingHours)} 小時，本次申請需要 ${round1(requestedHours)} 小時`
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

  // 通知有審核權限的主管：有一筆新的申請在等待審核
  const reviewerEmails = getReviewerEmails({ requester_role: role, department: dbUser.department });
  reviewerEmails.forEach(email => {
    sendMail({
      to: email,
      subject: `【請假系統】${name} 送出一筆待審核的請假申請`,
      text: `${name}（${username}）送出了一筆請假申請，請至系統審核。\n\n假別：${type}\n時間：${start} ～ ${end}\n原因：${reason}`
    });
  });

  res.json({ ok: true, id });
});

// 取消自己的請假申請。只能取消還沒被審核（狀態為 pending）的申請，
// 已核准／已拒絕的申請如果需要撤銷，請洽主管走既有的補簽流程，避免既有審核紀錄被使用者自己動手腳。
app.post("/api/leaves/:id/cancel", requireAuth, (req, res) => {
  const leave = db.prepare("SELECT * FROM leaves WHERE id = ?").get(req.params.id);
  if (!leave) return res.status(404).json({ error: "找不到這筆申請" });
  if (leave.username !== req.session.user.username) {
    return res.status(403).json({ error: "只能取消自己的申請" });
  }
  if (leave.status !== "pending") {
    return res.status(409).json({ error: "只有待審核中的申請可以取消" });
  }
  const result = db
    .prepare("UPDATE leaves SET status = 'cancelled' WHERE id = ? AND status = 'pending'")
    .run(req.params.id);
  if (result.changes === 0) {
    return res.status(409).json({ error: "這筆申請的狀態已經改變，請重新整理後再試一次" });
  }
  res.json({ ok: true });
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
//   ?status=pending／approved／rejected／cancelled → 只看該狀態的申請（不填就是全部狀態）
//   ?date=YYYY-MM-DD → 只看「這一天有請假」的申請（起訖時間有涵蓋到這一天），方便確認當天人力
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD → 只看「這個區間內」的申請（兩個都選填，用法同 applyDateRangeFilter）
// 這支函式是 /api/leaves/all 和 /api/leaves/export（匯出 Excel）共用的查詢邏輯，
// 確保「畫面上看到的資料」跟「匯出的資料」永遠是同一套權限、同一套篩選條件算出來的，不會兜不起來。
function getReviewableLeaves(reviewer, req) {
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

  const statusFilter = req.query.status;
  if (statusFilter && ["pending", "approved", "rejected", "cancelled"].includes(statusFilter)) {
    rows = rows.filter(row => row.status === statusFilter);
  }

  const dateFilter = req.query.date;
  if (dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
    const dayStart = new Date(`${dateFilter}T00:00:00`);
    const dayEnd = new Date(`${dateFilter}T23:59:59.999`);
    if (!isNaN(dayStart) && !isNaN(dayEnd)) {
      rows = rows.filter(row => new Date(row.start_date) <= dayEnd && new Date(row.end_date) >= dayStart);
    }
  }

  return applyDateRangeFilter(rows, req);
}

app.get("/api/leaves/all", requireReviewer, (req, res) => {
  res.json({ leaves: getReviewableLeaves(req.session.user, req) });
});

// 匯出目前篩選條件下的請假明細清單成 Excel 檔案。
// 匯出的內容跟「審核請假」頁面畫面上看到的資料是同一套權限、同一套篩選邏輯算出來的，
// 課長只能匯出自己部門看得到的資料，不會因為換成 Excel 檔案就繞過原本的權限限制。
// 只給明細清單，不做加總／彙總 —— 使用者要看某人某月請了幾天，直接在 Excel 開好之後拉樞紐分析表就好，
// 比我們自己刻一套彙總邏輯更有彈性，之後要怎麼分組、怎麼加總都是使用者自己決定。
app.get("/api/leaves/export", requireReviewer, (req, res) => {
  const rows = getReviewableLeaves(req.session.user, req);

  const sheetData = rows.map(row => ({
    "申請人": row.name,
    "帳號": row.username,
    "身份": ROLE_LABEL[row.requester_role] || row.requester_role,
    "部門": row.department || "",
    "假別": row.type,
    "開始時間": row.start_date,
    "結束時間": row.end_date,
    "時數": round1(computeHours(row.start_date, row.end_date)),
    "狀態": STATUS_LABEL_EXPORT[row.status] || row.status,
    "原因": row.reason,
    "審核人": row.reviewed_by || "",
    "審核時間": row.reviewed_at || "",
    "拒絕理由": row.reject_reason || "",
    "申請時間": row.created_at
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "請假明細");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  const from = req.query.from || "全部";
  const to = req.query.to || "日期";
  const filename = `請假明細_${from}_至_${to}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
});

// 審核某一筆假單
app.post("/api/leaves/:id/review", requireReviewer, (req, res) => {
  const { action } = req.body || {};
  let { reason } = req.body || {};
  if (!["approved", "rejected"].includes(action)) {
    return res.status(400).json({ error: "動作不正確" });
  }
  // 拒絕的話一定要附理由，讓申請人知道為什麼被拒絕
  reason = String(reason || "").trim();
  if (action === "rejected" && !reason) {
    return res.status(400).json({ error: "拒絕申請時必須填寫理由" });
  }

  const target = db
    .prepare(
      `SELECT leaves.*, users.role AS requester_role, users.email AS requester_email
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
      `UPDATE leaves SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), reject_reason = ?
       WHERE id = ? AND status = 'pending'`
    )
    .run(action, req.session.user.name, action === "rejected" ? reason : null, req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: "找不到這筆申請，或已經被審核過了" });
  }

  // 通知申請人審核結果（拒絕的話把理由一起帶上）
  if (target.requester_email) {
    const resultLabel = action === "approved" ? "核准" : "拒絕";
    const reasonLine = action === "rejected" ? `\n拒絕理由：${reason}` : "";
    sendMail({
      to: target.requester_email,
      subject: `【請假系統】你的請假申請已被${resultLabel}`,
      text: `你申請的「${target.type}」（${target.start_date} ～ ${target.end_date}）已被 ${req.session.user.name} ${resultLabel}。${reasonLine}`
    });
  }

  res.json({ ok: true });
});

// ---------- 年底特休提醒 ----------
// 每年 12 月，把「還有剩餘特休沒請完」的人挑出來，各自寄一封提醒信到自己的通知信箱。
// 用「12 月整個月都算提醒時機」而不是卡死某一天，是為了避免剛好那天伺服器沒開著（重啟、部署、斷線…）就整個錯過；
// 有沒有寄過是用 annual_leave_reminders 表（帳號＋年份）判斷，同一人同一年只會寄一次，不會因為每天都檢查就一直重複寄。
const ANNUAL_LEAVE_REMINDER_MONTH = 12; // 12 月（可視需求調整成其他月份）

function runAnnualLeaveReminderCheck() {
  const now = new Date();
  if (now.getMonth() + 1 !== ANNUAL_LEAVE_REMINDER_MONTH) return; // getMonth() 是 0-11，+1 轉成一般認知的月份
  const year = now.getFullYear();

  const users = db
    .prepare("SELECT username, name, hire_date, email FROM users WHERE hire_date IS NOT NULL AND email IS NOT NULL AND email != '' AND active = 1")
    .all();

  users.forEach(u => {
    const alreadySent = db
      .prepare("SELECT 1 FROM annual_leave_reminders WHERE username = ? AND year = ?")
      .get(u.username, year);
    if (alreadySent) return;

    const { remainingHours } = getAnnualLeaveBalance(u.username, u.hire_date);
    // 不管有沒有剩餘特休，這一年都記一筆，避免每天重複算同一個人；但只有真的還有剩餘的人才會收到信
    db.prepare(
      "INSERT INTO annual_leave_reminders (username, year, remaining_hours) VALUES (?, ?, ?)"
    ).run(u.username, year, round1(remainingHours));

    if (remainingHours > 1e-6) {
      sendMail({
        to: u.email,
        subject: `【請假系統】提醒：你今年還有 ${round1(remainingHours)} 小時特休沒請`,
        text: `${u.name} 您好，\n\n提醒您，${year} 年度您目前還剩下 ${round1(remainingHours)} 小時的特休尚未使用，請記得安排休假，避免特休到期或年底沒排到假的情況。\n\n如已安排好排休計畫，請忽略這封信。`
      });
    }
  });
}

// 伺服器啟動時先檢查一次（涵蓋「剛好在 12 月重啟」的情況），之後每 12 小時再檢查一次；
// 邏輯裡月份不對會直接跳過，所以一年裡有 11 個月這支函式幾乎都是「查一下、什麼都不做」，成本很低。
runAnnualLeaveReminderCheck();
setInterval(runAnnualLeaveReminderCheck, 12 * 60 * 60 * 1000);

// ---------- 逾時未審核提醒 ----------
// 假單送出超過一定時間還沒人處理（狀態仍是 pending），就再寄一次通知信給所有有權審核的主管，
// 避免假單卡住沒人注意到（例如通知信被當成一般信件淹沒在收件匣裡）。
// 不指定特定的「代理審核人」——本來就有好幾層主管都能審，提醒信會再發給同一群人，
// 誰先看到、先處理都可以，不用額外設計代理機制。
// 每一筆假單只會提醒一次（用 leaves.reminder_sent_at 記錄），不會每次排程都重複轟炸審核者的信箱。
const OVERDUE_REVIEW_HOURS = 48; // 送出超過 48 小時還沒審核，就算逾時（可視公司習慣調整）

function runOverdueReviewReminderCheck() {
  const cutoff = new Date(Date.now() - OVERDUE_REVIEW_HOURS * 60 * 60 * 1000);

  const pendingLeaves = db
    .prepare("SELECT * FROM leaves WHERE status = 'pending' AND reminder_sent_at IS NULL")
    .all();

  pendingLeaves.forEach(leave => {
    // created_at 存的格式是 "YYYY-MM-DD HH:MM:SS"（已經是台灣時間），轉成 ISO 格式讓 Date 能正確解析
    const createdAt = new Date(leave.created_at.replace(" ", "T"));
    if (isNaN(createdAt) || createdAt > cutoff) return; // 還沒超過門檻，先跳過，下次排程再檢查

    // leaves 資料表本身沒有 requester_role 欄位，用申請人帳號另外查一次身份，
    // 確保 getReviewerEmails 裡用來判斷「誰審核得了這筆申請」的職級是正確的
    const requester = db.prepare("SELECT role FROM users WHERE username = ?").get(leave.username);
    const emails = getReviewerEmails({ requester_role: requester ? requester.role : null, department: leave.department });

    emails.forEach(email => {
      sendMail({
        to: email,
        subject: `【請假系統】提醒：有一筆請假申請已等待審核超過 ${OVERDUE_REVIEW_HOURS} 小時`,
        text: `${leave.name}（${leave.username}）送出的「${leave.type}」申請（${leave.start_date} ～ ${leave.end_date}）已經送出超過 ${OVERDUE_REVIEW_HOURS} 小時還沒有人審核，請至系統盡快處理。\n\n原因：${leave.reason}`
      });
    });

    db.prepare("UPDATE leaves SET reminder_sent_at = datetime('now', '+8 hours') WHERE id = ?").run(leave.id);
  });
}

runOverdueReviewReminderCheck();
setInterval(runOverdueReviewReminderCheck, 6 * 60 * 60 * 1000); // 每 6 小時檢查一次，反應比年度提醒快一點

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`請假系統伺服器已啟動： http://localhost:${PORT}`);
});
