# TODO 8：同步光貿列印註記與作廢／補印前置查驗

更新日期：2026-08-05

## 目標

這次修改只處理兩件事：

1. OpenKao 繼續使用自己的 `ReceiptRenderer` 與 BLE 流程列印，但在實體列印成功後，另外通知光貿，讓光貿後台不再一直顯示「未列印」。
2. 作廢或建立補印工作前，必須即時呼叫光貿的 `Invoice_Status`；只有光貿確認該號碼是已開立發票，才可繼續。

## 已確認的現況

- iPhone 列印成功後會呼叫 `POST /api/print-jobs/:id/printed`，但後端目前只更新自己的 `print_jobs.status = printed`，沒有再通知光貿。
- 補印目前會先呼叫光貿的 `invoice_query`，再依 `invoice_type` 判斷；這不是本次指定的 `invoice_status` API。
- 作廢目前直接呼叫光貿 `f0501`，沒有先確認光貿是否真的有這張已開立發票。
- OpenKao 仍須使用自己保存的 `barcode`、`qrcode_left`、`qrcode_right` 排版列印，不改成直接列印光貿回傳的 `base64_data`。

## 光貿 API 使用方式

### 1. 發票狀態：`POST /json/invoice_status`

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

### 2. 發票列印：`POST /json/invoice_print`

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

## P0：作廢與補印前先確認「已開立」

### 共用狀態查詢

- [x] 在 `backend/src/amego.ts` 新增 `queryAmegoInvoiceStatus()`，沿用既有的表單編碼、timestamp、MD5 簽章、逾時與敏感資料遮蔽機制。
- [x] 建立明確的狀態結果型別，至少正規化 `code`、`message`、`invoiceNumber`、`invoiceType`、`invoiceStatus`、`printMark`、`cancelDate` 與 `wait`。
- [x] 驗證回傳發票號碼必須等於本機要求的號碼，避免串錯公司或錯誤回應被當成成功。
- [x] 建立共用的 `requireAmegoInvoiceIssuedFor(operation)` 判斷，作廢與補印不得各自寫一套不同規則。
- [x] 2026-08-05 實測確認：作廢排程等待中，`invoice_status` 仍可能只回 `C0401` 且沒有 `wait`，但只讀的 `invoice_query.data.wait` 會出現 `C0501`。因此作廢與補印都必須依序通過 `invoice_status` 與 `invoice_query` 兩層即時查驗；任一層顯示已作廢、已註銷或異動等待中都要阻擋。

### 判斷矩陣

| 光貿結果 | 作廢 | 補印 | OpenKao 行為 |
| --- | --- | --- | --- |
| `code = 0` 且 `type/invoice_type = C0401` | 允許 | 允許 | 繼續原本流程 |
| `NOT_FOUND` 或 `code = 71` | 阻擋 | 阻擋 | 回傳「光貿查無已開立發票」；不可呼叫 `f0501`、不可建列印工作 |
| `C0501` 或已有 `cancel_date` | 阻擋 | 阻擋 | 視為已作廢；本機不得再作廢或補印 |
| `C0701` | 阻擋 | 阻擋 | 視為已註銷 |
| `wait` 中有 `C0501`／`C0701` | 阻擋 | 阻擋 | 顯示異動處理中，避免競爭操作 |
| `code = 51`、逾時、HTTP 錯誤、格式錯誤 | 阻擋 | 阻擋 | 視為「目前無法確認」，保留重試，不得猜測已開立 |
| 未知發票類型或 `invoice_status = 91` | 阻擋 | 阻擋 | 回傳可辨識錯誤並留下稽核紀錄 |

### 作廢流程

- [x] `voidInvoice()` 讀到本機發票後，立即用發票號碼呼叫 `invoice_status` 與 `invoice_query`，不可使用舊資料或快取結果。
- [x] 只有共用判斷確認為 `C0401` 後，才呼叫光貿 `f0501`。
- [x] `f0501` 成功後才將本機發票改為 `voided`，並停止尚未開始的列印工作；查驗失敗或作廢失敗時不可先改本機狀態。
- [x] 保留目前 owner-only 權限及公司隔離；狀態查詢使用該發票所屬公司的統編與 App Key。
- [x] 寫入 `invoice.status.checked` 與既有 `invoice.void.completed` 稽核紀錄，但不保存 App Key、簽章或 `base64_data`。

### 補印流程

- [x] `reprintInvoice()` 建立新 `print_job` 前，立即呼叫 `invoice_status` 與 `invoice_query`。
- [x] 只有共用判斷確認為 `C0401` 後，才可建立 `isReprint = true` 的列印工作。
- [x] 狀態不合格、查無資料或暫時無法確認時，不可建立任何補印工作。
- [x] `invoice_query` 同時負責補查異動排程與修復本機缺少的條碼或左右 QRCode；它是 `invoice_status` 之後的第二層查驗，不是用來取代第一層。
- [x] 保留目前 owner／staff 可補印、owner 才可作廢的權限規則。

## P1：實體列印成功後同步光貿列印註記

### 正確觸發點

- [x] iPhone 維持現有順序：自己的 ESC/POS 資料完整送至印表機後，才回報 `/api/print-jobs/:id/printed`。
- [x] 後端收到成功回報後，先確定該 `print_job`、`invoice`、`company` 屬於同一租戶，再建立一筆待同步的光貿列印註記。
- [x] 正本工作送 `print_invoice_type = 1`；`payload_json.isReprint = true` 的工作送 `print_invoice_type = 2`。
- [x] 列印失敗、工作尚未開始、載具／捐贈而沒有紙本工作的發票，不得呼叫 `invoice_print`。
- [x] 不在開票 `f0401` 成功時就假裝列印，避免本機最後沒有出紙，光貿卻已顯示列印。

