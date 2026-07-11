# OpenvoKao 程式碼優化 TODO 2

更新日期：2026-07-11

## 審查結論

目前 iOS 與 Worker 都能編譯，D1 migration 可從空資料庫與舊 fixture 完整升級，列印狀態機、token 安全、資料完整性、登入/session、防重複列印與 CI gate 都已補上。此文件現在保留正式上線前仍需確認的風險與維護工作，產品功能清單仍以 `todo.md` 為主。

## 目前剩餘重點

- 外部確認：若舊 App Key 曾經是真實可用憑證，需在供應商端撤銷或輪替。
- 發票正式性：需用財政部或正式測試資料驗證 QR code、條碼、期別、總額與統編。
- 維護性：Worker 主檔已拆出多個模組，但 `catalog / invoices / print-jobs / reports / db` 還可逐步拆出。

## 已驗證的基線

- [x] `npm run typecheck` 通過。
- [x] iOS Debug／iPhoneOS、iOS 15 deployment target、停用簽章 build、實機簽章 build 通過。
- [x] `wrangler deploy --dry-run` 通過，Worker bundle 可產生。
- [x] D1 `0001`～`0023` migration 可在 `/tmp` 的全新本機資料庫依序套用成功。
- [x] 已補 iOS unit test、Worker 自動化測試與 CI gate。
- [x] migration 已驗證空庫與「已有公司、帳號、商品、發票、列印紀錄」fixture 升級後資料仍完整。

---

## P0：正式使用前必須完成

### 1. 修正 BLE 列印完成判定

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

### 2. 增加列印任務 claim／lease，避免多機重複出紙

目前未指定 `device_id` 的 pending 任務會同時出現在同公司的所有裝置，任一裝置也能反覆把任務改成 `printed` 或 `failed`。

證據：`backend/src/index.ts:634-654`、`backend/src/index.ts:991-1023`

- [x] 新增原子 claim API：只允許 `pending -> printing`，記錄 `claimed_by`、`claimed_at`、`lease_expires_at`。
- [x] 只有 claim 成功的裝置能讀 payload 與提交結果。
- [x] terminal status 只能寫入一次；重複 callback 應回傳相同成功結果，不能產生重複 log。
- [x] 逾時 lease 可安全釋放或由管理者重派，並記錄 `attempt_count`。
- [x] iOS 以 `remoteId` 去重，不因回報失敗又同步出第二份本機任務。

驗收：兩台 iPhone 同時刷新與點列印時，只有一台能 claim；相同 callback 重送不會改變結果或新增重複紀錄。

### 3. 修正發票版面與文字編碼的確定性錯誤

- [x] 移除寫死的 `114年07-08月`，依 `issuedAt` 動態計算民國年與雙月期別。證據：`openvoKao/ReceiptRenderer.swift:31-37`
- [x] Big5 fallback 應先把不支援字元替換，再把整段安全字串編碼成 Big5；目前只要有一個 emoji，整行中文就會改送 UTF-8。證據：`openvoKao/ReceiptRenderer.swift:118-131`
- [x] `twoColumn` 在左右文字超過紙寬時要截斷或換行，不能直接溢出。證據：`openvoKao/ReceiptRenderer.swift:95-102`
- [x] 對 QR payload 長度設上限並安全計算 ESC/POS 長度欄位，避免轉成 `UInt8` 時越界。證據：`openvoKao/ReceiptRenderer.swift:133-142`
- [x] 58mm／80mm 必須成為可保存的使用者設定；目前實際列印固定 `.mm58`。證據：`openvoKao/PrinterManager.swift:136-138`
- [ ] 用正式財政部測試資料驗證 QR code、條碼、期別、總額與統編，不以 demo 字串作為完成標準。

驗收：跨年、每個雙月邊界、emoji／罕見字、超長品名、58mm／80mm 都有 renderer golden test。

### 4. 移除並輪替可能已洩漏的 App Key

`CompanyProfile.initial` 內有一段看似真實的 App Key，且 `CompanyProfile`、auth token、device token 都會被完整編碼到 `UserDefaults`。這也違反專案「iOS 不保存 Amego App Key」的方向。

證據：`openvoKao/AppModels.swift:230-288`、`openvoKao/AppStore.swift:10-20`、`openvoKao/AppStore.swift:390-397`

