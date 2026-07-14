# OpenvoKao TODO 5：待印區、公司權限與手機配額

更新日期：2026-07-14

## 重要結論

1. **待印區不應自動全部列印**。櫃台操作需要「先看清楚、再決定印哪張」，因此進入「待印」頁面只同步工作與自動連線印表機，不主動送印。
2. **每張待印發票都應能單獨列印**。透過左滑該列即可觸發，不必強迫照順序印。
3. **「全部列印」按鈕要清楚可見**。toolbar 上只用圖示會讓使用者找不到，必須同時顯示文字。
4. **連續列印需要間隔**。雖然 ESC/POS 資料本身正確，但 BLE 熱感印表機的緩衝區/出紙節奏跟不上時，會在後面幾張（尤其最後一張）的 QR code 區段出現亂碼。實測 0.5 秒間隔可穩定避免此情況。
5. **列印偵錯用的 dump 檔案必須移除**。每次列印都把整份 ESC/POS bytes 寫進 `Documents/PrintDumps/` 會讓 app 容器快速變大；改由單元測試或需要時再手動列印觀察。

## 已完成的修改

### 待印區流程（`openvoKao/ContentView.swift`）

- [x] 移除原本進入頁面就自動全部列印的機制。
- [x] 進入「待印」頁面時，若尚未連線且有已儲存印表機，自動呼叫 `reconnectSavedPrinter()`。
- [x] 藍牙狀態變為「可用」時，若仍未連線也會自動重連。
- [x] 頂部 toolbar 新增「🖨️ 全部列印」按鈕，同時顯示圖示與文字。
- [x] 待印清單每一列支援左滑顯示綠色「列印」按鈕，可單獨列印該張。
- [x] 保留點擊列開啟「列印預覽」的功能。
- [x] `printAll()` 在連續發票之間加入 0.5 秒延遲，避免 BLE 傳輸節奏導致亂碼。
- [x] 單筆列印仍即時顯示成功/失敗 alert；全部列印只在最後顯示總結 alert。

### 移除列印偵錯 dump（`openvoKao/PrinterManager.swift`、`openvoKaoTests/ReceiptRendererTests.swift`）

- [x] 移除 `dumpPrintData(_:label:)` 與 `findRasterImageRange(in:)`，不再於每次列印時寫入 `.bin` / `.hex.txt`。
- [x] 移除單元測試中會把資料寫進 `/tmp/openvoKao_dumps` 的偵錯測試，避免測試也產生垃圾檔案。

## QR code 空白問題的根因

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

## 驗證結果

- iPhone 6s Plus 實機測試：
  - [x] 進入待印頁面自動連線已儲存印表機。
  - [x] 左滑單筆列印，印完後該筆從待印區消失。
  - [x] 「全部列印」連續印多張，最後一張 QR code 不再亂碼。
- 單元測試：
  - 待印區功能完成時共執行 26 筆測試，25 筆通過。
  - `testOfficialHeaderUsesRequiredLargeBoldText` 仍失敗，此為先前已存在的問題，與本次待印區改動無關。

## 未來可選優化

- [ ] 若 0.5 秒間隔在某些印表機上仍太短，可改成動態依列印結果調整，或於設定頁提供「連續列印間隔」選項。
- [ ] 若印表機支援，可嘗試用 `DLE EOT n` 主動查詢印表機狀態來取代固定延遲；光貿 BLE 小票機目前不確定支援，故先以 delay 解決。
- [ ] 後續若要保留偵錯能力，可改為只在發生列印失敗時把該筆資料寫入暫存，並限制只保留最近 N 份。

## 公司成員權限與手機配額

### 需求定義

這裡要控制的是兩件不同的事情，不能混為同一個數字：

1. **帳號角色**：決定登入者可以做什麼。老闆可管理公司、員工、手機與商品；員工只能查看商品，並負責開票、查詢及列印。
2. **公司手機配額**：決定同一家公司全部帳號合計最多可綁幾支實體手機，例如公司配額為 3，就算有 10 個員工帳號，也只能綁定 3 支手機。

一個帳號不等於一支手機。同一位員工換手機會占用新的裝置名額；同一支已綁定手機重新登入不重複計算。

### 目前已有的基礎

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

### 確認的權限矩陣

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

### P0：資料表與遷移

- [x] 在 `companies` 增加 `max_bound_devices INTEGER NOT NULL DEFAULT 1`，限制必須大於或等於 1。
- [x] 遷移既有公司時設為 `MAX(1, 目前已綁定手機數)`，避免部署後立刻超額。
- [x] 手機配額只計算 `devices.installation_id IS NOT NULL` 的實體綁定裝置；尚未綁定的預建裝置不占名額。
- [x] 在 `users` 增加 `is_active`，停用員工後不得再登入，並撤銷其現有工作階段。
- [x] 保留現有 `owner / staff / printer` 資料庫約束，避免寫入未知角色。
- [x] 成員停用、密碼重設、配額及解除綁定異動都寫入 `audit_logs`，且不記錄密碼內容。