### 可靠同步與重試

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

## P2：既有「本機已印、光貿未印」資料補同步

只修未來流程不會改善光貿網站上已存在的「未列印」發票，因此需要一次性補同步。

- [x] migration 或部署後批次工作找出 `print_jobs.status = printed`、有正式 `invoice_id` 與 `amego_order_id`，但尚未同步光貿的資料。
- [x] 每張發票先呼叫 `invoice_status`；`print_mark = Y` 直接標為 `synced`。
- [x] 仍為 `N` 且遠端是 `C0401` 時，使用最早一筆已完成的正本列印工作呼叫 `invoice_print` type `1`。
- [x] 已作廢／註銷、載具或捐贈、0 元、查無資料與超過查詢期限的歷史資料不強行偽造，改列 `manual_review` 並輸出清單。
- [x] 批次作業必須可中斷後續跑、不可重複建立實體列印工作，也不可一次對光貿送出無上限的請求。
- [ ] 在光貿測試公司驗證流程後，先以少量正式發票灰度執行，再處理其餘歷史資料。

## P3：錯誤碼與使用者提示

- [x] 增加 `amego_invoice_not_issued`：光貿查無這張已開立發票，不能作廢或補印。
- [x] 增加 `amego_invoice_status_unavailable`：目前無法向光貿確認發票狀態，請稍後再試。
- [x] 增加 `amego_invoice_change_pending`：光貿正在處理這張發票的異動，暫時不能作廢或補印。
- [x] 已作廢、已註銷與未知類型使用不同訊息，讓店員知道是業務狀態不允許，而不是網路故障。
- [x] iPhone 沿用現有 API 錯誤 alert；不需把 App Key、光貿原始 response 或技術欄位顯示給店員。

## P4：測試

### Amego client 單元測試

- [x] 驗證 `invoice_status` 使用陣列 request、正確 endpoint、timestamp 與 MD5 簽章。
- [x] 驗證 `data` 物件／陣列、`type`／`invoice_type`、數字／字串狀態皆可正規化。
- [x] 驗證 `invoice_print` 正本與補印 request 的 `print_invoice_type` 分別為 `1`、`2`。
- [x] 驗證 `base64_data` 不會出現在保存資料、log 或對 iPhone 的 response。

### Worker integration 測試

- [x] 光貿回 `C0401` 時，作廢才會接著呼叫 `f0501`。
- [x] 光貿回 `NOT_FOUND`、`C0501`、`C0701`、等待作廢或查詢失敗時，作廢不得呼叫 `f0501`，補印不得新增 `print_job`；涵蓋 `invoice_status = C0401` 但 `invoice_query.data.wait = C0501` 的實測時序。
- [x] 補印通過查驗後建立的新工作必須保留 `isReprint = true` 及原發票正式 payload。
- [x] 正本實體列印成功回報後，呼叫 `invoice_print` type `1`；補印成功回報後使用 type `2`。
- [x] 實體列印失敗時不呼叫 `invoice_print`。
- [x] 光貿同步暫時失敗時，本機工作維持 `printed`、遠端同步維持 `pending`；scheduled retry 成功後改為 `synced`。
- [x] 相同 `/printed` 回報重送不會新增重複紙本工作，也不會重複正本列印請求。
- [x] 跨公司發票號碼、裝置或工作 ID 不得被查詢、作廢、補印或同步。
- [x] 歷史補同步只處理符合條件的本機已列印資料，且可以重跑。

### 實際驗收

- [ ] 用光貿測試公司開一張需紙本的正常發票，確認本機列印成功後，`invoice_status.print_mark` 由 `N` 變 `Y`。
- [ ] 確認光貿網站由「未列印」變為「已列印」，紙本內容仍是 OpenKao 自己的固定 58mm 版面。
- [ ] 對同一張發票補印，確認補印前先查 `invoice_status`，實體列印後呼叫 `invoice_print` type `2`。
- [ ] 以不存在、已作廢及正在等待作廢的發票測試，確認作廢與補印都被阻擋且不產生副作用。
- [ ] 關閉網路後完成一次本機列印，再恢復網路，確認不會重印紙本，且後端最後能補同步光貿。

## 建議實作順序

1. 先完成 `invoice_status` client、狀態正規化與測試。
2. 將作廢和補印都改成共用的「已開立」前置查驗。
3. 用光貿測試公司驗證 `invoice_print` 是否真的會把 `print_mark` 改成 `Y`。
4. 驗證成立後，加入 `print_jobs` 光貿同步狀態、即時同步與 scheduled retry。
5. 最後執行歷史補同步，先小批量驗證，再逐步處理剩餘資料。

## 完成標準

- 光貿確認不是 `C0401` 時，OpenKao 絕不作廢，也不建立補印工作。
- 光貿暫時無法查詢時採保守阻擋，不以本機 `issued` 狀態猜測遠端已開立。
- OpenKao 實體列印成功後，光貿後台最後會顯示已列印；暫時斷線可自動補同步。
- 光貿同步失敗不會讓已出紙的工作被當成列印失敗，也不會導致店員重印。
- 光貿回傳的 `base64_data` 永遠不會取代 OpenKao 的自製列印版面，也不會被保存或外流。
