# 請假申請系統（Express + SQLite）

一個可以自己架設的基礎請假系統：帳號密碼登入、員工提交請假、管理員審核。
資料存在本機的 SQLite 檔案（`data.sqlite`），密碼用 bcrypt 雜湊後才存進資料庫。

## 專案結構

```
leave-system/
  server.js        後端 API（Express）
  db.js             資料庫初始化（SQLite）
  package.json
  public/
    index.html      前端網頁（呼叫後端 API）
  data.sqlite        執行後自動產生的資料庫檔案（不用手動建立）
```

## 本機執行

需要先安裝 [Node.js](https://nodejs.org)，**版本必須是 v22.5 以上**（因為資料庫用的是 Node.js 內建的 SQLite 模組，不需要另外編譯任何東西）。到官網下載時選「LTS」版本即可，目前的 LTS 已經滿足這個需求。

```bash
cd leave-system
npm install
npm start
```

啟動後打開瀏覽器輸入：`http://localhost:3000`

第一次使用先「建立新帳號」，可以自由選擇下面五種身份中的任何一種：

| 身份 | 說明 |
| --- | --- |
| 員工 | 只能提交請假、查看自己的紀錄 |
| 副經理/副廠長 | 可以審核「員工」送出的請假 |
| 經理/廠長 | 可以審核「員工」「副經理/副廠長」送出的請假 |
| 總經理 | 可以審核以上所有階級送出的請假 |
| 管理員 | 階級最高，可以審核任何人（包含總經理）送出的請假 |

**審核規則很單純：只要你的階級比申請人高，就能審核；階級相同或更低則不能。** 所以同階的兩個人（例如兩位廠長）無法互相審核彼此的假，需要往上交給更高階的人。

> 示範系統允許註冊時自由選擇任何身份。正式使用時，這個欄位應該改成由既有管理員在後台指派，而不是讓使用者自己選——目前這只是方便你快速測試整套流程。

> 正式使用前請務必修改 `server.js` 裡的 `SESSION_SECRET`（可以用環境變數設定,見下方部署章節）,不要用預設值。

## 讓任何人都能透過網址使用（部署上線）

目前這個系統是一份可以直接執行的 Node.js 專案,只要放到一台「一直開著、有公開 IP 或網域」的機器上執行 `npm start`,任何人打開那個網址就能使用。常見做法有以下幾種,任選一種即可：

### 方式一：雲端 PaaS 平台（最省事，推薦新手）

例如 [Render](https://render.com)、[Railway](https://railway.app)、[Fly.io](https://fly.io)：

1. 把這個資料夾推上 GitHub（一個新的 repository）
2. 到平台上選擇「從 GitHub 建立 Web Service」
3. Build command：`npm install`；Start command：`npm start`
4. 設定環境變數 `SESSION_SECRET`（自己打一串隨機字串）與 `NODE_ENV=production`
5. 部署完成後平台會給你一個公開網址（例如 `https://your-app.onrender.com`）

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

### 方式三：容器化（Docker）

如果你的平台支援 Docker，可以自己加一個簡單的 `Dockerfile`：

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

再用任何支援 Docker 的平台（Render、Railway、Fly.io、自己的 VPS）部署這個 image。

## 之後可以再加強的地方

- 資料庫：demo 用 SQLite 很夠用，但多人同時大量寫入時建議換成 PostgreSQL / MySQL
- 忘記密碼、修改密碼、刪除帳號等帳號管理功能目前還沒有
- 管理員身份目前可以在註冊時自由選擇，正式環境應該由既有管理員在後台指派，而不是使用者自己選
- 目前 session 存在伺服器記憶體中，如果之後要跑多台伺服器（load balancing），需要把 session 改成存在 Redis 之類的共用儲存裡
