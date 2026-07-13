# OpenvoKao TODO 3：Amego 開票資料與發票列印

更新日期：2026-07-13

## 重要結論

OpenKao 不是電子發票加值中心，不自行產生財政部 QRCode 的 AES 驗證內容，也不自行重算左右 QRCode。

正式流程應為：

1. OpenKao 後端將交易與商品資料送至光貿 Amego。
2. Amego 開立發票並回傳正式發票資料。
3. OpenKao 將 Amego 回傳的 `invoice_number`、`random_number`、`barcode`、`qrcode_left`、`qrcode_right` 等欄位原樣保存。
4. iPhone 使用上述正式字串自行排版與列印，避免直接使用 `base64_data` 時受到印表機型號與 ESC/POS 實作差異影響。
5. 若特定印表機確認可正確使用 Amego 的 `base64_data`，才把它當成該印表機設定檔的相容列印方式。

## 已確認現況

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

## 資料責任

### Amego 負責

- 正式開立電子發票。
- 分配發票號碼與隨機碼。
- 產生官方可用的 `barcode`、`qrcode_left`、`qrcode_right`。
- 處理 QRCode AES 驗證資訊及財政部規格細節。
- 回傳開票成功或失敗結果。

### OpenKao 後端負責

- 從 D1 讀取該公司的 Amego 開票號碼與 App Key。
- 驗證交易金額、商品、載具、統編與捐贈碼後呼叫 Amego。
- 保存開票請求摘要、Amego 正式回應與開票狀態。
- 建立只包含 Amego 正式列印資料的 `print_job`。
- 支援查詢、補印、作廢與錯誤追蹤。

### iPhone 負責

- 取得後端建立的列印工作。
- 紙面中文依印表機設定使用 GBK。
- QRCode 直接使用 Amego 回傳的原始 payload bytes，不做 GBK 轉碼。
- 將 Amego 回傳的一維條碼與左右 QRCode 產生穩定的點陣圖後列印。
- 回報列印成功、失敗與錯誤原因。

## P0：修正目前錯誤方向

- [x] 停止把 OpenKao 的自製 QR payload builder 接入正式開票與列印流程。
- [x] 移除或隔離目前實驗性的 77 碼組合、商品切碼及自行產生左右 QRCode 邏輯。
- [x] 移除或隔離公司 QRCode AES Key 設定頁、加密儲存欄位與相關 API；Amego App Key 繼續保留。
- [x] `PrintJobPayload` 不再接受後端自行計算的正式發票 QRCode，只能使用 Amego 回傳或既有舊工作保存的 payload。
- [x] 修正測試名稱與內容，避免測試通過卻驗證了錯誤的加值中心流程。

## P1：後端串接 Amego

### A. 開票請求

- [x] 新增單一 Amego API client，集中處理網址、表單編碼、逾時、回應解析與錯誤格式。
- [x] App Key 必須從 D1 的公司資料讀取，不可寫死在 iOS 或程式碼中，也不可回傳手機。
- [x] 後端依 `openvoice` 的方式建立 `ProductItem`，包含 `Description`、`Quantity`、`UnitPrice`、`Amount`、`Remark`、`TaxType`。
- [x] 支援一般消費者、公司統編、手機條碼載具與捐贈碼，並驗證彼此不能使用的組合。
- [x] 確認 `BuyerIdentifier` 空值格式、稅額計算及 `PrinterType` 的實際值，不直接照搬舊版的 `PrinterType: 5`。
- [x] 大陸印表機使用 Amego 支援的 GBK `PrinterLang` 值，並將其做成公司設定。（D1 預設 `2=GBK`，只有設定 `PrinterType` 才送出）
- [x] 每筆交易在呼叫前提供唯一且穩定的 `OrderId`；同一筆交易重試沿用原值，內容不同則拒絕，避免重複開票。
- [x] 僅由後端計算 `sign = md5(data + time + appKey)` 並送至 Amego `f0401`。