### P1：後端權限統一

- [x] 建立集中式 owner 權限檢查，後端 API 強制執行，不只靠 iPhone 隱藏按鈕。
- [x] 將公司設定、Amego Key、成員管理、手機管理及稽核紀錄限制為 `owner`。
- [x] 商品與分類的新增、修改、排序及刪除全部限制為 `owner`；`staff` 只能讀取商品與分類。
- [x] 開票、發票查詢、列印與補印允許 `owner`、`staff`。
- [x] 發票作廢與業績報表依上方矩陣限制為 `owner`。
- [x] 被停用的帳號即使仍持有尚未到期的 token，也會被後端拒絕。
- [x] 拒絕會回傳 `owner_required`、`account_disabled`、`device_limit_reached` 等明確錯誤碼與中文訊息。

### P2：公司成員管理

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

### P3：公司手機配額

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

### P4：iPhone 介面

- [x] 「印表」頁新增「員工與手機」入口，只讓 `owner` 看見，可管理同公司的 `staff`、臨時密碼與已綁定手機。
- [x] 商品與分類頁只有 `owner` 顯示新增、編輯、排序及刪除操作；`staff` 為唯讀。
- [x] 「員工與手機」頁顯示已綁定裝置、最後使用時間及「已使用 / 上限」。
- [x] 解除指定手機要求輸入本公司提供的 8 位數解除碼，App 不顯示或產生解除碼。
- [x] `staff` 隱藏成員、手機、商品修改、業績與發票作廢入口。
- [x] iPhone 登入及恢復工作階段時依後端角色更新畫面；帳號停用後會清除失效登入。
- [x] 配額已滿時顯示目前 X / Y 支手機與後續處理方式。
- [x] 真正的安全限制由後端執行，前端隱藏只改善操作體驗。

### P5：測試與驗收

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

### 完成標準

- [x] 每家公司至少有一位老闆，員工無法取得老闆權限。
- [x] 權限由後端強制執行，不能透過直接呼叫 API 繞過。
- [x] 只有老闆能改動商品與分類，員工只能查看並選擇商品開票。
- [x] 老闆能查看、新增、修改與刪除自己公司的員工帳號，不能管理其他公司的成員。
- [x] 每家公司可設定獨立手機上限，所有帳號與裝置合計不會超額。
- [x] 同一支手機不重複占名額，解除一支手機只影響該支手機。
- [x] 老闆可管理自己公司的成員與裝置，但不能自行修改公司手機上限。
- [x] 所有重要管理操作都有可追查的稽核紀錄。

### 建議施工順序

1. P0 資料表與既有資料遷移。
2. P1 後端權限統一。
3. P2 公司成員管理。
4. P3 公司手機配額與換機流程。
5. P4 iPhone 介面。
6. P5 自動測試、D1 部署與實機驗收。

## 相關檔案

- `openvoKao/ContentView.swift`：`PrintQueueView` 與全部列印流程。
- `openvoKao/PrinterManager.swift`：BLE 傳送與 chunk 管理，已移除 dump。
- `openvoKaoTests/ReceiptRendererTests.swift`：已移除會寫入 `/tmp` 的偵錯測試。
- `backend/migrations/0026_company_members_and_device_limits.sql`：公司手機配額與員工啟用狀態。
- `backend/src/members.ts`：同公司員工管理、軟刪除與臨時密碼重設。
- `backend/src/devices.ts`：多機配額、競爭保護與指定手機解除。
- `openvoKao/CompanyAccessView.swift`：老闆的員工與手機管理畫面。

## 參考來源

- [Stack Overflow: How to make use of kCIFormatRGBAh to get half floats on iOS with Core Image?](https://stackoverflow.com/questions/28416330/how-to-make-use-of-kciformath-to-get-half-floats-on-ios-with-core-image) — Apple Core Image 工程師說明 `render(toBitmap:)` 對特定 CIFormat 與環境的限制。
- [Stack Overflow: Swift - Image Data From CIImage QR Code / How to render CIFilter Output](https://stackoverflow.com/questions/51178573/swift-image-data-from-ciimage-qr-code-how-to-render-cifilter-output) — 說明 `CIImage` 需經 `CIContext.createCGImage()` 才能取得可靠 bitmap。
- [Stack Overflow: Converting a large CIImage to CGImage is rendered white](https://stackoverflow.com/questions/69628639/converting-a-large-ciimage-to-cgimage-is-rendered-white) — 實際案例：CoreImage 輸出在特定轉換條件下會變全白。
- [Microsoft Learn: CIFormat Enum (CoreImage)](https://learn.microsoft.com/en-us/dotnet/api/coreimage.ciformat) — CIFormat 格式清單，含 `L8` 定義。