- [ ] 立即確認該 App Key 是否曾使用；若是，先在供應商端輪替／撤銷。
- [x] 從 source、預設值、sample data 移除真正 secret，改由後端從資料庫讀取；Git 歷史是否仍含舊值仍待另外確認。
- [x] iOS 模型與 API response 不再包含 `appKey`；前端最多顯示「已設定／未設定」。
- [x] auth token 與 device token 改存 Keychain，登出時刪除；一般 UI 設定才留在 `UserDefaults`。
- [x] 後端資料庫不要保存明文 session／device token，改存不可逆雜湊並支援撤銷。

驗收：對 repo 和產物掃描找不到真正 secret；從裝置備份／UserDefaults 無法取得可直接使用的 token。

### 5. 讓註冊、建發票與改價格具有原子性

目前建立公司、使用者、session、device，以及建立 invoice、items、print job 都是多次獨立 SQL；中途失敗會留下半套資料。價格小數位轉換也會先改全部商品，再改公司設定。

證據：`backend/src/index.ts:236-338`、`backend/src/index.ts:901-949`、`backend/src/index.ts:1233-1326`

- [x] 將每個業務動作需要的 statements 用 D1 原子批次／等價交易方式一次提交；註冊、建發票列印任務、價格小數位轉換已改成 batch。
- [x] 發票加入公司範圍的唯一鍵與 idempotency key，避免 API retry 重複建單。
- [x] 建立列印任務前驗證 `deviceId` 屬於同一 `companyId`。
- [x] 驗證 `totalAmount == sum(quantity * unitPrice)`；目前列印任務採整數最小金額單位、品項小計精確加總，折扣／退款尚未作為獨立欄位支援，避免負值繞過。
- [x] 驗證發票號碼、隨機碼、統編、日期格式、items 數量與每個文字欄位長度。
- [x] 重要狀態欄位加入資料庫完整性 guard；金額與數量加入合理上下限，避免溢位或負值。

驗收：在每個 statement 人為注入失敗後，資料庫都不會留下孤兒公司、孤兒發票或部分轉換的價格。

### 6. 補齊登入與 session 的基本防護

目前註冊／登入沒有 rate limit，密碼最低只需 6 字元，session 永不過期；管理員重設密碼後舊 session 仍有效，500 response 也可能把底層錯誤訊息直接回傳。

證據：`backend/src/index.ts:61-233`、`backend/src/index.ts:1175-1199`、`backend/src/index.ts:1358-1408`、`backend/src/index.ts:1598-1628`

- [x] 對註冊、登入、重設密碼及 admin API 加 rate limit／防暴力嘗試策略。
- [x] 密碼先維持現有最低長度檢查；暫不增加常見弱密碼規則。現有 PBKDF2 編碼字串已包含演算法與迭代次數，可供日後升級時辨識版本。
- [x] session 加 `expires_at`、撤銷與定期清理；重設密碼時撤銷該使用者所有 session。
- [x] 未知例外只回傳 request ID 與通用錯誤碼，完整 stack／D1 訊息只寫伺服器 log。
- [x] `ADMIN_TOKEN` 改成可輪替、可稽核的管理機制；production 使用 `ADMIN_TOKEN_HASH`，staging 於正式上線前再評估。

---

## P1：可靠性、安全性與資料正確性

### 7. 分離會員權限與列印裝置權限

目前只要拿到 device token，就能新增、修改、刪除商品分類與商品，甚至修改全公司的價格小數位設定；列印端憑證權限過大。

證據：`backend/src/index.ts:102-166`、`openvoKao/BackendClient.swift:117-230`

- [x] 商品／分類／公司設定的寫入改用會員 session，device token 只保留 claim、讀取與回報列印任務。
- [x] 定義 owner／staff／printer 等角色與 route-level authorization test。
- [x] 裝置新增、撤銷、改名與 token rotation 必須可管理並有 audit log。

### 8. 修正裝置身分碰撞

登入時只用 `company_id + deviceName + platform` 找既有裝置；多台都叫「前台列印端」或「iPhone」時會共用同一 token。`/auth/me` 又會回傳公司最早建立裝置的 token。

證據：`backend/src/index.ts:1682-1752`

- [x] iOS 產生並保存 installation ID，登入時明確綁定該 installation。
- [x] `/auth/me` 不回傳其他裝置 token。
- [x] 裝置 token 只在建立／輪替時顯示一次，資料庫保存 hash。

