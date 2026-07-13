# OpenvoKao TODO 6：正式發票亂碼診斷與 BLE 分包修正

更新日期：2026-07-13

## 問題現象

- 同一台光貿 P211 藍牙熱感印表機，App 內的「測試列印」正常。
- 從待印區列印正式電子發票時，印表機會輸出大量亂碼。
- 問題可在 iPhone 13 Pro 重現；修正後已在 iPhone 13 Pro 與 iPhone 6s Plus 驗證成功。

## 診斷方式

這類問題不能只看畫面或 `ReceiptRenderer` 的字串。必須同時取得：

1. App 最終產生的完整 ESC/POS bytes。
2. BLE characteristic properties、write type 與最大寫入長度。
3. 每個 BLE packet 的 index、offset、長度、送出時間與 ready callback。
4. 測試列印和正式發票各一次，才能對照兩條流程。

本次曾暫時加入 `PrintDiagnosticsLogger.swift`，並在 `PrinterManager` 的列印管線埋點。正式修正確認後已移除，不會在正式 App 持續寫入 Log。

### 建議的暫時 Log 格式

需要再次診斷時，可建立 `Documents/PrintDiagnostics/`，內容如下：

- `print-diagnostics.log`
  - 使用 JSON Lines，每行一個事件。
  - 每次列印建立獨立 `session`，並標記 `kind=test` 或 `kind=invoice`。
  - 建議事件：
    - `print.begin`
    - `transport.configured`
    - `chunk.write`
    - `chunk.response`
    - `transport.ready_without_response`
    - `print.succeeded`
    - `print.failed`
  - 建議欄位：
    - iOS/App 版本
    - 印表機名稱與 UUID
    - characteristic UUID/properties
    - `withResponse` 或 `withoutResponse`
    - maximum write length
    - payload byte count 與 SHA-256
    - chunk index、實際 stream offset、byte count
    - chunk 前後 16 bytes 的 hex
    - ISO 8601 timestamp
- `<timestamp>-test-<session>.escpos.bin`
- `<timestamp>-invoice-<session>.escpos.bin`
  - 保存該次實際交給 BLE 傳送層的完整 ESC/POS 位元流。
  - `.bin` 可能包含發票號碼、統編、品項及 QR Code payload，必須視為敏感資料。

Logger 必須使用獨立 serial queue 寫檔，且所有寫檔錯誤都只能被忽略或記錄，不能讓診斷功能中斷列印。另應限制 Log 大小與 `.bin` 數量，例如 Log 5 MB 輪替、只保留最近 30 份 payload。

### 建議埋點位置

在 `PrinterManager`：

1. `ReceiptRenderer` 完成後、開始傳送前：
   - 寫出完整 `.escpos.bin`。
   - 記錄 payload 大小、SHA-256、前後 hex、點陣圖命令的位置與尺寸。
2. 選定 BLE write type 後：
   - 記錄 characteristic properties。
   - 記錄 `maximumWriteValueLength(for:)`。
   - 記錄 chunk size/count。
3. 每次 `writeValue` 前：
   - 記錄 chunk index、實際 offset、長度、hex prefix/suffix。
4. `didWriteValueFor` 與 `peripheralIsReady(toSendWriteWithoutResponse:)`：
   - 記錄 callback 時間與錯誤。
5. 任務完成或失敗：
   - 記錄總耗時與結果。

## 如何透過 Xcode 取回 App Container

1. 將 iPhone 以 USB 連接 Mac，保持手機解鎖並信任此電腦。
2. 開啟 Xcode。
3. 選擇 `Window` → `Devices and Simulators`。
4. 在左側選擇目標 iPhone。
5. 在 Installed Apps 清單找到 `openvoKao`（Bundle ID：`com.kaochifeng.openvoKao`）。
6. 選取 App，使用下方動作按鈕或右鍵選擇 `Download Container...`。
7. Xcode 會產生 `<Bundle ID> <timestamp>.xcappdata`。
8. 在 Finder 對 `.xcappdata` 按右鍵，選擇「顯示套件內容」。
9. 進入：

   `AppData/Documents/PrintDiagnostics/`

10. 分析時必須一起取得：
    - `print-diagnostics.log`
    - 對應的 `*-test-*.escpos.bin`
    - 對應的 `*-invoice-*.escpos.bin`

下載 Container 前，應各執行一次測試列印與正式發票列印，並等 App 顯示「已送至印表機」後再下載，避免最後幾筆非同步 Log 尚未寫完。

## 本次 Log 的實際證據

使用裝置與印表機：

- iPhone 13 Pro，iOS 27.0 測試版。
- 光貿 `P211-313b`。
- BLE characteristic：`49535343-8841-43F4-A8D4-ECBE34729BB3`。
- characteristic properties raw value 為 `4`，也就是只支援 `writeWithoutResponse`。
- App 當時固定以 64 bytes 切包。

正式發票：

- payload：10,992 bytes。
- 172 個 BLE chunks。
- 所有 chunk index 完整且連續，Log 的 hex 與 `.bin` 全部一致，沒有遺漏、重複或重排。
- 完整 GB18030/GBK 文字可以正確解碼。
- Barcode 與雙 QR 的 ESC/POS raster 尺寸正確。
- 最大相鄰 chunk 停頓為 228 ms，另有一次 155 ms。

測試列印：

