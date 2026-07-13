# OpenvoKao TODO 5：待印區流程調整與收尾

更新日期：2026-07-13

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

## 驗證結果

- iPhone 6s Plus 實機測試：
  - [x] 進入待印頁面自動連線已儲存印表機。
  - [x] 左滑單筆列印，印完後該筆從待印區消失。
  - [x] 「全部列印」連續印多張，最後一張 QR code 不再亂碼。
- 單元測試：
  - 共執行 26 筆測試，25 筆通過。
  - `testOfficialHeaderUsesRequiredLargeBoldText` 仍失敗，此為先前已存在的問題，與本次待印區改動無關。

## 未來可選優化

- [ ] 若 0.5 秒間隔在某些印表機上仍太短，可改成動態依列印結果調整，或於設定頁提供「連續列印間隔」選項。
- [ ] 若印表機支援，可嘗試用 `DLE EOT n` 主動查詢印表機狀態來取代固定延遲；光貿 BLE 小票機目前不確定支援，故先以 delay 解決。
- [ ] 後續若要保留偵錯能力，可改為只在發生列印失敗時把該筆資料寫入暫存，並限制只保留最近 N 份。

## 相關檔案

- `openvoKao/ContentView.swift`：`PrintQueueView` 與全部列印流程。
- `openvoKao/PrinterManager.swift`：BLE 傳送與 chunk 管理，已移除 dump。
- `openvoKaoTests/ReceiptRendererTests.swift`：已移除會寫入 `/tmp` 的偵錯測試。