### B. 開票結果

- [x] 先保存 `issuing` 狀態，再呼叫 Amego；成功改為 `issued`，明確失敗改為 `failed`。
- [x] 若 Amego 呼叫逾時或結果不明，不可直接重送開票；先用 `OrderId` 或查詢 API 確認是否已開立。
- [x] 同時支援並記錄 Amego 實際回應的頂層或 `data` 物件格式，解析後統一成 OpenKao 內部格式。
- [x] 成功時驗證並保存 `invoice_number`、`invoice_date`、`invoice_time`、`random_number`、`barcode`、`qrcode_left`、`qrcode_right`。
- [x] 保存銷售額、稅額、總額、買方統編、賣方統編、載具、捐贈碼與商品明細。
- [x] `amego_response_json` 保存必要回應與錯誤資訊，但遮蔽 App Key、簽章及其他秘密。
- [x] `base64_data` 不放入一般回應摘要；若確定需要保存原始列印資料，再評估獨立欄位或檔案儲存，避免 D1 資料列過大。
- [x] 若成功回應缺少 `barcode`、`qrcode_left` 或 `qrcode_right`，使用 `invoice_query` 補查；仍缺少時不得建立正式列印工作。

### C. D1 資料表

- [x] 為 `invoices` 增加或確認以下欄位：Amego `OrderId`、開票狀態、發票日期、發票時間、銷售額、稅額、條碼字串、左 QRCode、右 QRCode及錯誤代碼。
- [x] `invoice_items` 保存開票當下的商品快照，不因商品主檔後來改名或改價而變動。
- [x] `OrderId`、公司與發票號碼建立唯一限制，防止重複開票或跨公司資料混用。
- [x] 補印一律讀取首次開票時保存的 `barcode`、`qrcode_left`、`qrcode_right`，不可重新計算。
- [x] 作廢後更新發票狀態並保留原始開票與作廢紀錄，不刪除發票資料。

## P2：列印工作與 iOS

### A. API 合約

- [x] `PrintJobPayload` 正式加入 `leftQRCodePayload`、`rightQRCodePayload` 與 Amego `barcodePayload`。
- [x] 暫時保留舊 `qrCodePayload` 讀取能力，讓已存在的舊列印工作不會崩潰；新發票不得再建立單 QR 工作。
- [x] 建立列印工作前，比對 payload 的發票號碼與 `invoice_id` 保存資料一致；D1 trigger 也會阻擋正式條碼或 QRCode 不一致的工作。
- [x] 手機端只取得列印所需欄位，不取得 Amego App Key、簽章或任何 QRCode AES Key。

### B. 雙 QRCode

- [x] `AppModels.PrintJob`、`BackendClient` 與測試 fixture 改為左右兩個 QRCode payload。
- [x] `ReceiptRenderer` 將左右 QRCode 合成同一張黑白點陣圖後列印，固定大小、間距、上緣與 quiet zone。
- [x] 列印版面僅支援 58mm 紙寬，採固定版面；長商品名稱不得推擠或縮放 QRCode。
- [x] QRCode 使用 Amego 字串的原始 UTF-8 bytes，不套用紙面中文的 GBK 編碼。
- [ ] 掃描結果必須與 D1 保存的 `qrcode_left`、`qrcode_right` 完全一致，右碼是否以 `**` 開頭以 Amego 實際回傳為準。

### C. 一維條碼

- [x] 一維條碼內容只使用 Amego 回傳的 `barcode`，OpenKao 不自行拼接期別、發票號碼或隨機碼。
- [x] Code39 視為政府建議與相容選項，不在程式中寫死為唯一格式。
- [x] 依目前印表機相容性需求選用 Code128；實體印表機掃描驗收仍列在 P4。
- [x] 不依賴各印表機品質不一的內建條碼指令，改由 iOS 產生固定模組寬度、高度與 quiet zone 的黑白點陣圖。
- [x] 條碼圖片不經列印驅動縮放，避免線寬不均造成無法掃描。
- [ ] 條碼下方顯示與 Amego `barcode` 相同的人眼可讀文字；目前 renderer 只印點陣條碼。

