# 請假申請系統（Express + SQLite）

一個可以自己架設的請假系統：帳號密碼登入、員工提交請假、主管審核、Email 通知、忘記密碼、假別統計匯出。
資料存在本機的 SQLite 檔案（`data.sqlite`），密碼用 bcrypt 雜湊後才存進資料庫。

## 功能總覽

**申請與審核**
- 員工提交請假申請（可附加 PDF/Word/Excel/圖片附件），送出後可自行取消（僅限尚未審核的申請）
- 主管審核：核准或拒絕（拒絕一定要附理由），依部門與職級判斷誰能審核誰
- 特休天數依到職日自動計算（勞基法級距），額度不足會事先擋下無法送出
- 出勤查詢：選日期查看當天有誰請假，方便主管排班
- 請假明細可依篩選條件（日期區間、身份、狀態）匯出成 Excel

**帳號與安全**
- 只有管理員能建立帳號，沒有自助註冊
- 密碼規則：至少 8 個字元，需同時包含英文字母與數字
- 忘記密碼：寄送限時（15 分鐘）、一次性的重設連結到使用者綁定的信箱
- 登入失敗達次數上限會鎖定一段時間，管理員可手動解鎖
- 帳號可停用（例如員工離職），停用後立即無法登入，既有登入的 session 下一次操作也會被登出；歷史請假紀錄不受影響
- CSRF 防護、session cookie 安全設定

**Email 通知**（需設定 `.env`，見下方「設定寄信」）
- 有新申請送出：通知有審核權限的主管
- 申請被核准／拒絕：通知申請人（拒絕會附上理由）
- 假單逾時（預設 48 小時）未審核：再次提醒有權審核的主管
- 每年 12 月自動提醒還有剩餘特休的員工安排休假
- 忘記密碼的重設連結

**管理員功能**
- 建立帳號、重設密碼、設定部門／到職日／通知信箱、停用／啟用帳號
- 匯入員工 Excel（批次建立/更新帳號，含到職日、部門、Email）

## 專案結構

```
leave-system/
  server.js          後端 API（Express）
  db.js               資料庫初始化與遷移（SQLite）
  mailer.js           寄信模組（支援 Gmail 或公司內部 SMTP）
  package.json
  .env.example         環境變數設定範本（複製成 .env 並填入自己的值）
  public/
    index.html        前端網頁（單一頁面應用，呼叫後端 API）
  scripts/
    create-admin.js   建立第一個管理員帳號的命令列工具
  data.sqlite          執行後自動產生的資料庫檔案（不用手動建立，已排除在版本控制外）
  uploads/             請假附件存放的資料夾（已排除在版本控制外）
```

## 本機執行

