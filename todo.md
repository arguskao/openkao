# OpenvoKao 產品里程碑

更新日期：2026-07-11

這份文件只保留產品方向與里程碑。工程風險、驗收清單與逐項進度放在 `todo2.md`。

## 目前方向

OpenvoKao 分成兩個部分：

- iOS app：前台列印端，負責登入、綁定裝置、同步待列印任務、連接藍牙印表機、列印與回報結果。
- Cloudflare 後端：負責帳號、公司、商品、分類、發票、列印任務、裝置管理、權限、稽核與報表。

iOS 不保存 Amego App Key，也不直接管理商品主資料。Amego 憑證與開票流程應由後端持有與執行。

## 里程碑 1：iOS 列印端

- [x] 建立 SwiftUI iOS 專案。
- [x] 支援 iOS 15 以上裝置。
- [x] 建立待列印、印表機、紀錄、設定等主要畫面。
- [x] BLE 掃描、連線、保存印表機設定、重新連線。
- [x] ESC/POS 發票 renderer。
- [x] 支援 58mm / 80mm 紙寬設定。
- [x] 支援 pending job 同步、列印成功/失敗回報、失敗 outbox 重試。
- [ ] 實機確認不同熱感紙機型的中文、QR code、barcode、切紙與走紙相容性。

## 里程碑 2：帳號、公司與裝置綁定

- [x] 客戶註冊與登入。
- [x] 使用者、公司、裝置資料寫入 D1。
- [x] 裝置綁定第一台手機。
- [x] 換手機需使用公司解除綁定碼。
- [x] owner / staff / printer 角色與 route-level 權限。
- [x] auth session、device token 改為雜湊保存。
- [ ] 正式確認 Bundle ID、Team ID 與 App Store 身分。

## 里程碑 3：商品、分類與公司設定

- [x] 商品分類頁。
- [x] 商品管理頁。
- [x] 商品價格支援公司層級小數位數設定。
- [x] 商品、分類、公司、使用者等主要表改用數字 ID。
- [x] 移除 store 層，簡化為 company。
- [x] 商品與分類寫入改用會員 session，device token 不可管理資料。

## 里程碑 4：發票與列印任務

- [x] 後端建立 invoice、invoice_items、print_jobs。
- [x] 相同發票號碼與 idempotency key 不會重複建單。
- [x] 多台 iPhone 同時刷新時，只能有一台 claim 同一筆任務。
- [x] printed / failed callback 具備狀態機防護。
- [x] 建立 audit log 與 request log。
- [ ] 串接正式 Amego 開票 API。
- [ ] 用正式財政部測試資料驗證 QR code、條碼、期別、總額與統編。

## 里程碑 5：業績、報表與管理功能

- [x] 業績報表查詢。
- [x] 報表查詢加入日期範圍限制、pagination 與正確的最新列印任務判斷。
- [x] 發票管理取代原會員中心。
- [x] 後台按鈕改為業績。
- [ ] 補正式產品 UI 驗收與實機操作流程。

## 里程碑 6：測試、部署與維運

- [x] Worker integration tests。
- [x] D1 migration tests。
- [x] iOS renderer、printer manager、backend client 相關測試。
- [x] CI 執行 typecheck、Worker tests、migration test、Wrangler dry-run 與 iOS 無簽章 build。
- [x] Cloudflare observability、request ID、結構化 log。
- [x] Git 忽略 `.ipa`、Xcode user state、`.DS_Store`、DerivedData、Wrangler 本機 state。
- [ ] 建立正式 staging / production Worker environment、不同 D1 與不同 secrets。
- [ ] 將 binary artifact 改由 release 或 artifact storage 管理。

## 發布前必做

- [ ] 供應商端確認曾出現在程式碼中的 App Key 是否需要撤銷或輪替。
- [ ] 正式 Amego API 串接與錯誤情境測試。
- [ ] 正式財政部測試資料驗證。
- [ ] 至少兩台 iPhone 同時搶同一筆列印任務的實機測試。
- [ ] 不同印表機型號實機測試。
- [ ] 確認 Bundle ID、Team ID、簽章與 App Store 帳號。
