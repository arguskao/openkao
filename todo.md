# OpenvoKao iOS / Web 重構 TODO

更新日期：2026-07-09

## 目前狀態總覽

### 已寫好 / 已完成

- SwiftUI iOS 專案 `openvoKao` 已建立。
- Bundle ID 已設定為 `com.yukai.openvoKao`。
- Apple Team 已設定為 `6T25FRDJW3`。
- iOS deployment target 已降到 `15.0`。
- Debug build 已通過。
- Release build 已通過。
- Release 版已安裝到 `13pro`。
- app 目前已改成列印端首頁：
  - 待列印
  - 印表機
  - 紀錄
  - 設定
- 原本 app 內的商品新增、商品管理、公司資料編輯、App Key 顯示與保存、本機發票資料庫、本機商品資料庫，已從新 Swift app 的主流程移除。
- 藍牙印表機設定頁已建立。
- BLE 掃描、連線、儲存印表機、重新連線、清除印表機設定已寫好。
- 已沿用原 Flutter 專案的 BLE 列印 UUID：
  - service UUID：`49535343-FE7D-4AE5-8FA9-9FAFD205E455`
  - characteristic UUID：`49535343-8841-43F4-A8D4-ECBE34729BB3`
- BLE 寫入已使用 20 bytes 分段，間隔 10ms。
- 已建立自製 ESC/POS 發票 renderer：`ReceiptRenderer.swift`。
- 已做到基礎自製發票列印資料，不依賴 Amego `base64_data`。
- 已支援 58mm / 80mm 紙寬設定雛形。
- 已支援基本發票欄位：
  - 店名
  - 賣方統編
  - 買方統編
  - 發票號碼
  - 隨機碼
  - 發票時間
  - 商品明細
  - 總金額
- 已加入 QR code ESC/POS 指令雛形。
- 已加入 Code128 barcode ESC/POS 指令雛形。
- 已加入 Big5 中文編碼策略雛形。
- 網站後台技術棧已決定：
  - Cloudflare Pages / Workers
  - Cloudflare D1
  - Workers secrets 保存 Amego App Key
- Cloudflare Worker 後台骨架已建立：`backend/`。
- D1 migration 已建立：`backend/migrations/0001_initial.sql`。
- 本機 D1 migration 已套用成功。
- 後台首頁雛形已建立，可建立公司、註冊 iPhone 裝置、建立測試列印任務。
- 後台 API 雛形已建立：
  - `GET /api/health`
  - `GET /api/admin/summary`
  - `POST /api/admin/companies`
  - `POST /api/devices/register`
  - `GET /api/admin/products`
  - `POST /api/admin/products`
  - `GET /api/admin/print-jobs`
  - `POST /api/admin/print-jobs`
- 手機列印 API 雛形已建立：
  - `GET /api/print-jobs/pending`
  - `GET /api/print-jobs/{id}`
  - `POST /api/print-jobs/{id}/printed`
  - `POST /api/print-jobs/{id}/failed`
- iOS app 已新增後台 API client：`BackendClient.swift`。
- iOS app 已新增「後台」tab，可從手機 app 直接開啟 Cloudflare 後台頁。
- iOS app 設定頁已新增裝置 token 欄位。
- iOS app 已預設後台 URL：`https://openvokao-backend.arguskao.workers.dev`。
- iOS app 已接上待列印同步按鈕。
- iOS app 已接上列印成功 / 失敗回報 API。
- 後台本機 smoke test 已通過：
  - 建立公司
  - 註冊裝置
  - 建立列印任務
  - 用裝置 token 讀取 pending print jobs
  - 回報 printed 後 pending 清單變空

### 部分完成 / 雛形已寫，但還要實測或補規格