需要先安裝 [Node.js](https://nodejs.org)，**版本必須是 v22.5 以上**（因為資料庫用的是 Node.js 內建的 SQLite 模組，不需要另外編譯任何東西）。到官網下載時選「LTS」版本即可，目前的 LTS 已經滿足這個需求。

```bash
cd leave-system
npm install
npm start
```

啟動後打開瀏覽器輸入：`http://localhost:3000`

系統**沒有自助註冊**，一般人無法自己建立帳號——只有管理員可以在「帳號管理」頁面建立新帳號，這樣公司外的人就算知道網址也進不來。

### 設定寄信（忘記密碼、審核通知都需要）

複製 `.env.example` 為 `.env`，依照裡面的註解填入設定值。不填也能正常執行，只是通知信內容會印在伺服器的 log 裡、不會真的寄出（方便本機開發測試）。

支援兩種寄信方式，擇一設定即可：

- **Gmail**：`MAIL_PROVIDER=gmail`，`MAIL_PASS` 要用 Google 帳戶的「應用程式密碼」，不是登入密碼
- **公司內部信箱／自架 SMTP 伺服器**：`MAIL_PROVIDER=smtp`，跟公司 IT 要主機、port、帳密

`.env` 已經加進 `.gitignore`，不會被提交到版本控制裡（裡面會有密碼，絕對不要外流或推上公開的 GitHub repo）。

### 建立第一個管理員帳號

因為沒有自助註冊，第一次使用時要先用命令列腳本建立第一個管理員帳號：

```bash
cd leave-system
node scripts/create-admin.js <帳號> <密碼> <姓名>
```

例如：

```bash
node scripts/create-admin.js admin "a-strong-password1" "系統管理員"
```

建立好之後，用這組帳號密碼登入，之後所有其他帳號（不管是員工還是主管）都從網頁裡的「帳號管理」頁面建立即可，不需要再跑腳本。

| 身份 | 說明 |
| --- | --- |
| 員工 | 只能提交請假、查看自己的紀錄 |
| 課長 | 可以審核「員工」送出的請假 |
| 副經理/副廠長 | 可以審核「員工」「課長」送出的請假 |
| 經理/廠長 | 可以審核以上階級送出的請假 |
| 總經理 | 可以審核以上所有階級送出的請假 |
| 管理員 | 階級最高，可以審核任何人（包含總經理）送出的請假，也是唯一能建立新帳號、停用帳號的身份 |

**審核規則：階級要比申請人高，且部門要相符（總經理／管理員可跨部門）才能審核。** 同階的兩個人（例如兩位課長）無法互相審核彼此的假，需要往上交給更高階的人。

> 正式使用前請務必設定 `SESSION_SECRET` 環境變數（見下方部署章節），不要用預設值。

## 讓任何人都能透過網址使用（部署上線）

目前這個系統是一份可以直接執行的 Node.js 專案,只要放到一台「一直開著、有公開 IP 或網域」的機器上執行 `npm start`,任何人打開那個網址就能使用。常見做法有以下幾種,任選一種即可：

### 方式一：雲端 PaaS 平台（最省事，推薦新手）

例如 [Render](https://render.com)、[Railway](https://railway.app)、[Fly.io](https://fly.io)：

1. 把這個資料夾推上 GitHub（一個新的 repository，記得確認 `.env`、`data.sqlite`、`node_modules/`、`uploads/` 都沒有被推上去，`.gitignore` 已經幫你排除好了）
2. 到平台上選擇「從 GitHub 建立 Web Service」
3. Build command：`npm install`；Start command：`npm start`
4. 設定環境變數：`SESSION_SECRET`（自己打一串隨機字串）、`NODE_ENV=production`，以及想用的 `MAIL_*` 寄信設定
5. 部署完成後平台會給你一個公開網址（例如 `https://your-app.onrender.com`），平台通常會自動處理 HTTPS
6. 部署完成後，記得用 `node scripts/create-admin.js` 建立第一個管理員帳號（大部分平台可以在後台開一個一次性的 shell 執行）

⚠️ 注意：這些平台的免費方案通常是「暫時性檔案系統」，重新部署或閒置一段時間後 `data.sqlite` 可能會被清空。如果要長期保存資料，建議：
- 付費方案掛載persistent disk，或
- 把資料庫換成雲端資料庫服務（例如 Render/Railway 提供的 PostgreSQL），這樣資料才會獨立於應用程式的檔案系統之外

### 方式二：自己的雲端主機（VPS，例如 AWS / GCP / DigitalOcean）

1. 開一台最小規格的機器，安裝 Node.js
2. 把專案上傳（`git clone` 或 `scp`）
3. `npm install && npm start`，建議用 [pm2](https://pm2.keymetrics.io/) 讓程式常駐並自動重啟：
   ```bash
   npm install -g pm2
   pm2 start server.js --name leave-system
   ```
4. 在前面架一個 Nginx 做反向代理並申請 HTTPS 憑證（例如用 [Certbot](https://certbot.eff.org/)），把 80/443 轉發到 `localhost:3000`
5. 把你的網域指向這台機器的 IP
6. 建議把 `TZ=Asia/Taipei` 也設進環境變數，確保「年底特休提醒」等跟月份/日期有關的功能判斷的是台灣時間

### 方式三：容器化（Docker）

如果你的平台支援 Docker，可以自己加一個簡單的 `Dockerfile`：

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

再用任何支援 Docker 的平台（Render、Railway、Fly.io、自己的 VPS）部署這個 image。

## 之後可以再加強的地方

- 資料庫：目前用 SQLite 很夠用，但多人同時大量寫入時建議換成 PostgreSQL / MySQL
- 病假、事假目前沒有額度上限，如果公司有相關規定（例如一年最多幾天），可以比照特休額度的做法加上限制
- 操作紀錄／稽核軌跡：目前管理員的操作（重設密碼、停用帳號等）沒有留存紀錄，如果需要合規稽核可以再加一張 log 表
- 目前 session 存在伺服器記憶體中，如果之後要跑多台伺服器（load balancing），需要把 session 改成存在 Redis 之類的共用儲存裡
- `data.sqlite` 沒有自動備份機制，正式使用後建議自己排程定期備份這個檔案