- payload：10,615 bytes。
- 166 個 BLE chunks。
- 最大相鄰 chunk 停頓只有 50 ms。

最關鍵的 packet 邊界：

1. 正式發票的「月」字 GBK bytes `D4 C2` 位於 stream offset 63，舊切法讓 `D4` 留在第一包最後、`C2` 落到下一包第一個 byte。
2. 後段「額」字的 GBK bytes `EE 7E` 也被切在 64-byte packet 邊界。
3. 正式發票第二張 raster（雙 QR）從 offset 4408 開始：
   - `4408 % 64 = 56`。
   - `GS v 0` raster header 剛好是 8 bytes。
   - 因此 header 正好佔滿該 packet 的最後 8 bytes，真正的 6,300-byte 圖片資料從下一包才開始。
   - header packet 與第一包圖片資料之間又停頓約 27 ms。
4. 測試列印的 raster header 沒有落在這種危險邊界，header 後方同一包內仍有圖片資料。

由此排除：

- 發票 API/Base64 內容錯誤。
- GB18030/GBK 編碼失敗。
- ESC/POS raster 長寬錯誤。
- App 漏送、重複送或打亂 chunk。

根因是「固定每 64 bytes 硬切」配合 `writeWithoutResponse` 的不穩定節流，觸發 P211 韌體跨 BLE packet 解析 ESC/POS/GBK 串流的問題。當 raster 狀態遺失時，後續圖片 bytes 會被當成文字資料，形成大量亂碼。

## 永久修正

### 1. ESC/POS-aware packetizer

檔案：`openvoKao/PrinterTransport.swift`

新增 `ESCPosPacketizer.chunks(from:maximumSize:)`，取代單純使用 `stride(... by: 64)` 的硬切方式。

分包規則：

- 每包仍不超過 64 bytes。
- ESC/POS 固定長度命令保持完整，不從命令中間切開。
- GB18030/GBK 雙位元字元保持完整，不讓 lead byte 留在 packet 最後。
- 識別 `GS v 0` raster header，若目前 packet 剩餘空間不足以同時容納 8-byte header 和至少 1 byte 圖片資料，就先結束目前 packet，讓 header 與第一個 raster byte 一起進入下一包。
- 識別 `GS ( k` QR command 的長度欄位，避免把 header 孤立在 packet 尾端。
- 分包前後所有 bytes 串接結果必須與原始 ESC/POS payload 完全一致；packetizer 只改 BLE 邊界，不改列印內容。

### 2. 強制生效的傳輸節流

檔案：`openvoKao/PrinterManager.swift`

舊程式原本每送兩包安排 40 ms delay，但 `peripheralIsReady(toSendWriteWithoutResponse:)` 可能在 timer 到期前再次呼叫 `pumpWriteQueue()`，直接繞過 delay。Log 顯示 chunk 間隔中位數只有約 2 ms，證明原節流沒有穩定生效。

修正後：

- 每送兩個 packets，建立一個 `DispatchWorkItem`，40 ms 後才恢復傳送。
- `scheduledWritePump` 存在時，任何 ready callback 呼叫 `pumpWriteQueue()` 都直接返回。
- timer 真正到期後先清除 `scheduledWritePump`，再繼續傳送。
- 列印完成、失敗、切換印表機或連線中斷時，取消尚未執行的 work item 並重設 burst counter。

這同時避免大量資料過快灌入 P211 buffer，以及 buffer 壓力造成數百毫秒的不規則停頓。

## 測試與驗證

新增 packetizer 單元測試：

- [x] GBK 雙位元字元位於第 64-byte 邊界時，不會被拆成兩包。
- [x] raster header 原本會剛好填滿 packet 尾端時，會移到下一包，並與第一個圖片 byte 放在同一包。
- [x] 所有 chunks 串接後與原始 payload 完全相同。

實機驗證：

- [x] iPhone 13 Pro 正式發票列印成功，不再出現亂碼。
- [x] iPhone 6s Plus 已部署同一修正版並確認可正常列印。
- [x] 測試列印仍正常。

## 移除診斷 Log

問題確認後已完成以下清理：

- [x] 刪除 `openvoKao/PrintDiagnosticsLogger.swift`。
- [x] 移除 `PrinterManager` 中所有 `PrintDiagnosticsLogger` 呼叫。
- [x] 移除每個 chunk 的 hex/timestamp 記錄。
- [x] 移除藍牙連線與 characteristic 診斷事件。
- [x] App 不再建立 `Documents/PrintDiagnostics/` 或新的 `.escpos.bin`。

注意：以覆蓋安裝更新 App 時，舊 Container 內先前已產生的診斷檔不會自動消失，但新版 App 不會再新增內容。若需要清除歷史敏感資料，可透過下載 Container 後確認，再手動刪除 App 資料；不要為了部署新版而先 uninstall，否則其他 App Container 資料也會一起消失。

## 部署原則

- iPhone 13 Pro 使用 `devicectl device install app` 覆蓋安裝。
- iPhone 6s Plus 使用 `ios-deploy --bundle ... --nostart` 覆蓋安裝。
- 不先 uninstall，才能保留 App Container。
- 未經要求不自動 launch App。

## 相關檔案

- `openvoKao/PrinterTransport.swift`：`ESCPosPacketizer`。
- `openvoKao/PrinterManager.swift`：BLE write queue 與強制節流。
- `openvoKaoTests/PrinterManagerTests.swift`：packetizer 邊界測試。
