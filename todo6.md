# TODO 6：iPhone 13 正式發票亂碼修正

更新日期：2026-07-13

## 一句話說明

問題不在發票內容，也不是 iPhone 13 比 iPhone 6s 差，而是 **iPhone 13 傳送藍牙資料較快，剛好暴露了 P211 印表機處理資料邊界的問題**。

舊程式每 64 bytes 直接切一包，有時會把中文字或圖片指令切成兩半。iPhone 6s 傳送較慢時，印表機通常來得及接續解析；iPhone 13 傳送較快、回呼節奏也不同，印表機較容易失去解析狀態，於是把圖片資料當成文字印出，畫面上就變成大量亂碼。

這也是為什麼「舊手機正常，新手機反而有問題」：**差別在 BLE 傳輸速度與時序，不在手機效能高低。真正無法穩定承受資料流的是印表機。**

> 補充：修正前只從 iPhone 13 取回了完整 Log，沒有取得同版本 iPhone 6s 的對照 Log。因此「6s 因傳得較慢而沒有觸發」是根據傳輸行為與修正結果做出的判斷，不是假裝有量測到的結論。

## 為什麼測試列印正常，正式發票卻亂碼？

兩者產生的資料排列不同。

- 正式發票有中文字、條碼及兩張 QR Code 圖片。
- 正式發票的部分中文字剛好落在 64-byte 分包邊界，被拆成前後兩包。
- 第二張 QR Code 的圖片指令也剛好停在一包的最後，真正的圖片資料要等下一包才送出。
- 測試列印沒有碰到相同的危險邊界，所以看起來一直正常。

從 iPhone 13 的 Log 確認 App 沒有少送、重複送或打亂資料，發票編碼及圖片尺寸也都正確。錯誤發生在「資料如何切包及多快送給印表機」。

## 本次如何修正

### 1. 不再固定每 64 bytes 硬切

在 `openvoKao/PrinterTransport.swift` 加入 `ESCPosPacketizer`：

- 每包仍不超過印表機可接受的 64 bytes。
- 中文字的兩個 bytes 不拆開。
- ESC/POS 指令不從中間拆開。
- QR Code 圖片指令的 header 不會單獨留在上一包尾端，至少會和第一個圖片 byte 放在同一包。
- 分包方式雖然改變，但全部資料重新接起來仍與原始發票完全相同。

### 2. 確實限制傳送速度

在 `openvoKao/PrinterManager.swift` 修正節流：

- 每送 2 包，固定等待 40 ms 再繼續。
- 等待期間即使 iPhone 收到「可以繼續傳送」的 BLE 回呼，也不能提早繞過等待。
- 列印完成、失敗或斷線時會取消尚未執行的傳送工作。

修正後已在 iPhone 13 Pro 與 iPhone 6s Plus 實際列印成功。

## 日後遇到列印問題，如何暫時加 Log

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

## 如何用 Xcode 取回 Log

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

## 本次確認結果

- [x] 發票內容及中文字編碼正確。
- [x] App 沒有漏送、重複或打亂資料。
- [x] 改用安全分包，避免拆開中文字及圖片指令。
- [x] 修正 BLE 傳送節流，避免 iPhone 13 傳得太快。
- [x] iPhone 13 Pro 正式發票列印成功。
- [x] iPhone 6s Plus 正式發票列印成功。
- [x] 相關單元測試通過。
- [x] 正式 App 已移除診斷 Logger，不再產生新的 Log 或 `.escpos.bin`。

## 部署注意事項

- 更新 App 時直接覆蓋安裝，不要先刪除 App，才能保留原有 App 資料。
- 除非使用者要求，部署後不要自動開啟 App。