### 9. 建立真正的 request schema 驗證

TypeScript generic 只在編譯期存在；`request.json()` 可傳入 `null`、array、超長字串或錯誤型別。部分 enum／sort order 遇到錯值還會默默退回預設值。

證據：`backend/src/index.ts:1520-1596`、`backend/src/index.ts:1772-1790`

- [x] 每個 endpoint 使用共用 runtime schema 驗證 body、query 與 path parameter。
- [x] 統一限制 request body、字串、陣列與日期範圍大小。
- [x] 非法 enum 回 400，不要默默改成「顯示／含稅／0」。
- [x] `requirePositiveInteger` 分成允許 0 與必須大於 0；商品數量不可接受 0。
- [x] 統一錯誤格式：`code`、本地化 message、field errors、request ID。

### 10. 修正報表重複與擴展性問題

「最新列印任務」以秒級 `created_at` 的最大值連接；同一發票在同一秒建立兩筆 job 時可能同時被視為最新，造成商品明細重複、業績灌大。報表也沒有期間上限或 pagination。

證據：`backend/src/index.ts:476-570`

- [x] 用 `ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY created_at DESC, id DESC)` 或等價唯一排序只取一筆。
- [x] 新增 `invoices(company_id, issued_at)`、`invoice_items(invoice_id)` 等實際查詢所需 index，並用 query plan 驗證。
- [x] 不在 indexed datetime 欄位外包 `date()`；改用明確的 UTC／公司時區起訖時間。
- [x] 限制最大日期範圍並加 cursor pagination；大報表改由後端聚合，不把全部 invoice items 拉到手機再計算。
- [x] iOS 日期快速切換時取消舊 request，避免較慢的舊結果覆蓋新範圍。

### 11. 建立本機同步 outbox 與可恢復狀態

- [x] 列印結果回報失敗時保留 outbox，網路恢復後以 idempotency key 自動重試。
- [x] 本機 job 以 `remoteId` 為穩定 identity；合併同步結果，不以新 UUID 重建同一任務。
- [x] 限制本機歷史數量／保存期限，避免 `UserDefaults` 隨使用時間無限增長。
- [x] fresh install 不預載可操作的 sample jobs；sample data 只在 `DEBUG` 或專用測試畫面出現。
- [x] session restore 只有收到明確 401／403 才清除登入；逾時、離線與 5xx 應保留 session 並顯示可重試狀態。

證據：`openvoKao/AppStore.swift:45-52`、`openvoKao/AppStore.swift:81-94`、`openvoKao/AppStore.swift:216-241`、`openvoKao/AppStore.swift:291-302`、`openvoKao/AppStore.swift:400-438`

### 12. 補自動化測試與 CI gate

- [x] `ReceiptRendererTests`：民國年期別、Big5 fallback、長行、金額、QR／barcode byte fixture。
- [x] `PrinterManagerTests`：抽出 BLE transport protocol，測 chunk、backpressure、斷線、取消、禁止併發列印。
- [x] `BackendClientTests`：URL、401／500、日期 decode、取消與 timeout。
- [x] Worker integration tests：tenant isolation、auth、claim race、status transition、idempotency、invalid payload。
- [x] D1 migration tests：空庫與帶 fixture 的舊 schema 升級，最後檢查 row count、foreign key 與關鍵查詢。
- [x] CI 至少執行 TypeScript typecheck、Worker tests、migration test、Wrangler dry-run 與無簽章 iOS build。

### 13. 限縮 CORS 並加入 Web 安全標頭

目前所有 JSON response 都是 `Access-Control-Allow-Origin: *`，而內嵌 admin page 沒有 CSP 等安全標頭。

證據：`backend/src/index.ts:54-59`、`backend/src/index.ts:1792-1805`、`backend/src/index.ts:1816-1975`

- [x] 若管理頁與 API 同源，移除不必要的 wildcard CORS；若另有前端，使用明確 allowlist。
- [x] 加入 CSP、`X-Content-Type-Options`、`Referrer-Policy`、frame policy 與合理 cache policy。
- [x] OPTIONS 只對允許的 route／origin 回應，並加入測試。

### 14. 增加可觀測性與稽核

- [x] 每個 request 產生 request ID，結構化記錄 route、status、latency、company/device，但不記 token、密碼或完整發票敏感資料。
- [x] 記錄登入失敗、admin 操作、裝置 token 輪替、列印 claim／完成／失敗等 audit event。
- [x] Cloudflare production 開啟適當取樣的 observability，為 5xx、重複列印與長時間 pending 設告警。