- 列印功能目前可以送出自製 ESC/POS payload，但實際版面尚未用熱感紙校正。
- QR code / barcode 指令已寫，但還沒確認每台印表機是否都支援。
- Big5 中文編碼策略已寫，但還沒確認實際印表機是否能正確印中文。
- 待列印列表已可從 Cloudflare API 同步；仍保留 sample data 按鈕供本機測試。
- 列印成功 / 失敗已可呼叫 Cloudflare API；還需要用真實 device token 和真實 print job 實機測試。
- app 設定頁已有伺服器 URL 欄位，但還沒實作登入、token、裝置綁定。
- D1 schema/migration 已建立，但還沒部署到 Cloudflare remote D1。
- 後台首頁目前是手機可開啟的管理工具雛形，不是正式 mobile-first 產品 UI。
- `POST /api/devices/register` 目前由 admin token 建立裝置，還沒有完整登入/綁定流程。
- `POST /api/admin/print-jobs` 目前是手動建立測試列印任務，還沒有串 Amego 開發票 API。

### 還沒寫 / 還沒做

- Cloudflare remote D1 database 尚未建立。
- `wrangler.toml` 的正式 `database_id` 尚未填入。
- Cloudflare remote migration 尚未套用。
- Cloudflare Worker 尚未部署到正式網址。
- 客戶註冊 / 登入尚未建立。
- 公司資料設定尚未建立。
- Amego 憑證設定尚未建立。
- 正式商品管理 UI 尚未建立。
- 分類管理尚未建立。
- 串 Amego 的正式發票建立 API 尚未建立。
- 發票查詢 API 尚未建立。
- 正式裝置管理 UI 尚未建立。
- iOS app 登入 / 綁定裝置尚未建立。
- iOS app 尚未改用 Keychain 保存 device token，目前先存在 `UserDefaults`。
- 完整財政部電子發票 QR code 內容格式與加密欄位尚未完成。
- 實際熱感紙版面尚未校正。
- 尚未測試不同 BLE ESC/POS 印表機相容性。
- 尚未確認是否也要安裝到 `6s+ 的 iPhone`。
- 尚未把 token 改用 Keychain 保存。

### 需要你實機確認

- 13pro 上目前 SwiftUI app 外觀是否可以。
- 印表機是否掃得到。
- 印表機是否連得上。
- 測試列印是否有出紙。
- 待列印任務按「列印」後，QR code / barcode / 中文 / 版面是否符合預期。
- 是否需要支援 58mm 以外的 80mm 紙寬。
- 是否需要支援離線列印。
- 是否需要掃 QR code / 條碼取得列印任務。
- 是否需要支援多公司 / 多門市。
- 手機版後台的操作流程是否符合你要的方式。

## 方向

目標是把現在的 iOS app 改成輕量前台端：app 主要保留「接收待列印資料、連接印表機、執行列印」。

其他管理功能移到手機可操作的網站後台。這個後台不是只給電腦用，而是要能從 iPhone app 點進去，用手機畫面操作：

- 客戶註冊
- 公司資料設定
- App Key / 統編管理
- 商品新增與管理
- 發票資料查詢
- 後台資料庫管理

iOS app 的角色：

- 原生 Swift app 保留藍牙印表機掃描、連線、列印。
- app 內提供「後台」入口，從手機打開 Cloudflare 後台頁面。
- 後台頁負責註冊、設定、商品、發票建立、列印任務管理。
- app 和後台之間仍透過 API 傳遞列印任務與列印結果。

這樣 iOS app 不再需要 Hive，也不應該長期保存商品、客戶、公司設定等主資料。app 只保存必要的裝置端設定，例如藍牙印表機選擇、登入 token、最近一次同步狀態。

列印策略重點：

- 原 Flutter 專案的紙本發票列印，是使用 Amego 回傳的 `base64_data` 圖形/列印資料，再直接送到藍牙印表機。
- 這個方式相容性受 Amego 產出的資料格式限制，只支援部分印表機。
- 新版不再依賴 Amego 回傳的 `base64_data` 來列印。
- Amego 只負責開立發票與回傳發票號碼、隨機碼、日期、金額等必要資料。
- 紙本發票版面、QR code / barcode、文字、走紙、切紙等 ESC/POS 指令改由我們自己產生。

