# OpenvoKao TODO 3：Amego 發票列印資料與條碼相容性

更新日期：2026-07-11

## 背景

`openvoice` 的舊流程是 App 直接呼叫 Amego API，並從回應取得 `responseData['base64_data']`。該欄位解碼後看起來是 Amego 依 `PrinterType` 產生好的列印資料，而不是一般 PNG/JPG 圖檔。

目前推測問題是：Amego 回傳的 `base64_data` 會依不同印表機設定產生不同 ESC/POS 指令，導致某些印表機列出來的一維條碼無法掃描。

## 目標

- 不再完全依賴 Amego 回傳的整份 `base64_data` 作為最終列印內容。
- 保留 Amego 正式開立發票後取得的發票號碼、隨機碼、QR code 內容、條碼內容等正式資料。
- 由我們自己的 iOS renderer 產生穩定、可控、跨印表機相容的列印指令。
- 一維條碼優先改用 Code128 指令產生，避免不同 `PrinterType` 對條碼格式造成不可掃描。

## 待辦

- [ ] 確認 Amego API 回應中除了 `base64_data` 外，是否有可直接取得一維條碼內容、QR code 內容、發票號碼、隨機碼、期別、金額、買賣方統編等欄位。
- [ ] 若 Amego 只提供 `base64_data`，研究是否能從 API 回應或其他查詢 API 取得原始條碼字串，而不是解析列印 bytes。
- [ ] 後端串接 Amego 開立發票後，將正式發票資料存入 `invoices` / `print_jobs.payload_json`，手機端只負責列印。
- [ ] iOS `ReceiptRenderer` 的一維條碼改以 Code128 ESC/POS 指令產生，並確認目前 `appendBarcodeCode128` 是否符合目標印表機規格。
- [ ] 不同印表機實測同一張發票的一維條碼可被掃描，包括目前會失敗的機型。
- [ ] 補一組正式測試資料：檢查 QR code、Code128 一維條碼、發票號碼、隨機碼、期別、總額、統編都正確。

## 驗收標準

- 使用 Amego 正式測試資料開立發票後，不依賴 Amego 整份 `base64_data` 直接送印。
- 同一張發票在至少兩種印表機上列印，一維條碼都可掃描。
- QR code 仍符合財政部電子發票格式要求。
- 58mm / 80mm 紙寬都不會造成條碼截斷或過窄。

## 參考

- `openvoice/lib/widgets/payment_dialog.dart`：舊流程從 `responseData['base64_data']` 取得列印資料。
- `openvoice/lib/utils/print_utils.dart`：舊流程將 `base64_data` 解碼後直接送印表機。
- `openvoKao/ReceiptRenderer.swift`：目前新 App 由 iOS 自己產生 ESC/POS 指令與 Code128 條碼。