---

## P2：維護性與效能

### 15. 拆分大型 Worker 單檔

- [x] 依 `routes / auth / catalog / print-jobs / reports / devices / validation / responses` 拆模組；已拆出 `routes`、`catalog`、`print-jobs`、`reports`、`devices`、`crypto utils`、`auth helpers`、`request parsers/normalizers`、`validation`、`responses/http`、`types`、`domain-types`、`constants` 與 admin page。`index.ts` 已從 3310 行降到約 1173 行，先停在可維護範圍。
- [x] 將 inline admin HTML 移成獨立檔案，避免 API、CSS、JS 全擠在 `index.ts`；正式前端專案可留待後續。
- [x] `Env` 改由 Wrangler config 產生型別，CI 檢查型別是否與 bindings 同步。

證據：`backend/src/index.ts`

### 16. 改善 iOS 狀態管理與請求併發

- [x] 不共用單一 `isSyncing`／`syncMessage` 表示所有功能，改為 queue、catalog、device、report 各自狀態或 operation counter。
- [x] `refreshCatalog()` 等兩個 request 全部成功後再一次提交畫面狀態，避免只更新一半。
- [x] 對重複刷新、日期變更與 view 消失支援 task cancellation／debounce。
- [x] 將 API machine error code 對應為可本地化訊息，不直接顯示底層英文錯誤。

證據：`openvoKao/AppStore.swift:34-35`、`openvoKao/AppStore.swift:97-122`、`openvoKao/ContentView.swift:151-159`

### 17. 清理 repository 與部署設定

- [x] 新增 `.gitignore`，移除已追蹤的 `.ipa`、`xcuserdata`、`.xcuserstate`、`.DS_Store`、DerivedData 與 Wrangler 本機 state。
- [x] binary artifact 改放 release／artifact storage，不要放 Git；目前已取消追蹤 debug IPA，CI 會上傳 unsigned simulator app artifact。
- [x] 建立明確部署 dry-run；目前產品尚未正式上線，先用現有 D1 測試，不建立 staging D1，正式上線前再評估 staging／production 分離。
- [x] 已將 `wrangler.toml` 遷移為有 schema 提示的 `wrangler.jsonc`，並以 package lock 固定目前 Wrangler 版本。
- [x] 補根目錄 README：架構、資料流、列印狀態機、開發／測試／部署命令、secret 處理方式。

### 18. 同步文件與實際設定

文件已同步現況：`wrangler.jsonc` 已有 database ID、app 有 production URL、後端已有註冊登入，Bundle ID 與 Team ID 也已和 Xcode project 統一。

- [x] 把 `todo.md` 改成只保留產品里程碑，完成狀態以現況重寫。
- [x] 更新 `backend/README.md` 的 limitations；目前已有 password hashing 與登入流程。
- [x] 確認並統一正式 Bundle ID、Team ID 與文件，避免續裝、簽章或 App Store 身分混亂。

證據：`todo.md`、`backend/README.md`、`backend/wrangler.jsonc`、`openvoKao.xcodeproj/project.pbxproj`

---

## 建議執行順序

1. 先用目前實機流程做整套人工驗收：登入、解除綁定、商品同步、列印、失敗回報、離線重試。
2. 確認舊 App Key 是否曾經是真實憑證；若是，先在供應商端撤銷或輪替。
3. 用正式財政部測試資料驗證 QR code、條碼、期別、總額與統編。
4. 再串正式 Amego 開票 API，並把 API key 僅保留在後端資料庫／secret 管理內。
5. 產品正式上線前，再評估是否需要 staging／production D1 分離。
6. 有餘裕時繼續拆 Worker 主檔，優先拆 `catalog / invoices / print-jobs / reports / db`。

## 完成標準

- 任何一張發票在併發、斷線、重試後都不會被自動重複列印。
- 傳輸未完成或失敗時，伺服器不會收到 `printed`。
- iOS、Git、log、D1 都沒有可直接使用的 Amego secret 或明文 bearer token。
- 發票、品項、列印任務永遠一起成功或一起失敗，重送同一請求不會重複建單。
- renderer、Worker 狀態機、D1 migration 與關鍵 API 都有可重複執行的自動化測試。