## 階段 1：先部署到手機看外觀

- [x] 建立新的 SwiftUI iOS 專案：`openvoKao`
- [x] 設定 Bundle ID：`com.yukai.openvoKao`
- [x] 設定 Apple Team：`6T25FRDJW3`
- [x] 將 iOS deployment target 降到 `15.0`，支援 iPhone 6s+ / iOS 15.8.8
- [x] 建立第一版外觀：
  - 印表機設定
  - 待列印
  - 紀錄
  - 設定
- [x] Debug build 通過
- [x] Release build 通過
- [x] 已安裝到 `13pro`
- [ ] 確認是否也要安裝到 `6s+ 的 iPhone`
- [ ] 實機檢查外觀：
  - 字體大小
  - 按鈕是否好按
  - iPhone 小螢幕是否擠壓
  - iPad 橫向是否需要另外設計

## 階段 2：重新定義產品流程

新的流程暫定如下：

1. 客戶在網站註冊帳號。
2. 客戶在網站設定公司資料、統編、Amego App Key。
3. 客戶在網站新增商品、分類、價格。
4. 網站後台負責保存所有資料。
5. iOS app 登入後只取得「這台裝置需要的列印任務」。
6. iOS app 選擇或掃描待列印資料。
7. iOS app 連接藍牙印表機並列印。
8. iOS app 回報列印結果給網站後台。

需要決定：

- [x] app 是否還要能直接開發票，還是只列印網站已建立的發票：只列印網站已建立的發票 / 列印任務
- [x] app 是否需要登入：需要，後續用登入或裝置綁定取得列印任務
- [ ] app 是否需要支援多公司 / 多門市
- [ ] app 是否需要離線列印
- [ ] app 是否需要掃 QR code / 條碼取得列印任務
- [x] 發票 API 是由網站後台呼叫，還是仍由 iOS app 呼叫：由網站後台呼叫，iOS app 不保存 Amego App Key

建議方向：

- 發票 API 由網站後台呼叫。
- 不使用 Amego `base64_data` 當主要列印內容。
- iOS app 不保存 App Key。
- iOS app 不保存商品資料。
- iOS app 只保存印表機設定與登入狀態。

## 階段 3：網站後台規格

暫定技術棧：

- Cloudflare Pages / Workers 部署手機版網站後台與 API
- Cloudflare D1 作為主要資料庫
- Cloudflare Workers secrets 保存 Amego App Key 等敏感設定
- 後台 API 統一負責呼叫 Amego 發票 API，iOS app 不直接保存或呼叫 Amego 憑證
- 後台保存開立發票後所需的列印欄位，不把 Amego `base64_data` 當成主要列印資料

D1 使用原則：

- 適合保存 users、companies、products、invoices、print_jobs 等結構化資料。
- 不把大型檔案或大量原始列印內容塞進 D1；必要時只保存列印格式 JSON 或關鍵欄位。
- 每次建立發票後產生一筆 `print_jobs`，iOS app 只拉取 pending 狀態的任務。
- `print_jobs` 應保存結構化列印資料，例如發票號碼、隨機碼、日期、買方統編、商品明細、總金額、QR code 原始字串。
- 列印成功或失敗後，由 iOS app 回報狀態，後台寫入 `print_logs`。

網站後台需要提供：

- [ ] 客戶註冊 / 登入
- [ ] 公司資料設定
- [ ] Amego 憑證設定
- [ ] 商品管理 UI
- [ ] 分類管理
- [ ] 發票建立：串 Amego API
- [ ] 發票查詢
- [x] 列印任務列表 API 雛形
- [x] 裝置註冊 API 雛形
- [x] 列印狀態回報 API 雛形
- [ ] 正式手機版後台 UI

