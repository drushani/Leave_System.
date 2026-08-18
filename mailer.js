// mailer.js
// 負責寄送系統通知信（忘記密碼、請假審核結果通知…）。
//
// 用同一套 nodemailer + SMTP 的邏輯，就可以同時支援 Gmail 跟公司內部信箱（或其他任何寄信服務），
// 差別只在.env 裡填的連線設定不一樣。用環境變數 MAIL_PROVIDER 切換要套用哪組預設值：
//
// ---- 方式一：Gmail ----
//   MAIL_PROVIDER=gmail
//   MAIL_USER=you@gmail.com
//   MAIL_PASS=xxxxxxxxxxxxxxxx     ← 不是 Gmail 登入密碼！是「應用程式密碼」
//                                     （Google 帳戶要先開「兩步驟驗證」，才能在
//                                      https://myaccount.google.com/apppasswords 產生這組16碼密碼）
//   MAIL_FROM="請假系統 <you@gmail.com>"   ← 選填，沒填就用 MAIL_USER
//
// ---- 方式二：公司內部信箱 / 自架的 SMTP 伺服器（例如 Exchange、Postfix）----
//   MAIL_PROVIDER=smtp
//   MAIL_HOST=mail.yourcompany.com     ← 跟公司 IT 要這組設定
//   MAIL_PORT=587                      ← 常見是 587（STARTTLS）或 465（SSL）
//   MAIL_SECURE=false                  ← port 465 通常要設 true，587 設 false
//   MAIL_USER=leave-system@yourcompany.com   ← 部分內網伺服器允許不用帳密，這兩個可以留空
//   MAIL_PASS=xxxxxxxx
//   MAIL_FROM="請假系統 <leave-system@yourcompany.com>"  ← 選填
//
// 如果完全沒有設定 MAIL_PROVIDER，系統仍然可以正常運作，只是不會真的寄信，
// 相關內容（例如忘記密碼的重設連結）會印在伺服器的 console log 裡，方便本機開發測試。

const nodemailer = require("nodemailer");

let transporter = null;
let fromAddress = null;

function buildTransporter() {
  const provider = (process.env.MAIL_PROVIDER || "").toLowerCase();

  if (provider === "gmail") {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
      console.warn("[mailer] MAIL_PROVIDER=gmail 但缺少 MAIL_USER 或 MAIL_PASS，寄信功能停用。");
      return null;
    }
    fromAddress = process.env.MAIL_FROM || process.env.MAIL_USER;
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
    });
  }

  if (provider === "smtp") {
    if (!process.env.MAIL_HOST) {
      console.warn("[mailer] MAIL_PROVIDER=smtp 但缺少 MAIL_HOST，寄信功能停用。");
      return null;
    }
    fromAddress = process.env.MAIL_FROM || process.env.MAIL_USER || `no-reply@${process.env.MAIL_HOST}`;
    return nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT) || 587,
      secure: process.env.MAIL_SECURE === "true", // true=465(SSL), false=587(STARTTLS)較常見
      auth: (process.env.MAIL_USER && process.env.MAIL_PASS)
        ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
        : undefined // 有些公司內部 relay 允許內網不驗證帳密
    });
  }

  // 沒設定 MAIL_PROVIDER：不寄信，只在 console 印出內容，方便本機開發
  return null;
}

transporter = buildTransporter();

if (transporter) {
  // 啟動時先驗證一次連線設定，設定錯的話儘早在 log 看到，而不是等到第一次寄信失敗才發現
  transporter.verify().then(
    () => console.log(`[mailer] 郵件服務已就緒（MAIL_PROVIDER=${process.env.MAIL_PROVIDER}）`),
    (err) => console.error("[mailer] 郵件服務連線失敗，請檢查 MAIL_* 環境變數：", err.message)
  );
} else {
  console.warn("[mailer] 尚未設定 MAIL_PROVIDER（gmail 或 smtp），系統通知信將只會印在 log，不會真的寄出。");
}

// 寄信是「附加」功能，不應該讓寄信失敗擋住主要流程（例如審核假單、送出申請），
// 所以這裡故意吃掉錯誤、只記 log，呼叫端不用 try/catch 包這支函式。
async function sendMail({ to, subject, text }) {
  if (!to) return;
  if (!transporter) {
    console.log(`[mailer] (未設定寄信服務，僅顯示於 log)\n收件人: ${to}\n主旨: ${subject}\n內容:\n${text}\n`);
    return;
  }
  try {
    await transporter.sendMail({ from: fromAddress, to, subject, text });
  } catch (err) {
    console.error(`[mailer] 寄信失敗（收件人: ${to}，主旨: ${subject}）：`, err.message);
  }
}

module.exports = { sendMail };