### D. 列印模式

- [x] 僅使用 OpenKao 固定 58mm renderer 加上 Amego 正式 payload。
- [x] 不採用 Amego `base64_data` 相容模式，避免印表機型號差異、無法可靠判斷列印結果及回退時重複列印。

## P3：查詢、補印與作廢

- [x] 發票管理頁從 D1 顯示 `issuing`、`issued`、`print_pending`、`printed`、`print_failed`、`voided` 等狀態。
- [x] 發票詳情可用 Amego `invoice_query` 補查並修復缺少的正式欄位。
- [x] 補印建立新的 `print_job`，但沿用同一張發票保存的正式 payload。
- [x] 作廢呼叫 Amego 對應 API，成功後更新狀態並寫入稽核紀錄。
- [x] 任何補查、補印與作廢都必須限制在登入者所屬公司。

## P4：測試與驗收

- [x] Amego client 使用遮蔽敏感資料的固定回應 fixture，測試成功、業務錯誤、HTTP 錯誤、逾時與不完整回應。
- [x] 測試同一 `OrderId` 重試不會建立兩張發票。
- [x] 測試一般消費者、公司統編、手機載具、捐贈碼、單一商品與多商品。
- [x] 測試繁體中文商品名稱在紙面以 GBK 正常列印，QR payload 本身不被轉碼。
- [x] 將 58mm 列印結果輸出為 PDF 或圖片預覽，確認雙 QRCode、條碼、文字與紙張邊界。（`output/pdf/openkao-58mm-invoice-preview.pdf`）
- [ ] 使用手機掃描左右 QRCode，結果必須與 Amego 回傳內容逐字相同。
- [ ] 使用條碼掃描器或手機測試一維條碼，結果必須與 Amego `barcode` 逐字相同。
- [ ] 至少以兩款實體印表機測試；PDF 預覽只能驗證版面，不能取代實機掃描測試。
- [x] 驗證列印失敗不會改變發票內容，也不會重複向 Amego 開票。

## 建議執行順序

1. 先用最新版補印，確認三段式 `GS v 0` 能在目前 58mm 印表機印出完整雙 QRCode。
2. 掃描左右 QRCode 並逐字比對 D1 的 `qrcode_left`、`qrcode_right`。
3. 掃描 Code128 並比對 Amego `barcode`；決定是否補印條碼下方的人眼文字。
4. 至少再用第二款 58mm 印表機完成相同驗收。

## 驗收標準

- 每張正式發票的號碼、隨機碼、一維條碼與左右 QRCode 都直接來自 Amego。
- OpenKao 不保存或自行產生 QRCode AES Key，不扮演加值中心。
- Amego App Key 只在後端使用，從 D1 公司資料讀取，不會出現在手機、log 或 API 回應。
- 同一筆交易即使網路逾時或重試，也不會重複開立發票。
- 僅支援 58mm 紙寬，版面可完整列印；紙面中文正常，左右 QRCode 與一維條碼可掃描。
- 補印內容與第一次開票保存的正式內容完全一致。

## 參考

- `openvoice/lib/widgets/payment_dialog.dart`：舊版 `f0401` 開票、簽章及 `base64_data` 列印流程。
- `openvoice/lib/services/invoice_service.dart`：舊版 Amego 開票資料組合。
- `openvoice/lib/pages/invoice_detail.dart`：`invoice_query` 查詢與作廢流程。
- `openvoice/lib/utils/print_utils.dart`：`base64_data` 解碼後直接送印表機。
- Amego API 文件：https://invoice.amego.tw/api_doc/
- Amego API 呼叫範例：https://invoice.amego.tw/api_doc/example