後台資料庫至少需要：

- [x] users
- [x] companies
- [x] stores
- [x] devices
- [x] products
- [x] categories
- [x] invoices
- [x] invoice_items
- [x] print_jobs
- [x] print_logs

## 階段 4：iOS app 改成列印端

要從 app 移除或弱化：

- [x] 商品新增
- [x] 商品管理
- [x] 公司資料編輯
- [x] App Key 顯示與保存
- [x] 本機發票資料庫
- [x] 本機商品資料庫

app 保留：

- [x] 登入 / 綁定裝置：目前先用裝置 token，iOS 會呼叫後端確認綁定狀態
- [x] 手機後台入口
- [x] 印表機掃描
- [x] 印表機連線
- [x] 待列印列表
- [x] 列印預覽
- [x] 執行列印
- [x] 列印成功 / 失敗回報 API 雛形

## 階段 5：API 契約

網站後台需要提供給 iOS app 的 API：

- [ ] `POST /auth/login`
- [x] `GET /devices/me`：iOS 用來確認 token 是否真的綁定公司 / 門市
- [x] `POST /devices/register`：admin token 版本
- [x] `GET /print-jobs/pending`：後台與 iOS app 雛形
- [x] `GET /print-jobs/{id}`：後台雛形
- [x] `POST /print-jobs/{id}/printed`：後台與 iOS app 雛形
- [x] `POST /print-jobs/{id}/failed`：後台與 iOS app 雛形

列印任務資料應包含：

- [ ] 發票號碼
- [ ] 隨機碼
- [ ] 發票日期時間
- [ ] 買方統編
- [ ] 商品明細
- [ ] 總金額
- [ ] QR code / barcode 所需資料
- [ ] 列印格式版本
- [x] 自製 ESC/POS 列印 payload 所需欄位雛形，不依賴 Amego `base64_data`

## 階段 6：資料策略

app 端：

- [x] 不使用 Hive
- [x] 不保存主資料
- [x] 使用 `UserDefaults` 保存輕量設定
- [ ] 之後如需安全保存 token，改用 Keychain

網站端：

- [x] 使用正式資料庫保存主資料：Cloudflare D1
- [ ] 統一管理發票 API 憑證：規劃用 Workers secrets，尚未做 UI/API
- [x] 統一產生列印任務：測試 API 雛形已完成
- [x] 保留列印紀錄方便追查：`print_logs` schema 與寫入 API 已完成

## 階段 7：近期下一步

- [ ] 你先看目前安裝在手機上的 SwiftUI app 外觀。
- [x] 決定 app 是否只做「列印任務列表 + 列印」。
- [x] 決定網站後台要用哪個技術棧：Cloudflare Pages / Workers + D1
- [x] 把 iOS app 現有畫面改成列印端首頁。
- [x] 新增藍牙印表機設定頁。
- [x] 接上實際 ESC/POS 測試列印資料寫入。
- [ ] 從 Flutter app 搬列印格式與藍牙列印邏輯到 Swift。
  - [x] BLE 掃描 / 連線 / service UUID / characteristic UUID / 20 bytes 分段寫入
  - [x] 基礎電子發票格式：自行產生，不使用 Amego `base64_data`
  - [x] QR code / barcode ESC/POS 指令雛形
  - [x] 中文 Big5 編碼策略雛形
  - [ ] 完整財政部電子發票 QR code 內容格式與加密欄位
  - [ ] 實際熱感紙版面校正
- [x] 建立自製發票列印 renderer。
  - [x] 定義 58mm / 80mm 紙寬版面
  - [x] 定義標題、店名、統編、發票號碼、日期、商品明細、總金額格式
  - [x] 產生電子發票 QR code / barcode ESC/POS 指令
  - [x] 產生中文字編碼策略
  - [ ] 測試不同 BLE ESC/POS 印表機相容性
