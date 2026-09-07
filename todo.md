# OpenvoKao TODO 總表

更新日期：2026-09-07

本文件由原本的 8 份 TODO 文件合併而成；各章保留原始更新日期與完成狀態，後續 TODO 一律集中維護於此。

## 目錄

1. [產品里程碑](#1-產品里程碑)
2. [程式碼優化與正式上線風險](#2-程式碼優化與正式上線風險)
3. [Amego 開票資料與發票列印](#3-amego-開票資料與發票列印)
4. [電子發票證明聯格式調整](#4-電子發票證明聯格式調整)
5. [待印區、公司權限與手機配額](#5-待印區公司權限與手機配額)
6. [iPhone 13 正式發票亂碼修正](#6-iphone-13-正式發票亂碼修正)
7. [找零與現場變動價格商品](#7-找零與現場變動價格商品)
8. [同步光貿列印註記與作廢／補印前置查驗](#8-同步光貿列印註記與作廢補印前置查驗)

---

## 1. 產品里程碑

更新日期：2026-07-13

本章保留產品方向與里程碑；工程風險、驗收清單與逐項進度請見後續章節。

### 目前方向

OpenvoKao 分成兩個部分：

- iOS app：前台列印端，負責登入、綁定裝置、同步待列印任務、連接藍牙印表機、列印與回報結果。
- Cloudflare 後端：負責帳號、公司、商品、分類、發票、列印任務、裝置管理、權限、稽核與報表。

iOS 不保存 Amego App Key，也不直接管理商品主資料。Amego 憑證與開票流程應由後端持有與執行。

### 里程碑 1：iOS 列印端

- [x] 建立 SwiftUI iOS 專案。
- [x] 支援 iOS 15 以上裝置。
- [x] 建立待列印、印表機、紀錄、設定等主要畫面。
- [x] BLE 掃描、連線、保存印表機設定、重新連線。
- [x] ESC/POS 發票 renderer。
- [x] 列印版面固定支援 58mm 紙寬，不提供 80mm 模式。
- [x] 支援 pending job 同步、列印成功/失敗回報、失敗 outbox 重試。
- [ ] 實機確認不同熱感紙機型的中文、QR code、barcode、切紙與走紙相容性。

### 里程碑 2：帳號、公司與裝置綁定

- [x] 客戶註冊與登入。
- [x] 使用者、公司、裝置資料寫入 D1。
- [x] 裝置綁定第一台手機。
- [x] 換手機需使用公司解除綁定碼。
- [x] owner / staff / printer 角色與 route-level 權限。
- [x] auth session、device token 改為雜湊保存。
- [ ] 正式確認 Bundle ID、Team ID 與 App Store 身分。

### 里程碑 3：商品、分類與公司設定

- [x] 商品分類頁。
- [x] 商品管理頁。
- [x] 商品價格支援公司層級小數位數設定。
- [x] 商品、分類、公司、使用者等主要表改用數字 ID。
- [x] 移除 store 層，簡化為 company。
- [x] 商品與分類寫入改用會員 session，device token 不可管理資料。

### 里程碑 4：發票與列印任務

- [x] 後端建立 invoice、invoice_items、print_jobs。
- [x] 相同發票號碼與 idempotency key 不會重複建單。
- [x] 多台 iPhone 同時刷新時，只能有一台 claim 同一筆任務。
- [x] printed / failed callback 具備狀態機防護。
- [x] 建立 audit log 與 request log。
- [x] 串接 Amego 正式開票、補查與作廢 API，App Key 只由後端從 D1 讀取。
- [ ] 用正式財政部測試資料驗證 QR code、條碼、期別、總額與統編。

### 里程碑 5：業績、報表與管理功能

- [x] 業績報表查詢。
- [x] 報表查詢加入日期範圍限制、pagination 與正確的最新列印任務判斷。
- [x] 發票管理取代原會員中心。
- [x] 後台按鈕改為業績。
- [ ] 補正式產品 UI 驗收與實機操作流程。

### 里程碑 6：測試、部署與維運

- [x] Worker integration tests。
- [x] D1 migration tests。
- [x] iOS renderer、printer manager、backend client 相關測試。
- [x] CI 執行 typecheck、Worker tests、migration test、Wrangler dry-run 與 iOS 無簽章 build。
- [x] Cloudflare observability、request ID、結構化 log。
- [x] Git 忽略 `.ipa`、Xcode user state、`.DS_Store`、DerivedData、Wrangler 本機 state。
- [ ] 建立正式 staging / production Worker environment、不同 D1 與不同 secrets。
- [x] Binary artifact 不納入 Git；CI 使用 artifact 保存 unsigned simulator app。

### 發布前必做

- [ ] 供應商端確認曾出現在程式碼中的 App Key 是否需要撤銷或輪替。
- [x] Amego API 串接與成功、拒絕、HTTP 錯誤、逾時及回應不完整測試。
- [ ] 正式財政部測試資料驗證。
- [ ] 至少兩台 iPhone 同時搶同一筆列印任務的實機測試。
- [ ] 不同印表機型號實機測試。
- [ ] 確認 Bundle ID、Team ID、簽章與 App Store 帳號。

---

## 2. 程式碼優化與正式上線風險

更新日期：2026-07-13

### 審查結論

目前 iOS 與 Worker 都能編譯，D1 migration 可從空資料庫與舊 fixture 完整升級，列印狀態機、token 安全、資料完整性、登入/session、防重複列印與 CI gate 都已補上。本章保留正式上線前仍需確認的風險與維護工作，產品功能清單仍以上方「產品里程碑」章節為主。

### 目前剩餘重點

- 外部確認：若舊 App Key 曾經是真實可用憑證，需在供應商端撤銷或輪替。
- 發票正式性：Amego 正式開票流程已完成；仍需完成實體 QRCode／條碼列印與掃描驗收。
- 實機相容性：目前 PDF 與 QR 點陣資料正常，但特定 58mm 藍牙印表機曾只走紙而未印出 QRCode；最新版已改為分段點陣傳輸，待實機複驗。
- 維護性：Worker 已拆至目前可接受範圍，暫不繼續為拆分而拆分。

### 已驗證的基線

- [x] `npm run typecheck` 通過。
- [x] iOS Debug／iPhoneOS、iOS 15 deployment target、停用簽章 build、實機簽章 build 通過。
- [x] `wrangler deploy --dry-run` 通過，Worker bundle 可產生。
- [x] D1 `0001`～`0025` migration 可從全新本機資料庫與既有 fixture 依序套用成功。
- [x] 已補 iOS unit test、Worker 自動化測試與 CI gate。
- [x] migration 已驗證空庫與「已有公司、帳號、商品、發票、列印紀錄」fixture 升級後資料仍完整。

---

### P0：正式使用前必須完成

#### 1. 修正 BLE 列印完成判定

目前 `PrinterManager.print()` 只排入一連串 `asyncAfter` 寫入後就立即返回，畫面隨即呼叫 `markPrintedAndReport()`；資料可能仍在傳送、已中斷，甚至根本沒有出紙，後端卻已標成 `printed`。

證據：`openvoKao/PrinterManager.swift:126-171`、`openvoKao/ContentView.swift:416-424`、`openvoKao/ContentView.swift:667-675`

- [x] 將列印 API 改為單一序列佇列，`async throws` 必須等所有 chunk 完成或確定失敗才返回。
- [x] 同一時間只允許一筆列印，避免兩份 ESC/POS byte stream 交錯。
- [x] 依 `maximumWriteValueLength(for:)` 決定 chunk 大小，不固定為 20 bytes。
- [x] 檢查 characteristic 是否支援 `.writeWithoutResponse`／`.write`，依能力選擇傳輸方式。
- [x] 使用 `canSendWriteWithoutResponse` 與 `peripheralIsReady(toSendWriteWithoutResponse:)` 做流量控制，不用固定 10ms 猜測。
- [x] 斷線、切換印表機或 app 進背景時取消當前佇列並回傳可辨識錯誤。
- [x] UI 區分「傳送中」、「已送至印表機」和「已確認完成」；若硬體無回執，不要把「byte 已排入」描述成已成功出紙。

驗收：傳輸中拔掉印表機不會回報成功；連點兩張發票不會交錯；長品項發票可完整送完。

#### 2. 增加列印任務 claim／lease，避免多機重複出紙

目前未指定 `device_id` 的 pending 任務會同時出現在同公司的所有裝置，任一裝置也能反覆把任務改成 `printed` 或 `failed`。

證據：`backend/src/index.ts:634-654`、`backend/src/index.ts:991-1023`

- [x] 新增原子 claim API：只允許 `pending -> printing`，記錄 `claimed_by`、`claimed_at`、`lease_expires_at`。
- [x] 只有 claim 成功的裝置能讀 payload 與提交結果。
- [x] terminal status 只能寫入一次；重複 callback 應回傳相同成功結果，不能產生重複 log。
- [x] 逾時 lease 可安全釋放或由管理者重派，並記錄 `attempt_count`。
- [x] iOS 以 `remoteId` 去重，不因回報失敗又同步出第二份本機任務。

驗收：兩台 iPhone 同時刷新與點列印時，只有一台能 claim；相同 callback 重送不會改變結果或新增重複紀錄。

#### 3. 修正發票版面與文字編碼的確定性錯誤

- [x] 移除寫死的 `114年07-08月`，依 `issuedAt` 動態計算民國年與雙月期別。證據：`openvoKao/ReceiptRenderer.swift:31-37`
- [x] Big5 fallback 應先把不支援字元替換，再把整段安全字串編碼成 Big5；目前只要有一個 emoji，整行中文就會改送 UTF-8。證據：`openvoKao/ReceiptRenderer.swift:118-131`
- [x] `twoColumn` 在左右文字超過紙寬時要截斷或換行，不能直接溢出。證據：`openvoKao/ReceiptRenderer.swift:95-102`
- [x] 對 QR payload 長度設上限並安全計算 ESC/POS 長度欄位，避免轉成 `UInt8` 時越界。證據：`openvoKao/ReceiptRenderer.swift:133-142`
- [x] 依產品決策只支援固定 58mm 版面，不保留 80mm 設定或分支。
- [ ] 用正式財政部測試資料驗證 QR code、條碼、期別、總額與統編，不以 demo 字串作為完成標準。

驗收：跨年、每個雙月邊界、emoji／罕見字、超長品名與 58mm 版面都有 renderer test；實體條碼與 QRCode 另做硬體驗收。

#### 4. 移除並輪替可能已洩漏的 App Key

`CompanyProfile.initial` 內有一段看似真實的 App Key，且 `CompanyProfile`、auth token、device token 都會被完整編碼到 `UserDefaults`。這也違反專案「iOS 不保存 Amego App Key」的方向。

證據：`openvoKao/AppModels.swift:230-288`、`openvoKao/AppStore.swift:10-20`、`openvoKao/AppStore.swift:390-397`

- [ ] 立即確認該 App Key 是否曾使用；若是，先在供應商端輪替／撤銷。
- [x] 從 source、預設值、sample data 移除真正 secret，改由後端從資料庫讀取；Git 歷史是否仍含舊值仍待另外確認。
- [x] iOS 模型與 API response 不再包含 `appKey`；前端最多顯示「已設定／未設定」。
- [x] auth token 與 device token 改存 Keychain，登出時刪除；一般 UI 設定才留在 `UserDefaults`。
- [x] 後端資料庫不要保存明文 session／device token，改存不可逆雜湊並支援撤銷。

驗收：對 repo 和產物掃描找不到真正 secret；從裝置備份／UserDefaults 無法取得可直接使用的 token。

#### 5. 讓註冊、建發票與改價格具有原子性

目前建立公司、使用者、session、device，以及建立 invoice、items、print job 都是多次獨立 SQL；中途失敗會留下半套資料。價格小數位轉換也會先改全部商品，再改公司設定。

證據：`backend/src/index.ts:236-338`、`backend/src/index.ts:901-949`、`backend/src/index.ts:1233-1326`

- [x] 將每個業務動作需要的 statements 用 D1 原子批次／等價交易方式一次提交；註冊、建發票列印任務、價格小數位轉換已改成 batch。
- [x] 發票加入公司範圍的唯一鍵與 idempotency key，避免 API retry 重複建單。
- [x] 建立列印任務前驗證 `deviceId` 屬於同一 `companyId`。
- [x] 驗證 `totalAmount == sum(quantity * unitPrice)`；目前列印任務採整數最小金額單位、品項小計精確加總，折扣／退款尚未作為獨立欄位支援，避免負值繞過。
- [x] 驗證發票號碼、隨機碼、統編、日期格式、items 數量與每個文字欄位長度。
- [x] 重要狀態欄位加入資料庫完整性 guard；金額與數量加入合理上下限，避免溢位或負值。

驗收：在每個 statement 人為注入失敗後，資料庫都不會留下孤兒公司、孤兒發票或部分轉換的價格。

#### 6. 補齊登入與 session 的基本防護

目前註冊／登入沒有 rate limit，密碼最低只需 6 字元，session 永不過期；管理員重設密碼後舊 session 仍有效，500 response 也可能把底層錯誤訊息直接回傳。

證據：`backend/src/index.ts:61-233`、`backend/src/index.ts:1175-1199`、`backend/src/index.ts:1358-1408`、`backend/src/index.ts:1598-1628`

- [x] 對註冊、登入、重設密碼及 admin API 加 rate limit／防暴力嘗試策略。
- [x] 密碼先維持現有最低長度檢查；暫不增加常見弱密碼規則。現有 PBKDF2 編碼字串已包含演算法與迭代次數，可供日後升級時辨識版本。
- [x] session 加 `expires_at`、撤銷與定期清理；重設密碼時撤銷該使用者所有 session。
- [x] 未知例外只回傳 request ID 與通用錯誤碼，完整 stack／D1 訊息只寫伺服器 log。
- [x] `ADMIN_TOKEN` 改成可輪替、可稽核的管理機制；production 使用 `ADMIN_TOKEN_HASH`，staging 於正式上線前再評估。

---

### P1：可靠性、安全性與資料正確性

#### 7. 分離會員權限與列印裝置權限

目前只要拿到 device token，就能新增、修改、刪除商品分類與商品，甚至修改全公司的價格小數位設定；列印端憑證權限過大。

證據：`backend/src/index.ts:102-166`、`openvoKao/BackendClient.swift:117-230`

- [x] 商品／分類／公司設定的寫入改用會員 session，device token 只保留 claim、讀取與回報列印任務。
- [x] 定義 owner／staff／printer 等角色與 route-level authorization test。
- [x] 裝置新增、撤銷、改名與 token rotation 必須可管理並有 audit log。

#### 8. 修正裝置身分碰撞

登入時只用 `company_id + deviceName + platform` 找既有裝置；多台都叫「前台列印端」或「iPhone」時會共用同一 token。`/auth/me` 又會回傳公司最早建立裝置的 token。

證據：`backend/src/index.ts:1682-1752`

- [x] iOS 產生並保存 installation ID，登入時明確綁定該 installation。
- [x] `/auth/me` 不回傳其他裝置 token。
- [x] 裝置 token 只在建立／輪替時顯示一次，資料庫保存 hash。

#### 9. 建立真正的 request schema 驗證

TypeScript generic 只在編譯期存在；`request.json()` 可傳入 `null`、array、超長字串或錯誤型別。部分 enum／sort order 遇到錯值還會默默退回預設值。

證據：`backend/src/index.ts:1520-1596`、`backend/src/index.ts:1772-1790`

- [x] 每個 endpoint 使用共用 runtime schema 驗證 body、query 與 path parameter。
- [x] 統一限制 request body、字串、陣列與日期範圍大小。
- [x] 非法 enum 回 400，不要默默改成「顯示／含稅／0」。
- [x] `requirePositiveInteger` 分成允許 0 與必須大於 0；商品數量不可接受 0。
- [x] 統一錯誤格式：`code`、本地化 message、field errors、request ID。

#### 10. 修正報表重複與擴展性問題

「最新列印任務」以秒級 `created_at` 的最大值連接；同一發票在同一秒建立兩筆 job 時可能同時被視為最新，造成商品明細重複、業績灌大。報表也沒有期間上限或 pagination。

證據：`backend/src/index.ts:476-570`

- [x] 用 `ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY created_at DESC, id DESC)` 或等價唯一排序只取一筆。
- [x] 新增 `invoices(company_id, issued_at)`、`invoice_items(invoice_id)` 等實際查詢所需 index，並用 query plan 驗證。
- [x] 不在 indexed datetime 欄位外包 `date()`；改用明確的 UTC／公司時區起訖時間。
- [x] 限制最大日期範圍並加 cursor pagination；大報表改由後端聚合，不把全部 invoice items 拉到手機再計算。
- [x] iOS 日期快速切換時取消舊 request，避免較慢的舊結果覆蓋新範圍。

#### 11. 建立本機同步 outbox 與可恢復狀態

- [x] 列印結果回報失敗時保留 outbox，網路恢復後以 idempotency key 自動重試。
- [x] 本機 job 以 `remoteId` 為穩定 identity；合併同步結果，不以新 UUID 重建同一任務。
- [x] 限制本機歷史數量／保存期限，避免 `UserDefaults` 隨使用時間無限增長。
- [x] fresh install 不預載可操作的 sample jobs；sample data 只在 `DEBUG` 或專用測試畫面出現。
- [x] session restore 只有收到明確 401／403 才清除登入；逾時、離線與 5xx 應保留 session 並顯示可重試狀態。

證據：`openvoKao/AppStore.swift:45-52`、`openvoKao/AppStore.swift:81-94`、`openvoKao/AppStore.swift:216-241`、`openvoKao/AppStore.swift:291-302`、`openvoKao/AppStore.swift:400-438`

#### 12. 補自動化測試與 CI gate

- [x] `ReceiptRendererTests`：民國年期別、Big5 fallback、長行、金額、QR／barcode byte fixture。
- [x] `PrinterManagerTests`：抽出 BLE transport protocol，測 chunk、backpressure、斷線、取消、禁止併發列印。
- [x] `BackendClientTests`：URL、401／500、日期 decode、取消與 timeout。
- [x] Worker integration tests：tenant isolation、auth、claim race、status transition、idempotency、invalid payload。
- [x] D1 migration tests：空庫與帶 fixture 的舊 schema 升級，最後檢查 row count、foreign key 與關鍵查詢。
- [x] CI 至少執行 TypeScript typecheck、Worker tests、migration test、Wrangler dry-run 與無簽章 iOS build。

#### 13. 限縮 CORS 並加入 Web 安全標頭

目前所有 JSON response 都是 `Access-Control-Allow-Origin: *`，而內嵌 admin page 沒有 CSP 等安全標頭。

證據：`backend/src/index.ts:54-59`、`backend/src/index.ts:1792-1805`、`backend/src/index.ts:1816-1975`

- [x] 若管理頁與 API 同源，移除不必要的 wildcard CORS；若另有前端，使用明確 allowlist。
- [x] 加入 CSP、`X-Content-Type-Options`、`Referrer-Policy`、frame policy 與合理 cache policy。
- [x] OPTIONS 只對允許的 route／origin 回應，並加入測試。

#### 14. 增加可觀測性與稽核

- [x] 每個 request 產生 request ID，結構化記錄 route、status、latency、company/device，但不記 token、密碼或完整發票敏感資料。
- [x] 記錄登入失敗、admin 操作、裝置 token 輪替、列印 claim／完成／失敗等 audit event。
- [x] Cloudflare production 開啟適當取樣的 observability，為 5xx、重複列印與長時間 pending 設告警。

---

### P2：維護性與效能

#### 15. 拆分大型 Worker 單檔

- [x] 依 `routes / auth / catalog / print-jobs / reports / devices / validation / responses` 拆模組；已拆出 `routes`、`catalog`、`print-jobs`、`reports`、`devices`、`crypto utils`、`auth helpers`、`request parsers/normalizers`、`validation`、`responses/http`、`types`、`domain-types`、`constants` 與 admin page。`index.ts` 已從 3310 行降到約 1173 行，先停在可維護範圍。
- [x] 將 inline admin HTML 移成獨立檔案，避免 API、CSS、JS 全擠在 `index.ts`；正式前端專案可留待後續。
- [x] `Env` 改由 Wrangler config 產生型別，CI 檢查型別是否與 bindings 同步。

證據：`backend/src/index.ts`

#### 16. 改善 iOS 狀態管理與請求併發

- [x] 不共用單一 `isSyncing`／`syncMessage` 表示所有功能，改為 queue、catalog、device、report 各自狀態或 operation counter。
- [x] `refreshCatalog()` 等兩個 request 全部成功後再一次提交畫面狀態，避免只更新一半。
- [x] 對重複刷新、日期變更與 view 消失支援 task cancellation／debounce。
- [x] 將 API machine error code 對應為可本地化訊息，不直接顯示底層英文錯誤。

證據：`openvoKao/AppStore.swift:34-35`、`openvoKao/AppStore.swift:97-122`、`openvoKao/ContentView.swift:151-159`

#### 17. 清理 repository 與部署設定

- [x] 新增 `.gitignore`，移除已追蹤的 `.ipa`、`xcuserdata`、`.xcuserstate`、`.DS_Store`、DerivedData 與 Wrangler 本機 state。
- [x] binary artifact 改放 release／artifact storage，不要放 Git；目前已取消追蹤 debug IPA，CI 會上傳 unsigned simulator app artifact。
- [x] 建立明確部署 dry-run；目前產品尚未正式上線，先用現有 D1 測試，不建立 staging D1，正式上線前再評估 staging／production 分離。
- [x] 已將 `wrangler.toml` 遷移為有 schema 提示的 `wrangler.jsonc`，並以 package lock 固定目前 Wrangler 版本。
- [x] 補根目錄 README：架構、資料流、列印狀態機、開發／測試／部署命令、secret 處理方式。

#### 18. 同步文件與實際設定

文件已同步現況：`wrangler.jsonc` 已有 database ID、app 有 production URL、後端已有註冊登入，Bundle ID 與 Team ID 也已和 Xcode project 統一。

- [x] 把 `todo.md` 改成只保留產品里程碑，完成狀態以現況重寫。
- [x] 更新 `backend/README.md` 的 limitations；目前已有 password hashing 與登入流程。
- [x] 確認並統一正式 Bundle ID、Team ID 與文件，避免續裝、簽章或 App Store 身分混亂。

證據：`todo.md`、`backend/README.md`、`backend/wrangler.jsonc`、`openvoKao.xcodeproj/project.pbxproj`

---

### 建議執行順序

1. 先用目前實機流程做整套人工驗收：登入、解除綁定、商品同步、列印、失敗回報、離線重試。
2. 確認舊 App Key 是否曾經是真實憑證；若是，先在供應商端撤銷或輪替。
3. 用最新版分段點陣傳輸補印，確認實體 QRCode 出現後可掃描，並比對 D1 保存內容。
4. 使用條碼掃描器或手機確認 Code128 內容與 Amego `barcode` 一致。
5. 完成整套產品 UI、App Store 身分與至少第二款 58mm 印表機驗收。
6. 產品正式上線前，再評估是否需要 staging／production D1 分離。

### 完成標準

- 任何一張發票在併發、斷線、重試後都不會被自動重複列印。
- 傳輸未完成或失敗時，伺服器不會收到 `printed`。
- iOS、Git、log、D1 都沒有可直接使用的 Amego secret 或明文 bearer token。
- 發票、品項、列印任務永遠一起成功或一起失敗，重送同一請求不會重複建單。
- renderer、Worker 狀態機、D1 migration 與關鍵 API 都有可重複執行的自動化測試。

---

## 3. Amego 開票資料與發票列印

更新日期：2026-07-13

### 重要結論

OpenKao 不是電子發票加值中心，不自行產生財政部 QRCode 的 AES 驗證內容，也不自行重算左右 QRCode。

正式流程應為：

1. OpenKao 後端將交易與商品資料送至光貿 Amego。
2. Amego 開立發票並回傳正式發票資料。
3. OpenKao 將 Amego 回傳的 `invoice_number`、`random_number`、`barcode`、`qrcode_left`、`qrcode_right` 等欄位原樣保存。
4. iPhone 使用上述正式字串自行排版與列印，避免直接使用 `base64_data` 時受到印表機型號與 ESC/POS 實作差異影響。
5. 若特定印表機確認可正確使用 Amego 的 `base64_data`，才把它當成該印表機設定檔的相容列印方式。

### 已確認現況

- [x] `openvoice` 使用 `POST https://invoice-api.amego.tw/json/f0401` 開立發票。
- [x] `openvoice` 送出表單欄位 `invoice`、`data`、`time`、`sign`，簽章為 `md5(data + time + appKey)`。
- [x] `openvoice` 使用 `POST https://invoice-api.amego.tw/json/invoice_query` 查詢發票明細。
- [x] Amego 開票成功結果可提供 `invoice_number`、`barcode`、`qrcode_left`、`qrcode_right` 與 `base64_data`。
- [x] `base64_data` 是依 `PrinterType` 產生的印表機指令資料，不是 PNG、JPG 或 QRCode 原始字串。
- [x] Amego 的 `PrinterLang` 可指定印表機文字編碼；目前大陸印表機應使用 GBK 設定。
- [x] `openvoice` 直接解碼 `base64_data` 後送進印表機，因此舊版發票上的條碼與雙 QRCode 都由 Amego 的列印資料產生。
- [x] `openkao` iOS `ReceiptRenderer` 已使用 Amego 的左右 QRCode payload 合成同一張點陣圖，一維條碼使用 Code128。
- [x] `openkao` 後端已完成 Amego 正式開票、缺欄位補查、補印與作廢流程，App Key 從 D1 公司設定讀取。
- [x] PDF 與獨立點陣驗證可產生包含黑點的雙 QRCode；實體 58mm 印表機曾保留圖高但未印出黑點，問題已縮小到 ESC/POS／藍牙／機芯相容性。
- [ ] 以最新版 `336 x 150` 合成圖、23 點左邊界及三段 `336 x 50` 傳輸重新做實體補印驗證。

### 資料責任

#### Amego 負責

- 正式開立電子發票。
- 分配發票號碼與隨機碼。
- 產生官方可用的 `barcode`、`qrcode_left`、`qrcode_right`。
- 處理 QRCode AES 驗證資訊及財政部規格細節。
- 回傳開票成功或失敗結果。

#### OpenKao 後端負責

- 從 D1 讀取該公司的 Amego 開票號碼與 App Key。
- 驗證交易金額、商品、載具、統編與捐贈碼後呼叫 Amego。
- 保存開票請求摘要、Amego 正式回應與開票狀態。
- 建立只包含 Amego 正式列印資料的 `print_job`。
- 支援查詢、補印、作廢與錯誤追蹤。

#### iPhone 負責

- 取得後端建立的列印工作。
- 紙面中文依印表機設定使用 GBK。
- QRCode 直接使用 Amego 回傳的原始 payload bytes，不做 GBK 轉碼。
- 將 Amego 回傳的一維條碼與左右 QRCode 產生穩定的點陣圖後列印。
- 回報列印成功、失敗與錯誤原因。

### P0：修正目前錯誤方向

- [x] 停止把 OpenKao 的自製 QR payload builder 接入正式開票與列印流程。
- [x] 移除或隔離目前實驗性的 77 碼組合、商品切碼及自行產生左右 QRCode 邏輯。
- [x] 移除或隔離公司 QRCode AES Key 設定頁、加密儲存欄位與相關 API；Amego App Key 繼續保留。
- [x] `PrintJobPayload` 不再接受後端自行計算的正式發票 QRCode，只能使用 Amego 回傳或既有舊工作保存的 payload。
- [x] 修正測試名稱與內容，避免測試通過卻驗證了錯誤的加值中心流程。

### P1：後端串接 Amego

#### A. 開票請求

- [x] 新增單一 Amego API client，集中處理網址、表單編碼、逾時、回應解析與錯誤格式。
- [x] App Key 必須從 D1 的公司資料讀取，不可寫死在 iOS 或程式碼中，也不可回傳手機。
- [x] 後端依 `openvoice` 的方式建立 `ProductItem`，包含 `Description`、`Quantity`、`UnitPrice`、`Amount`、`Remark`、`TaxType`。
- [x] 支援一般消費者、公司統編、手機條碼載具與捐贈碼，並驗證彼此不能使用的組合。
- [x] 確認 `BuyerIdentifier` 空值格式、稅額計算及 `PrinterType` 的實際值，不直接照搬舊版的 `PrinterType: 5`。
- [x] 大陸印表機使用 Amego 支援的 GBK `PrinterLang` 值，並將其做成公司設定。（D1 預設 `2=GBK`，只有設定 `PrinterType` 才送出）
- [x] 每筆交易在呼叫前提供唯一且穩定的 `OrderId`；同一筆交易重試沿用原值，內容不同則拒絕，避免重複開票。
- [x] 僅由後端計算 `sign = md5(data + time + appKey)` 並送至 Amego `f0401`。

#### B. 開票結果

- [x] 先保存 `issuing` 狀態，再呼叫 Amego；成功改為 `issued`，明確失敗改為 `failed`。
- [x] 若 Amego 呼叫逾時或結果不明，不可直接重送開票；先用 `OrderId` 或查詢 API 確認是否已開立。
- [x] 同時支援並記錄 Amego 實際回應的頂層或 `data` 物件格式，解析後統一成 OpenKao 內部格式。
- [x] 成功時驗證並保存 `invoice_number`、`invoice_date`、`invoice_time`、`random_number`、`barcode`、`qrcode_left`、`qrcode_right`。
- [x] 保存銷售額、稅額、總額、買方統編、賣方統編、載具、捐贈碼與商品明細。
- [x] `amego_response_json` 保存必要回應與錯誤資訊，但遮蔽 App Key、簽章及其他秘密。
- [x] `base64_data` 不放入一般回應摘要；若確定需要保存原始列印資料，再評估獨立欄位或檔案儲存，避免 D1 資料列過大。
- [x] 若成功回應缺少 `barcode`、`qrcode_left` 或 `qrcode_right`，使用 `invoice_query` 補查；仍缺少時不得建立正式列印工作。

#### C. D1 資料表

- [x] 為 `invoices` 增加或確認以下欄位：Amego `OrderId`、開票狀態、發票日期、發票時間、銷售額、稅額、條碼字串、左 QRCode、右 QRCode及錯誤代碼。
- [x] `invoice_items` 保存開票當下的商品快照，不因商品主檔後來改名或改價而變動。
- [x] `OrderId`、公司與發票號碼建立唯一限制，防止重複開票或跨公司資料混用。
- [x] 補印一律讀取首次開票時保存的 `barcode`、`qrcode_left`、`qrcode_right`，不可重新計算。
- [x] 作廢後更新發票狀態並保留原始開票與作廢紀錄，不刪除發票資料。

### P2：列印工作與 iOS

#### A. API 合約

- [x] `PrintJobPayload` 正式加入 `leftQRCodePayload`、`rightQRCodePayload` 與 Amego `barcodePayload`。
- [x] 暫時保留舊 `qrCodePayload` 讀取能力，讓已存在的舊列印工作不會崩潰；新發票不得再建立單 QR 工作。
- [x] 建立列印工作前，比對 payload 的發票號碼與 `invoice_id` 保存資料一致；D1 trigger 也會阻擋正式條碼或 QRCode 不一致的工作。
- [x] 手機端只取得列印所需欄位，不取得 Amego App Key、簽章或任何 QRCode AES Key。

#### B. 雙 QRCode

- [x] `AppModels.PrintJob`、`BackendClient` 與測試 fixture 改為左右兩個 QRCode payload。
- [x] `ReceiptRenderer` 將左右 QRCode 合成同一張黑白點陣圖後列印，固定大小、間距、上緣與 quiet zone。
- [x] 列印版面僅支援 58mm 紙寬，採固定版面；長商品名稱不得推擠或縮放 QRCode。
- [x] QRCode 使用 Amego 字串的原始 UTF-8 bytes，不套用紙面中文的 GBK 編碼。
- [ ] 掃描結果必須與 D1 保存的 `qrcode_left`、`qrcode_right` 完全一致，右碼是否以 `**` 開頭以 Amego 實際回傳為準。

#### C. 一維條碼

- [x] 一維條碼內容只使用 Amego 回傳的 `barcode`，OpenKao 不自行拼接期別、發票號碼或隨機碼。
- [x] Code39 視為政府建議與相容選項，不在程式中寫死為唯一格式。
- [x] 依目前印表機相容性需求選用 Code128；實體印表機掃描驗收仍列在 P4。
- [x] 不依賴各印表機品質不一的內建條碼指令，改由 iOS 產生固定模組寬度、高度與 quiet zone 的黑白點陣圖。
- [x] 條碼圖片不經列印驅動縮放，避免線寬不均造成無法掃描。
- [ ] 條碼下方顯示與 Amego `barcode` 相同的人眼可讀文字；目前 renderer 只印點陣條碼。

#### D. 列印模式

- [x] 僅使用 OpenKao 固定 58mm renderer 加上 Amego 正式 payload。
- [x] 不採用 Amego `base64_data` 相容模式，避免印表機型號差異、無法可靠判斷列印結果及回退時重複列印。

### P3：查詢、補印與作廢

- [x] 發票管理頁從 D1 顯示 `issuing`、`issued`、`print_pending`、`printed`、`print_failed`、`voided` 等狀態。
- [x] 發票詳情可用 Amego `invoice_query` 補查並修復缺少的正式欄位。
- [x] 補印建立新的 `print_job`，但沿用同一張發票保存的正式 payload。
- [x] 作廢呼叫 Amego 對應 API，成功後更新狀態並寫入稽核紀錄。
- [x] 任何補查、補印與作廢都必須限制在登入者所屬公司。

### P4：測試與驗收

- [x] Amego client 使用遮蔽敏感資料的固定回應 fixture，測試成功、業務錯誤、HTTP 錯誤、逾時與不完整回應。
- [x] 測試同一 `OrderId` 重試不會建立兩張發票。
- [x] 測試一般消費者、公司統編、手機載具、捐贈碼、單一商品與多商品。
- [x] 測試繁體中文商品名稱在紙面以 GBK 正常列印，QR payload 本身不被轉碼。
- [x] 將 58mm 列印結果輸出為 PDF 或圖片預覽，確認雙 QRCode、條碼、文字與紙張邊界。（`output/pdf/openkao-58mm-invoice-preview.pdf`）
- [ ] 使用手機掃描左右 QRCode，結果必須與 Amego 回傳內容逐字相同。
- [ ] 使用條碼掃描器或手機測試一維條碼，結果必須與 Amego `barcode` 逐字相同。
- [ ] 至少以兩款實體印表機測試；PDF 預覽只能驗證版面，不能取代實機掃描測試。
- [x] 驗證列印失敗不會改變發票內容，也不會重複向 Amego 開票。

### 建議執行順序

1. 先用最新版補印，確認三段式 `GS v 0` 能在目前 58mm 印表機印出完整雙 QRCode。
2. 掃描左右 QRCode 並逐字比對 D1 的 `qrcode_left`、`qrcode_right`。
3. 掃描 Code128 並比對 Amego `barcode`；決定是否補印條碼下方的人眼文字。
4. 至少再用第二款 58mm 印表機完成相同驗收。

### 驗收標準

- 每張正式發票的號碼、隨機碼、一維條碼與左右 QRCode 都直接來自 Amego。
- OpenKao 不保存或自行產生 QRCode AES Key，不扮演加值中心。
- Amego App Key 只在後端使用，從 D1 公司資料讀取，不會出現在手機、log 或 API 回應。
- 同一筆交易即使網路逾時或重試，也不會重複開立發票。
- 僅支援 58mm 紙寬，版面可完整列印；紙面中文正常，左右 QRCode 與一維條碼可掃描。
- 補印內容與第一次開票保存的正式內容完全一致。

### 參考

- `openvoice/lib/widgets/payment_dialog.dart`：舊版 `f0401` 開票、簽章及 `base64_data` 列印流程。
- `openvoice/lib/services/invoice_service.dart`：舊版 Amego 開票資料組合。
- `openvoice/lib/pages/invoice_detail.dart`：`invoice_query` 查詢與作廢流程。
- `openvoice/lib/utils/print_utils.dart`：`base64_data` 解碼後直接送印表機。
- Amego API 文件：https://invoice.amego.tw/api_doc/
- Amego API 呼叫範例：https://invoice.amego.tw/api_doc/example

---

## 4. 電子發票證明聯格式調整

更新日期：2026-07-13

### 參考文件

- `/Users/user/Downloads/Eg01.pdf`：財政部電子發票證明聯格式一規格。
- `/Users/user/Downloads/53617503_OUT_20260712140504.pdf`：實際電子發票證明聯範例。

### 重要結論

58mm 電子發票證明聯的列印順序應以格式一為主：

1. 營業人識別標章或公司名稱。
2. 電子發票證明聯。
3. 年期別。
4. 統一發票字軌號碼。
5. 交易日期時間。
6. 隨機碼與總計。
7. 賣方與買方統編；買方為營業人時加列格式代號。
8. 一維條碼。
9. 左右兩個 QRCode。
10. B2C 與 B2B 都接續列印銷貨明細單。

OpenKao 仍維持之前的決定：條碼位置依官方格式，但一維條碼圖像使用 Code128 點陣圖，以提高 58mm 熱感印表機掃描相容性。

電子發票證明聯寬 5cm、長 9cm 版型條件下，`電子發票證明聯`、年期別、統一發票字軌號碼與補印文字高度需達 0.5cm 以上；年期別與發票字軌號碼需為粗體，其餘文字高度至少 0.2cm 以上。這是字體高度規格，不是要求條碼、QRCode 或交易明細必須壓在 9cm 內。58mm 熱感紙只能固定寬度，不能固定或裁切整張發票長度；商品越多，紙張長度必須自然延伸，總計與後續資訊一定要在所有商品明細之後完整印出。

### P0：已完成的格式修正

- [x] 讀取並渲染 `Eg01.pdf`，確認格式一規格。
- [x] 讀取並渲染 `53617503_OUT_20260712140504.pdf`，確認實際樣張位置。
- [x] 將手機列印順序改為：上半部資料、一維條碼、左右 QRCode、交易明細。
- [x] 將 PDF 預覽同步改成與手機列印相同方向。
- [x] B2B 樣張顯示 `格式:25`。
- [x] B2B 樣張顯示買方統編。
- [x] B2B 明細下方顯示銷售額、稅額、總計。
- [x] B2C 不顯示 `格式:25` 與買受人統編，但仍列印銷貨明細單、商品、總計與課稅別。
- [x] B2B 銷貨明細單顯示買受人統編、營業人統編、公司名稱與交易時間。
- [x] B2C 與 B2B 每筆商品的金額後都附加課稅別 `TX`，例如 `2,400TX`。
- [x] 商品品名每行最多 12 個列印寬度（6 個中文字或 12 個英數字元）；過長時換行後再列數量、單價與 `金額TX`。
- [x] 列印流程不得限制整張紙長；交易明細逐行輸出，商品多時自然延長紙張。
- [x] 重新產生 `output/pdf/openkao-58mm-invoice-preview.pdf`。
- [x] `ReceiptRendererTests` 通過。
- [x] `git diff --check` 通過。

### P1：資料欄位補齊

- [x] `PrintJobPayload` 增加或確認可攜帶 `salesAmount`、`taxAmount`、`invoiceFormatCode`。
- [x] 後端建立正式發票列印工作時，直接使用 D1 保存的銷售額與稅額，不讓 iPhone 重新推算。
- [x] iOS `PrintJob` 增加 `salesAmount`、`taxAmount`、`invoiceFormatCode` 可選欄位。
- [x] `BackendClient` 解碼上述欄位，舊列印工作缺欄位時仍可列印。
- [x] 測試 B2B 發票使用後端提供的銷售額與稅額，不因四捨五入差異造成紙面錯誤。

### P2：格式細節

- [x] 日期時間改成官方格式 `yyyy-MM-dd HH:mm:ss`，確認後端與 iOS 時區一致。
- [x] 發票號碼是否要顯示連字號，例如 `AB-12345678`，以 Amego 回傳或實務樣張決定。
- [x] B2B 表頭固定為 `品名 數量 單價 金額`。
- [x] B2C 與 B2B 都列印品名、數量、單價與 `金額TX`；B2B 額外列印銷售額與稅額。
- [x] 課稅別顯示改為官方代碼：應稅 `TX`、零稅率 `TZ`。
- [x] 補印時在 `電子發票證明聯` 旁或附近加註 `補印`，補印文字高度至少 0.5cm。
- [x] 手機列印與 PDF 預覽的重點文字符合 5cm x 9cm 版型字高規格：標題、年期別、發票字軌號碼與補印文字高度至少 0.5cm，其餘文字至少 0.2cm。
- [x] 手機列印同時送出一般字元與中文機芯的放大指令，讓標題、年期別與發票號碼高度一致。

### P3：條碼與 QRCode

- [x] 一維條碼資料值以 Amego 回傳的 `barcode` 為準，但不得使用 Amego `base64_data` 或印表機型號相關的條碼列印資料。
- [x] 一維條碼圖像由 OpenKao 固定 renderer 產生 Code128 點陣圖，避免不同 58mm 印表機對 Amego/ESC-POS 條碼指令支援不一致。
- [x] QRCode 內容仍只使用 Amego 回傳的 `qrcode_left`、`qrcode_right`。
- [x] 左右 QRCode 合成同一張 `336 x 150` 點陣圖，設定 23 點左邊界後以 `GS v 0` 傳送，對齊光貿實際列印格式。
- [x] 藍牙列印時將合成圖按列切成三個連續的 `336 x 50` 傳輸區段，避開印表機單一點陣命令可能低於 6.3 KB 的緩衝上限；左右 QRCode 仍是同一張圖，不分開列印。
- [x] 掃描 PDF 或圖片中的左右 QRCode，確認內容可讀出。
- [ ] 使用實體 58mm 印表機列印後，掃描左右 QRCode。
- [ ] 使用實體 58mm 印表機列印後，掃描一維條碼。
- [ ] 若 Code128 實機掃描仍不穩，再評估增加公司或印表機層級的條碼模式設定。

### P4：PDF 預覽與驗收

- [ ] PDF 預覽資料改成更接近真實 Amego 回傳欄位，而不是手寫假資料。
- [ ] PDF 預覽同時提供 B2C 與 B2B 兩種樣張。
- [ ] PDF 預覽標示 58mm 紙寬與 5cm x 9cm 版型字高參考。
- [ ] 用手機掃 PDF 預覽中的 QRCode，確認內容能讀出。
- [ ] 用至少兩款 58mm 實體印表機做最終列印驗收。

### P5：部署與手機驗證

- [ ] 套用後端 migration 到目前使用中的 D1。
- [ ] 部署 Worker。
- [ ] 重新安裝 iPhone app。
- [ ] 從手機開一張測試發票，確認列印工作內容包含正式 barcode 與雙 QRCode。
- [ ] 手機列印畫面確認新格式已生效。

### 驗收標準

- 紙面順序符合格式一：條碼與雙 QRCode 在交易明細之前。
- B2B 發票顯示買方統編、格式代號、銷售額、稅額與總計。
- B2C 與 B2B 都列印銷貨明細單；B2C 不顯示買受人統編與 B2B 稅額拆分。
- B2C 與 B2B 每筆明細金額後都顯示 `TX`。
- 一維條碼與左右 QRCode 內容都來自 Amego，不由 OpenKao 自行組合。
- 5cm x 9cm 版型條件下的重點文字高度與粗體規則符合財政部尺寸要求。
- PDF 預覽與手機實際列印邏輯一致。
- 實體 58mm 印表機列印後，QRCode 與一維條碼可掃描。

---

## 5. 待印區、公司權限與手機配額

更新日期：2026-07-14

### 重要結論

1. **待印區不應自動全部列印**。櫃台操作需要「先看清楚、再決定印哪張」，因此進入「待印」頁面只同步工作與自動連線印表機，不主動送印。
2. **每張待印發票都應能單獨列印**。透過左滑該列即可觸發，不必強迫照順序印。
3. **「全部列印」按鈕要清楚可見**。toolbar 上只用圖示會讓使用者找不到，必須同時顯示文字。
4. **連續列印需要間隔**。雖然 ESC/POS 資料本身正確，但 BLE 熱感印表機的緩衝區/出紙節奏跟不上時，會在後面幾張（尤其最後一張）的 QR code 區段出現亂碼。實測 0.5 秒間隔可穩定避免此情況。
5. **列印偵錯用的 dump 檔案必須移除**。每次列印都把整份 ESC/POS bytes 寫進 `Documents/PrintDumps/` 會讓 app 容器快速變大；改由單元測試或需要時再手動列印觀察。

### 已完成的修改

#### 待印區流程（`openvoKao/ContentView.swift`）

- [x] 移除原本進入頁面就自動全部列印的機制。
- [x] 進入「待印」頁面時，若尚未連線且有已儲存印表機，自動呼叫 `reconnectSavedPrinter()`。
- [x] 藍牙狀態變為「可用」時，若仍未連線也會自動重連。
- [x] 頂部 toolbar 新增「🖨️ 全部列印」按鈕，同時顯示圖示與文字。
- [x] 待印清單每一列支援左滑顯示綠色「列印」按鈕，可單獨列印該張。
- [x] 保留點擊列開啟「列印預覽」的功能。
- [x] `printAll()` 在連續發票之間加入 0.5 秒延遲，避免 BLE 傳輸節奏導致亂碼。
- [x] 單筆列印仍即時顯示成功/失敗 alert；全部列印只在最後顯示總結 alert。

#### 移除列印偵錯 dump（`openvoKao/PrinterManager.swift`、`openvoKaoTests/ReceiptRendererTests.swift`）

- [x] 移除 `dumpPrintData(_:label:)` 與 `findRasterImageRange(in:)`，不再於每次列印時寫入 `.bin` / `.hex.txt`。
- [x] 移除單元測試中會把資料寫進 `/tmp/openvoKao_dumps` 的偵錯測試，避免測試也產生垃圾檔案。

### QR code 空白問題的根因

在 iPhone 6s Plus 等實機上列印時，曾發現 QR code 區塊整片空白（或只剩 finder pattern 殘影）。分析後發現問題不在 ESC/POS 指令本身，而在 **CoreImage → 光柵 bitmap 的轉換路徑**。

1. **直接原因是 iOS CoreImage 在 `CIContext.render(_:toBitmap:)` 的 L8 灰階路徑上有 bug。**
   - `CIQRCodeGenerator` 產出的 `CIImage` 本身沒有 backing bitmap，必須經過 `CIContext` 渲染才會得到像素。
   - 呼叫 `CIContext.render(_:toBitmap:rowBytes:bounds:format:colorSpace:)` 指定 `kCIFormatL8` 時，iOS 會靜默失敗，回傳的 pixel buffer 全部為 `255`（全白）。Apple 工程師曾在 Stack Overflow 承認 `render(toBitmap:)` 對特定 CIFormat 的支援有限制，而社群也有大量回報指出 L8 在真機與模擬器上都會產生空白/異常結果。
   - 換句話說：不是 A 系列 SoC 效能問題，而是這條 API 在 iOS 上沒寫好。
2. 修正方式改為：
   - `CIContext.createCGImage(_:from:)` 先產生穩定的 `CGImage`。
   - 再用 `CGBitmapContext`（Gray color space、每像素 8 bit）把 `CGImage` 畫進 memory buffer。
   - 最後將 threshold < 128 的 pixel 視為黑色，轉成 `ESCPosRasterImage`。
3. 左右雙 QR 因資料長度不同，原始 matrix 寬度也不同。若用相同 scale 縮放，版本較小的 QR 會被縮得太小，因此改為 **分別計算各自 scale**，讓左右兩個 QR 都盡量填滿各自的 canvas，視覺大小一致。
4. 繪製時原本多算了一次 quiet zone offset，會把 QR 符號推出 canvas 邊界，導致 finder pattern 被截斷；修正後讓符號完整置中於 canvas 內。

相關檔案：`openvoKao/ReceiptRasterizer.swift`。

### 驗證結果

- iPhone 6s Plus 實機測試：
  - [x] 進入待印頁面自動連線已儲存印表機。
  - [x] 左滑單筆列印，印完後該筆從待印區消失。
  - [x] 「全部列印」連續印多張，最後一張 QR code 不再亂碼。
- 單元測試：
  - 待印區功能完成時共執行 26 筆測試，25 筆通過。
  - `testOfficialHeaderUsesRequiredLargeBoldText` 仍失敗，此為先前已存在的問題，與本次待印區改動無關。

### 未來可選優化

- [ ] 若 0.5 秒間隔在某些印表機上仍太短，可改成動態依列印結果調整，或於設定頁提供「連續列印間隔」選項。
- [ ] 若印表機支援，可嘗試用 `DLE EOT n` 主動查詢印表機狀態來取代固定延遲；光貿 BLE 小票機目前不確定支援，故先以 delay 解決。
- [ ] 後續若要保留偵錯能力，可改為只在發生列印失敗時把該筆資料寫入暫存，並限制只保留最近 N 份。

### 公司成員權限與手機配額

#### 需求定義

這裡要控制的是兩件不同的事情，不能混為同一個數字：

1. **帳號角色**：決定登入者可以做什麼。老闆可管理公司、員工、手機與商品；員工只能查看商品，並負責開票、查詢及列印。
2. **公司手機配額**：決定同一家公司全部帳號合計最多可綁幾支實體手機，例如公司配額為 3，就算有 10 個員工帳號，也只能綁定 3 支手機。

一個帳號不等於一支手機。同一位員工換手機會占用新的裝置名額；同一支已綁定手機重新登入不重複計算。

#### 目前已有的基礎

- [x] `users.role` 已存在，後端可辨識 `owner`、`staff`、`printer`。
- [x] 第一位註冊公司的使用者會成為 `owner`。
- [x] 商品與分類寫入已改為只有 `owner` 可用；`staff` 只能讀取。
- [x] 裝置管理與稽核紀錄目前只允許 `owner`。
- [x] `printer` 不能開立或管理發票，作為印表裝置的內部角色使用。
- [x] `companies.unbind_code`、`devices.installation_id` 與登入工作階段的 `device_id` 已存在。
- [x] 每家公司已有獨立 8 位數解除碼，並依先前決定保存在 D1 供本公司管理人員查閱。
- [x] 已完成公司成員管理 API 與 iPhone 介面。
- [x] 已依下方矩陣統一後端與 iPhone 權限。
- [x] 已增加公司層級的手機配額欄位、滿額檢查與競爭保護。
- [x] 登入已改為多機配額模式，不再刪除公司全部舊手機。

#### 確認的權限矩陣

| 功能 | 老闆 `owner` | 員工 `staff` | 印表裝置 `printer` |
| --- | --- | --- | --- |
| 商品、分類查詢 | 可 | 可 | 不可 |
| 商品、分類新增、修改、排序與刪除 | 可 | 不可 | 不可 |
| 開立發票 | 可 | 可 | 不可 |
| 發票查詢、列印、補印 | 可 | 可 | 僅領取列印工作 |
| 發票作廢 | 可 | 建議不可 | 不可 |
| 業績報表 | 可 | 建議不可 | 不可 |
| 公司與 Amego 設定 | 可 | 不可 | 不可 |
| 查看公司員工帳號 | 可，只看同公司 `staff` | 不可 | 不可 |
| 新增、修改、刪除員工帳號 | 可 | 不可 | 不可 |
| 已綁定手機清單 | 可 | 不可 | 不可 |
| 解除或更換手機 | 需輸入本公司提供的解除碼 | 不可 | 不可 |
| 修改公司手機配額 | 不可，由 OpenvoKao 系統管理員修改 | 不可 | 不可 |

> `printer` 不應出現在一般會員的角色選單，它是後端與印表裝置使用的內部角色。員工能否作廢發票、查看業績，可在實作前再調整；上表先採較保守的建議。

#### P0：資料表與遷移

- [x] 在 `companies` 增加 `max_bound_devices INTEGER NOT NULL DEFAULT 1`，限制必須大於或等於 1。
- [x] 遷移既有公司時設為 `MAX(1, 目前已綁定手機數)`，避免部署後立刻超額。
- [x] 手機配額只計算 `devices.installation_id IS NOT NULL` 的實體綁定裝置；尚未綁定的預建裝置不占名額。
- [x] 在 `users` 增加 `is_active`，停用員工後不得再登入，並撤銷其現有工作階段。
- [x] 保留現有 `owner / staff / printer` 資料庫約束，避免寫入未知角色。
- [x] 成員停用、密碼重設、配額及解除綁定異動都寫入 `audit_logs`，且不記錄密碼內容。

#### P1：後端權限統一

- [x] 建立集中式 owner 權限檢查，後端 API 強制執行，不只靠 iPhone 隱藏按鈕。
- [x] 將公司設定、Amego Key、成員管理、手機管理及稽核紀錄限制為 `owner`。
- [x] 商品與分類的新增、修改、排序及刪除全部限制為 `owner`；`staff` 只能讀取商品與分類。
- [x] 開票、發票查詢、列印與補印允許 `owner`、`staff`。
- [x] 發票作廢與業績報表依上方矩陣限制為 `owner`。
- [x] 被停用的帳號即使仍持有尚未到期的 token，也會被後端拒絕。
- [x] 拒絕會回傳 `owner_required`、`account_disabled`、`device_limit_reached` 等明確錯誤碼與中文訊息。

#### P2：公司成員管理

- [x] 增加公司員工清單 API；`owner` 只能看見自己公司的 `staff`，不能讀取其他公司的帳號。
- [x] 老闆可新增員工帳號；新帳號固定為 `staff`，帳號不使用 `@`。
- [x] 新增員工時設定臨時密碼，密碼雜湊保存，不保存明文。
- [x] 老闆可修改同公司員工的姓名、電話及臨時密碼，不能操作別家公司使用者。
- [x] 刪除員工採停用帳號的軟刪除，立即撤銷工作階段並保留歷史與稽核資料。
- [x] 一般員工清單預設不顯示停用帳號；iPhone 管理畫面明確要求包含停用帳號，以供老闆恢復。
- [x] 老闆可替同公司員工設定臨時密碼；系統管理員原有跨公司重設能力仍保留。
- [x] 成員 API 固定只操作 `staff`，無法停用、刪除或降級 `owner`。
- [x] 員工無法修改角色或把自己提升為 `owner`。
- [x] 密碼重設與停用操作寫入稽核紀錄，紀錄中不保存密碼內容。

#### P3：公司手機配額

- [x] 系統管理員可設定每家公司 `max_bound_devices`；客戶公司的老闆只能查看配額。
- [x] 公司回應增加 `deviceLimit` 與 `deviceUsed`，iPhone 顯示「已綁定 2 / 3 支手機」。
- [x] 相同 `installation_id` 再登入只更新 token 與工作階段，不增加使用數。
- [x] 新手機在配額內直接建立，不刪除其他已綁定手機。
- [x] 配額已滿回傳 `409 device_limit_reached`，並附目前使用數與上限。
- [x] 配額檢查與新增使用單一條件式 SQL；兩支手機搶最後名額時只會一支成功。
- [x] 登出只撤銷工作階段，不釋放手機名額；正式解除綁定才釋放。
- [x] 旋轉 token、App 重新開啟及同機重新登入不重複占用名額。
- [x] 解除手機使用公司 8 位數解除碼，且只處理指定裝置；單機換機也不再刪除公司全部裝置。
- [x] 系統管理員不能把配額降到低於目前已綁定數量。
- [x] 註冊、一般登入、owner 建立綁定裝置及換機流程使用相同配額規則。
- [x] 原本 `device_binding_locked` 單機流程已改為多機配額語意。

#### P4：iPhone 介面

- [x] 「印表」頁新增「員工與手機」入口，只讓 `owner` 看見，可管理同公司的 `staff`、臨時密碼與已綁定手機。
- [x] 商品與分類頁只有 `owner` 顯示新增、編輯、排序及刪除操作；`staff` 為唯讀。
- [x] 「員工與手機」頁顯示已綁定裝置、最後使用時間及「已使用 / 上限」。
- [x] 解除指定手機要求輸入本公司提供的 8 位數解除碼，App 不顯示或產生解除碼。
- [x] `staff` 隱藏成員、手機、商品修改、業績與發票作廢入口。
- [x] iPhone 登入及恢復工作階段時依後端角色更新畫面；帳號停用後會清除失效登入。
- [x] 配額已滿時顯示目前 X / Y 支手機與後續處理方式。
- [x] 真正的安全限制由後端執行，前端隱藏只改善操作體驗。

#### P5：測試與驗收

- [x] 測試 `owner` 可使用成員與手機管理 API，`staff` 收到 403。
- [x] 測試 `owner` 可查看、新增、修改、重設密碼及刪除同公司的 `staff`。
- [x] 測試 `staff` 可查看商品、開票、查詢與補印，但不能修改商品、查看業績或作廢發票。
- [x] 測試刪除員工後稽核資料保留，舊 token 立即失效。
- [x] 測試不同公司的老闆不能修改彼此的成員與手機。
- [x] 測試成員 API 不能停用或降級最後一位老闆。
- [x] 測試停用員工後舊 token 立即失效且無法再次登入。
- [x] 測試配額 1、2、3 的新增與滿額情況。
- [x] 測試兩支手機同時搶最後名額時只會一支成功。
- [x] 測試同一支手機重複登入不增加計數，登出也不減少計數。
- [x] 測試解除指定手機後釋放名額，其他手機不受影響。
- [x] 測試 migration 保留既有公司、裝置、商品、發票及列印工作，且外鍵完整。
- [x] 已套用正式 D1 migration 並部署 Worker。
- [ ] 已覆蓋安裝到周璧如的 iPhone；待以老闆與員工帳號完成畫面驗收。

本次公司權限功能驗證（2026-07-14）：

- [x] 後端型別檢查通過。
- [x] 後端與 Amego 整合測試 20 / 20 通過。
- [x] D1 migration 與完整性測試 3 / 3 通過。
- [x] iOS `BackendClientTests` 14 / 14 通過，包含員工清單、裝置配額、解除綁定與滿額訊息。
- [x] iOS 模擬器完整編譯成功。
- [x] iPhone Debug 版本已使用 Apple Development 憑證成功簽名與編譯。
- [x] 遠端 D1 已套用 `0026_company_members_and_device_limits.sql`，查核無不合法配額或帳號狀態。
- [x] Worker 已部署至 `https://openvokao-backend.arguskao.workers.dev`，版本 `7f5c3c50-e734-4077-8e94-156731631d68`，健康檢查正常。

#### 完成標準

- [x] 每家公司至少有一位老闆，員工無法取得老闆權限。
- [x] 權限由後端強制執行，不能透過直接呼叫 API 繞過。
- [x] 只有老闆能改動商品與分類，員工只能查看並選擇商品開票。
- [x] 老闆能查看、新增、修改與刪除自己公司的員工帳號，不能管理其他公司的成員。
- [x] 每家公司可設定獨立手機上限，所有帳號與裝置合計不會超額。
- [x] 同一支手機不重複占名額，解除一支手機只影響該支手機。
- [x] 老闆可管理自己公司的成員與裝置，但不能自行修改公司手機上限。
- [x] 所有重要管理操作都有可追查的稽核紀錄。

#### 建議施工順序

1. P0 資料表與既有資料遷移。
2. P1 後端權限統一。
3. P2 公司成員管理。
4. P3 公司手機配額與換機流程。
5. P4 iPhone 介面。
6. P5 自動測試、D1 部署與實機驗收。

### 相關檔案

- `openvoKao/ContentView.swift`：`PrintQueueView` 與全部列印流程。
- `openvoKao/PrinterManager.swift`：BLE 傳送與 chunk 管理，已移除 dump。
- `openvoKaoTests/ReceiptRendererTests.swift`：已移除會寫入 `/tmp` 的偵錯測試。
- `backend/migrations/0026_company_members_and_device_limits.sql`：公司手機配額與員工啟用狀態。
- `backend/src/members.ts`：同公司員工管理、軟刪除與臨時密碼重設。
- `backend/src/devices.ts`：多機配額、競爭保護與指定手機解除。
- `openvoKao/CompanyAccessView.swift`：老闆的員工與手機管理畫面。

### 參考來源

- [Stack Overflow: How to make use of kCIFormatRGBAh to get half floats on iOS with Core Image?](https://stackoverflow.com/questions/28416330/how-to-make-use-of-kciformath-to-get-half-floats-on-ios-with-core-image) — Apple Core Image 工程師說明 `render(toBitmap:)` 對特定 CIFormat 與環境的限制。
- [Stack Overflow: Swift - Image Data From CIImage QR Code / How to render CIFilter Output](https://stackoverflow.com/questions/51178573/swift-image-data-from-ciimage-qr-code-how-to-render-cifilter-output) — 說明 `CIImage` 需經 `CIContext.createCGImage()` 才能取得可靠 bitmap。
- [Stack Overflow: Converting a large CIImage to CGImage is rendered white](https://stackoverflow.com/questions/69628639/converting-a-large-ciimage-to-cgimage-is-rendered-white) — 實際案例：CoreImage 輸出在特定轉換條件下會變全白。
- [Microsoft Learn: CIFormat Enum (CoreImage)](https://learn.microsoft.com/en-us/dotnet/api/coreimage.ciformat) — CIFormat 格式清單，含 `L8` 定義。

---

## 6. iPhone 13 正式發票亂碼修正

更新日期：2026-07-13

### 一句話說明

問題不在發票內容，也不是 iPhone 13 比 iPhone 6s 差，而是 **iPhone 13 傳送藍牙資料較快，剛好暴露了 P211 印表機處理資料邊界的問題**。

舊程式每 64 bytes 直接切一包，有時會把中文字或圖片指令切成兩半。iPhone 6s 傳送較慢時，印表機通常來得及接續解析；iPhone 13 傳送較快、回呼節奏也不同，印表機較容易失去解析狀態，於是把圖片資料當成文字印出，畫面上就變成大量亂碼。

這也是為什麼「舊手機正常，新手機反而有問題」：**差別在 BLE 傳輸速度與時序，不在手機效能高低。真正無法穩定承受資料流的是印表機。**

> 補充：修正前只從 iPhone 13 取回了完整 Log，沒有取得同版本 iPhone 6s 的對照 Log。因此「6s 因傳得較慢而沒有觸發」是根據傳輸行為與修正結果做出的判斷，不是假裝有量測到的結論。

### 為什麼測試列印正常，正式發票卻亂碼？

兩者產生的資料排列不同。

- 正式發票有中文字、條碼及兩張 QR Code 圖片。
- 正式發票的部分中文字剛好落在 64-byte 分包邊界，被拆成前後兩包。
- 第二張 QR Code 的圖片指令也剛好停在一包的最後，真正的圖片資料要等下一包才送出。
- 測試列印沒有碰到相同的危險邊界，所以看起來一直正常。

從 iPhone 13 的 Log 確認 App 沒有少送、重複送或打亂資料，發票編碼及圖片尺寸也都正確。錯誤發生在「資料如何切包及多快送給印表機」。

### 本次如何修正

#### 1. 不再固定每 64 bytes 硬切

在 `openvoKao/PrinterTransport.swift` 加入 `ESCPosPacketizer`：

- 每包仍不超過印表機可接受的 64 bytes。
- 中文字的兩個 bytes 不拆開。
- ESC/POS 指令不從中間拆開。
- QR Code 圖片指令的 header 不會單獨留在上一包尾端，至少會和第一個圖片 byte 放在同一包。
- 分包方式雖然改變，但全部資料重新接起來仍與原始發票完全相同。

#### 2. 確實限制傳送速度

在 `openvoKao/PrinterManager.swift` 修正節流：

- 每送 2 包，固定等待 40 ms 再繼續。
- 等待期間即使 iPhone 收到「可以繼續傳送」的 BLE 回呼，也不能提早繞過等待。
- 列印完成、失敗或斷線時會取消尚未執行的傳送工作。

修正後已在 iPhone 13 Pro 與 iPhone 6s Plus 實際列印成功。

### 日後遇到列印問題，如何暫時加 Log

這次使用的診斷 Log 已從正式 App 移除。若日後需要追查，可暫時加入 `PrintDiagnosticsLogger.swift`，把檔案存到：

`Documents/PrintDiagnostics/`

至少留下以下三種資料：

1. `print-diagnostics.log`
   - 每次列印是測試列印還是正式發票。
   - 使用哪一種 BLE write type、每包大小及總包數。
   - 每包的編號、原始資料位置、長度及送出時間。
   - BLE ready callback 的時間，以及列印成功或失敗。
2. `*-test-*.escpos.bin`
   - 測試列印實際送給印表機的完整資料。
3. `*-invoice-*.escpos.bin`
   - 正式發票實際送給印表機的完整資料。

Log 寫檔應使用獨立 serial queue，不能因為寫 Log 失敗而中斷列印。`.bin` 可能含發票號碼、統編、品項及 QR Code，分析後應刪除，不要外流。

### 如何用 Xcode 取回 Log

1. 先各印一次「測試列印」與「正式發票」。
2. 等 App 顯示已送至印表機，再把 iPhone 用 USB 接上 Mac 並解鎖。
3. 開啟 Xcode，選擇 `Window` → `Devices and Simulators`。
4. 左側選擇該 iPhone。
5. 在 Installed Apps 選擇 `openvoKao`（`com.kaochifeng.openvoKao`）。
6. 右鍵選擇 `Download Container...`。
7. 對下載的 `.xcappdata` 按右鍵，選擇「顯示套件內容」。
8. 進入 `AppData/Documents/PrintDiagnostics/`。
9. 將 `.log`、測試列印 `.bin` 及正式發票 `.bin` 一起交付分析。

只有 Log 而沒有兩份 `.bin`，會很難確認問題究竟出在發票內容、切包或 BLE 傳送。

### 本次確認結果

- [x] 發票內容及中文字編碼正確。
- [x] App 沒有漏送、重複或打亂資料。
- [x] 改用安全分包，避免拆開中文字及圖片指令。
- [x] 修正 BLE 傳送節流，避免 iPhone 13 傳得太快。
- [x] iPhone 13 Pro 正式發票列印成功。
- [x] iPhone 6s Plus 正式發票列印成功。
- [x] 相關單元測試通過。
- [x] 正式 App 已移除診斷 Logger，不再產生新的 Log 或 `.escpos.bin`。

### 部署注意事項

- 更新 App 時直接覆蓋安裝，不要先刪除 App，才能保留原有 App 資料。
- 除非使用者要求，部署後不要自動開啟 App。

---

## 7. 找零與現場變動價格商品

更新日期：2026-07-20

### 1. 結帳找零

目前結帳畫面需要支援輸入客人實際交付的金額，並即時計算找零。

- 顯示訂單總額、實收金額與找零金額。
- 實收金額由店員輸入，例如客人交付現金 100 元或 1,000 元。
- 找零公式：`實收金額 - 訂單總額`。
- 實收金額不足時，要清楚顯示還差多少，且不能完成結帳。
- 找零為 0 時，顯示「不找零」或 `找零 0 元`。

#### 驗收情境

| 訂單總額 | 實收金額 | 預期結果 |
| --- | ---: | --- |
| 45 元 | 100 元 | 顯示找零 55 元 |
| 45 元 | 1,000 元 | 顯示找零 955 元 |
| 45 元 | 45 元 | 顯示找零 0 元，可完成結帳 |
| 45 元 | 40 元 | 顯示尚差 5 元，不可完成結帳 |

### 2. 現場輸入變動商品價格

部分服務商品沒有固定售價，例如清掃服務會因現場難易度而報價。因此商品主檔需允許設定為「現場報價商品」。

- 建立商品時，可將價格設為 `0` 元並標示為現場報價。
- 店員選取此商品加入訂單後，在結帳前或結帳時必須輸入實際單價。
- 未輸入實際價格時，不能完成結帳。
- 輸入後的單價要立即更新該商品小計、訂單總額、實收金額不足判斷與找零。
- 實際成交價格要寫入該筆訂單與發票明細；不能只讀取商品主檔的 `0` 元預設價格。
- 一般固定價格商品維持既有流程，不需要額外輸入價格。

#### 驗收情境

| 商品 | 商品預設價格 | 結帳時輸入 | 預期結果 |
| --- | ---: | ---: | --- |
| 清掃服務 | 0 元 | 1,500 元 | 訂單及發票品項單價為 1,500 元 |
| 清掃服務 | 0 元 | 未輸入 | 提示需輸入現場報價，不可完成結帳 |
| 一般商品 | 45 元 | 不需輸入 | 沿用固定單價 45 元 |

### 3. 結帳折扣

結帳時需要提供折扣功能，讓店員可依情況套用固定金額折扣或百分比折扣。

- 支援「折抵金額」，例如訂單總額 100 元，折抵 5 元後應付 95 元。
- 支援「折扣百分比」，例如訂單總額 100 元，打 85 折後應付 85 元。
- 同一筆訂單一次只可套用一種折扣，避免折抵金額與百分比重複計算而造成爭議。
- 畫面要清楚顯示原始總額、折扣內容、折扣金額與折後應付金額。
- 折後應付金額才是實收金額不足判斷與找零計算的基準。
- 折抵金額不得大於原始總額；折扣百分比只接受大於 0 且不超過 100 的整數。
- 折扣結果以整數元計算；百分比出現小數時，採四捨五入至整數元。
- 發票與收據需以折後實際成交總額開立，並保留可辨識的折扣資訊。

#### 驗收情境

| 原始總額 | 折扣設定 | 折後應付 | 實收金額 | 預期找零 |
| ---: | --- | ---: | ---: | ---: |
| 100 元 | 折抵 5 元 | 95 元 | 100 元 | 5 元 |
| 100 元 | 85 折 | 85 元 | 100 元 | 15 元 |
| 99 元 | 85 折 | 84 元 | 100 元 | 16 元 |
| 100 元 | 折抵 101 元 | 不可套用 | - | - |

### 實作注意事項

- 變動價格應存放在訂單品項，不要回寫覆蓋商品主檔的預設價格。
- 若同一張訂單加入多個變動價格商品，必須可分別輸入每一個品項的價格。
- 金額輸入只接受非負整數；是否允許 0 元成交可在開發時明確決定，預設不允許。
- 發票與收據列印應使用訂單品項的最終成交單價與金額。
- 折扣資料要存入訂單，避免日後商品價格改動後無法還原當時的成交金額。

---

## 8. 同步光貿列印註記與作廢／補印前置查驗

更新日期：2026-08-05

### 目標

這次修改只處理兩件事：

1. OpenKao 繼續使用自己的 `ReceiptRenderer` 與 BLE 流程列印，但在實體列印成功後，另外通知光貿，讓光貿後台不再一直顯示「未列印」。
2. 作廢或建立補印工作前，必須即時呼叫光貿的 `Invoice_Status`；只有光貿確認該號碼是已開立發票，才可繼續。

### 已確認的現況

- iPhone 列印成功後會呼叫 `POST /api/print-jobs/:id/printed`，但後端目前只更新自己的 `print_jobs.status = printed`，沒有再通知光貿。
- 補印目前會先呼叫光貿的 `invoice_query`，再依 `invoice_type` 判斷；這不是本次指定的 `invoice_status` API。
- 作廢目前直接呼叫光貿 `f0501`，沒有先確認光貿是否真的有這張已開立發票。
- OpenKao 仍須使用自己保存的 `barcode`、`qrcode_left`、`qrcode_right` 排版列印，不改成直接列印光貿回傳的 `base64_data`。

### 光貿 API 使用方式

#### 1. 發票狀態：`POST /json/invoice_status`

請求內容為陣列，即使只查一張也要使用陣列：

```json
[
  {
    "InvoiceNumber": "AB00001111"
  }
]
```

這支 API 用在作廢與補印的前置查驗。判斷「已開立」時看的是 `type` 或 `invoice_type` 是否為 `C0401`，不能把 `invoice_status = 99` 當成唯一條件；`invoice_status` 是上傳財政部的處理進度，不是發票是否存在的種類。

光貿文件的欄位與範例同時出現 `type`、`invoice_type` 兩種名稱，client 必須相容兩者；單張結果也要相容 `data` 為物件或單元素陣列的格式。

#### 2. 發票列印：`POST /json/invoice_print`

OpenKao 實體列印成功後，再呼叫此 API 取得一次光貿列印資料，藉此留下光貿端的列印註記：

```json
{
  "type": "invoice",
  "invoice_number": "AB00001111",
  "printer_type": 2,
  "printer_lang": 2,
  "print_invoice_type": 1,
  "print_invoice_detail": 0
}
```

- 第一次正本列印使用 `print_invoice_type = 1`。
- 補印使用 `print_invoice_type = 2`。
- `printer_type` 優先使用公司已設定的 `amego_printer_type`；未設定時，以光貿支援正本與補印的 `2`（Xprinter 芯燁通用）作為「只同步註記」的預設值。
- `printer_lang` 沿用公司設定，未設定時使用目前的 `2`（GBK）。
- 回傳的 `base64_data` 不傳給 iPhone、不落 D1、不寫 log，直接丟棄；OpenKao 的實際紙本內容仍由自己的 renderer 產生。

> 光貿文件說明 `invoice_print` 會產出列印格式，但沒有把後台狀態異動寫成明確合約。正式上線前要先用光貿測試公司驗證：呼叫前 `invoice_status.data.print_mark` 為 `N`，呼叫正本列印後應變為 `Y`，光貿後台也應顯示已列印。若實測不會異動，需先向光貿確認專用的列印回報方式，不能自行假設 API 成功就代表後台已更新。

參考：

- [光貿發票狀態 Invoice_Status](https://invoice.amego.tw/api_doc/#api-%E7%99%BC%E7%A5%A8-Invoice_Status)
- [光貿電子發票 API 文件（含 Invoice_Print）](https://invoice.amego.tw/api_doc/)
- [光貿機型支援功能表](https://invoice.amego.tw/info_detail?mid=77)
- [光貿 API 錯誤代碼](https://invoice.amego.tw/info_detail?mid=71)

### P0：作廢與補印前先確認「已開立」

#### 共用狀態查詢

- [x] 在 `backend/src/amego.ts` 新增 `queryAmegoInvoiceStatus()`，沿用既有的表單編碼、timestamp、MD5 簽章、逾時與敏感資料遮蔽機制。
- [x] 建立明確的狀態結果型別，至少正規化 `code`、`message`、`invoiceNumber`、`invoiceType`、`invoiceStatus`、`printMark`、`cancelDate` 與 `wait`。
- [x] 驗證回傳發票號碼必須等於本機要求的號碼，避免串錯公司或錯誤回應被當成成功。
- [x] 建立共用的 `requireAmegoInvoiceIssuedFor(operation)` 判斷，作廢與補印不得各自寫一套不同規則。
- [x] 2026-08-05 實測確認：作廢排程等待中，`invoice_status` 仍可能只回 `C0401` 且沒有 `wait`，但只讀的 `invoice_query.data.wait` 會出現 `C0501`。因此作廢與補印都必須依序通過 `invoice_status` 與 `invoice_query` 兩層即時查驗；任一層顯示已作廢、已註銷或異動等待中都要阻擋。

#### 判斷矩陣

| 光貿結果 | 作廢 | 補印 | OpenKao 行為 |
| --- | --- | --- | --- |
| `code = 0` 且 `type/invoice_type = C0401` | 允許 | 允許 | 繼續原本流程 |
| `NOT_FOUND` 或 `code = 71` | 阻擋 | 阻擋 | 回傳「光貿查無已開立發票」；不可呼叫 `f0501`、不可建列印工作 |
| `C0501` 或已有 `cancel_date` | 阻擋 | 阻擋 | 視為已作廢；本機不得再作廢或補印 |
| `C0701` | 阻擋 | 阻擋 | 視為已註銷 |
| `wait` 中有 `C0501`／`C0701` | 阻擋 | 阻擋 | 顯示異動處理中，避免競爭操作 |
| `code = 51`、逾時、HTTP 錯誤、格式錯誤 | 阻擋 | 阻擋 | 視為「目前無法確認」，保留重試，不得猜測已開立 |
| 未知發票類型或 `invoice_status = 91` | 阻擋 | 阻擋 | 回傳可辨識錯誤並留下稽核紀錄 |

#### 作廢流程

- [x] `voidInvoice()` 讀到本機發票後，立即用發票號碼呼叫 `invoice_status` 與 `invoice_query`，不可使用舊資料或快取結果。
- [x] 只有共用判斷確認為 `C0401` 後，才呼叫光貿 `f0501`。
- [x] `f0501` 成功後才將本機發票改為 `voided`，並停止尚未開始的列印工作；查驗失敗或作廢失敗時不可先改本機狀態。
- [x] 保留目前 owner-only 權限及公司隔離；狀態查詢使用該發票所屬公司的統編與 App Key。
- [x] 寫入 `invoice.status.checked` 與既有 `invoice.void.completed` 稽核紀錄，但不保存 App Key、簽章或 `base64_data`。

#### 補印流程

- [x] `reprintInvoice()` 建立新 `print_job` 前，立即呼叫 `invoice_status` 與 `invoice_query`。
- [x] 只有共用判斷確認為 `C0401` 後，才可建立 `isReprint = true` 的列印工作。
- [x] 狀態不合格、查無資料或暫時無法確認時，不可建立任何補印工作。
- [x] `invoice_query` 同時負責補查異動排程與修復本機缺少的條碼或左右 QRCode；它是 `invoice_status` 之後的第二層查驗，不是用來取代第一層。
- [x] 保留目前 owner／staff 可補印、owner 才可作廢的權限規則。

### P1：實體列印成功後同步光貿列印註記

#### 正確觸發點

- [x] iPhone 維持現有順序：自己的 ESC/POS 資料完整送至印表機後，才回報 `/api/print-jobs/:id/printed`。
- [x] 後端收到成功回報後，先確定該 `print_job`、`invoice`、`company` 屬於同一租戶，再建立一筆待同步的光貿列印註記。
- [x] 正本工作送 `print_invoice_type = 1`；`payload_json.isReprint = true` 的工作送 `print_invoice_type = 2`。
- [x] 列印失敗、工作尚未開始、載具／捐贈而沒有紙本工作的發票，不得呼叫 `invoice_print`。
- [x] 不在開票 `f0401` 成功時就假裝列印，避免本機最後沒有出紙，光貿卻已顯示列印。

#### 可靠同步與重試

本機「紙已送印」與「光貿註記已同步」是兩個不同事實，不可用同一個狀態覆蓋。

- [x] 新增 D1 migration，在 `print_jobs` 保存 `amego_print_sync_status`、`amego_print_attempt_count`、`amego_print_last_error`、`amego_print_next_retry_at`、`amego_print_synced_at`。
- [x] 建議狀態使用 `not_required / pending / synced / manual_review`；加入合法值 trigger 與待重試索引。
- [x] `/printed` 仍要先可靠地完成本機 `printed` 狀態；光貿暫時失敗時，本機不可倒退成「列印失敗」，以免店員重印出第二張紙本。
- [x] 後端在同一請求中先嘗試一次光貿同步；成功改為 `synced`，網路或 5xx 錯誤保留 `pending` 並使用退避重試。
- [x] scheduled worker 分批重試 `pending` 工作；限制最大批次與重試頻率，避免光貿異常時造成請求風暴。
- [x] 永久業務錯誤，例如查無發票、超過查詢期限、0 元發票無法列印或發票已作廢，改為 `manual_review`，不可無限重送。
- [x] 正本重試前可先查 `invoice_status.print_mark`；若已為 `Y`，直接視為同步成功，避免再次要求正本列印。
- [x] 補印只有收到 `invoice_print code = 0` 才算同步成功；若呼叫逾時造成結果不明，可安全重取補印格式，但仍不會把光貿的 `base64_data` 送至實體印表機。
- [x] 每次成功、失敗與重試都留下結構化 log／audit，包含公司、發票、列印工作、正本或補印及光貿錯誤碼，但不包含敏感資料或列印 bytes。

### P2：既有「本機已印、光貿未印」資料補同步

只修未來流程不會改善光貿網站上已存在的「未列印」發票，因此需要一次性補同步。

- [x] migration 或部署後批次工作找出 `print_jobs.status = printed`、有正式 `invoice_id` 與 `amego_order_id`，但尚未同步光貿的資料。
- [x] 每張發票先呼叫 `invoice_status`；`print_mark = Y` 直接標為 `synced`。
- [x] 仍為 `N` 且遠端是 `C0401` 時，使用最早一筆已完成的正本列印工作呼叫 `invoice_print` type `1`。
- [x] 已作廢／註銷、載具或捐贈、0 元、查無資料與超過查詢期限的歷史資料不強行偽造，改列 `manual_review` 並輸出清單。
- [x] 批次作業必須可中斷後續跑、不可重複建立實體列印工作，也不可一次對光貿送出無上限的請求。
- [ ] 在光貿測試公司驗證流程後，先以少量正式發票灰度執行，再處理其餘歷史資料。

### P3：錯誤碼與使用者提示

- [x] 增加 `amego_invoice_not_issued`：光貿查無這張已開立發票，不能作廢或補印。
- [x] 增加 `amego_invoice_status_unavailable`：目前無法向光貿確認發票狀態，請稍後再試。
- [x] 增加 `amego_invoice_change_pending`：光貿正在處理這張發票的異動，暫時不能作廢或補印。
- [x] 已作廢、已註銷與未知類型使用不同訊息，讓店員知道是業務狀態不允許，而不是網路故障。
- [x] iPhone 沿用現有 API 錯誤 alert；不需把 App Key、光貿原始 response 或技術欄位顯示給店員。

### P4：測試

#### Amego client 單元測試

- [x] 驗證 `invoice_status` 使用陣列 request、正確 endpoint、timestamp 與 MD5 簽章。
- [x] 驗證 `data` 物件／陣列、`type`／`invoice_type`、數字／字串狀態皆可正規化。
- [x] 驗證 `invoice_print` 正本與補印 request 的 `print_invoice_type` 分別為 `1`、`2`。
- [x] 驗證 `base64_data` 不會出現在保存資料、log 或對 iPhone 的 response。

#### Worker integration 測試

- [x] 光貿回 `C0401` 時，作廢才會接著呼叫 `f0501`。
- [x] 光貿回 `NOT_FOUND`、`C0501`、`C0701`、等待作廢或查詢失敗時，作廢不得呼叫 `f0501`，補印不得新增 `print_job`；涵蓋 `invoice_status = C0401` 但 `invoice_query.data.wait = C0501` 的實測時序。
- [x] 補印通過查驗後建立的新工作必須保留 `isReprint = true` 及原發票正式 payload。
- [x] 正本實體列印成功回報後，呼叫 `invoice_print` type `1`；補印成功回報後使用 type `2`。
- [x] 實體列印失敗時不呼叫 `invoice_print`。
- [x] 光貿同步暫時失敗時，本機工作維持 `printed`、遠端同步維持 `pending`；scheduled retry 成功後改為 `synced`。
- [x] 相同 `/printed` 回報重送不會新增重複紙本工作，也不會重複正本列印請求。
- [x] 跨公司發票號碼、裝置或工作 ID 不得被查詢、作廢、補印或同步。
- [x] 歷史補同步只處理符合條件的本機已列印資料，且可以重跑。

#### 實際驗收

- [ ] 用光貿測試公司開一張需紙本的正常發票，確認本機列印成功後，`invoice_status.print_mark` 由 `N` 變 `Y`。
- [ ] 確認光貿網站由「未列印」變為「已列印」，紙本內容仍是 OpenKao 自己的固定 58mm 版面。
- [ ] 對同一張發票補印，確認補印前先查 `invoice_status`，實體列印後呼叫 `invoice_print` type `2`。
- [ ] 以不存在、已作廢及正在等待作廢的發票測試，確認作廢與補印都被阻擋且不產生副作用。
- [ ] 關閉網路後完成一次本機列印，再恢復網路，確認不會重印紙本，且後端最後能補同步光貿。

### 建議實作順序

1. 先完成 `invoice_status` client、狀態正規化與測試。
2. 將作廢和補印都改成共用的「已開立」前置查驗。
3. 用光貿測試公司驗證 `invoice_print` 是否真的會把 `print_mark` 改成 `Y`。
4. 驗證成立後，加入 `print_jobs` 光貿同步狀態、即時同步與 scheduled retry。
5. 最後執行歷史補同步，先小批量驗證，再逐步處理剩餘資料。

### 完成標準

- 光貿確認不是 `C0401` 時，OpenKao 絕不作廢，也不建立補印工作。
- 光貿暫時無法查詢時採保守阻擋，不以本機 `issued` 狀態猜測遠端已開立。
- OpenKao 實體列印成功後，光貿後台最後會顯示已列印；暫時斷線可自動補同步。
- 光貿同步失敗不會讓已出紙的工作被當成列印失敗，也不會導致店員重印。
- 光貿回傳的 `base64_data` 永遠不會取代 OpenKao 的自製列印版面，也不會被保存或外流。
