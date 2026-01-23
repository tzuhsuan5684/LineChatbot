# Gemini LINE 記帳機器人

## 專案簡介

這是一個基於 Google Apps Script 開發的 LINE 聊天機器人，整合了 Google Gemini AI 和 Google Sheets，實現智能記帳功能。使用者可以透過自然語言與機器人對話，自動記錄支出並獲得 AI 分析報告。

## 主要功能

1. **智能記帳**：使用 Gemini AI 自動解析使用者輸入的品項和金額
2. **數據儲存**：將記帳資料自動儲存到 Google Sheets
3. **支出分析**：提供個性化的支出分析和理財建議
4. **多種人設**：支援不同風格的 AI 回應（正常模式、太監模式等）
5. **錯誤日誌**：完整的日誌記錄系統，方便除錯

## 程式架構

```
chatbot.gs
├── 0. 可調整設定區
│   ├── SHEET_NAME: 記帳資料表名稱
│   ├── LOG_SHEET_NAME: 日誌表名稱
│   ├── PERSONAS: AI 人設配置
│   └── CURRENT_PERSONA: 當前使用的人設
│
├── 1. 配置管理
│   └── getConfig_(): 讀取 API Keys 和 Tokens
│
├── 2. 資料庫初始化
│   └── initSheets(): 建立試算表和欄位
│
├── 3. 日誌系統
│   └── logMessage_(): 寫入日誌到試算表
│
├── 4-5. AI 整合
│   ├── callGemini_(): 呼叫 Gemini API
│   └── parseExpenseWithAI_(): 解析記帳資訊
│
├── 6-7. 資料操作
│   ├── getUserRecords_(): 讀取使用者記錄
│   └── addRecord_(): 新增記帳記錄
│
├── 8. AI 分析
│   └── getAnalysis_(): 產生支出分析報告
│
├── 9. LINE 整合
│   └── replyToLine_(): 回覆 LINE 訊息
│
├── 10. Webhook 處理
│   └── doPost(): LINE Webhook 入口
│
└── 11. 測試函式
    ├── testGemini(): 測試 Gemini API
    ├── testParse(): 測試記帳解析
    └── setup(): 一鍵初始化
```

## 資料流程

### 1. 記帳流程
```
使用者輸入 → LINE Webhook → doPost()
    ↓
parseExpenseWithAI_() → Gemini AI 解析
    ↓
addRecord_() → 寫入 Google Sheets
    ↓
計算今日累計 → replyToLine_() → 回覆使用者
```

### 2. 分析流程
```
使用者輸入「分析」或「報告」 → doPost()
    ↓
getUserRecords_() → 讀取所有記錄
    ↓
getAnalysis_() → Gemini AI 分析
    ↓
replyToLine_() → 回覆分析結果
```

## 函式說明

### 核心函式

#### `getConfig_()`
- **功能**：從 Script Properties 讀取 API Keys 和 Tokens
- **返回值**：包含 GEMINI_API_KEY、LINE_CHANNEL_ACCESS_TOKEN、LINE_CHANNEL_SECRET 的物件
- **用途**：集中管理敏感資訊，避免硬編碼

#### `initSheets()`
- **功能**：初始化 Google Sheets，建立必要的工作表和欄位
- **建立的工作表**：
  - `records`：記帳資料表（timestamp, userId, item, price）
  - `log`：日誌表（timestamp, level, message, raw）

#### `logMessage_(level, message, raw)`
- **功能**：將日誌寫入 Google Sheets
- **參數**：
  - `level`：日誌等級（INFO, ERROR）
  - `message`：日誌訊息
  - `raw`：原始資料（選填）
- **用途**：除錯和監控系統運行狀態

### AI 相關函式

#### `callGemini_(prompt)`
- **功能**：呼叫 Google Gemini API
- **參數**：`prompt` - 要傳送給 AI 的提示詞
- **返回值**：AI 生成的文字回應
- **錯誤處理**：記錄 API 回應，並在失敗時拋出錯誤

#### `parseExpenseWithAI_(userText)`
- **功能**：使用 Gemini AI 解析使用者輸入的記帳資訊
- **參數**：`userText` - 使用者輸入的文字
- **返回值**：
  - 成功：`{item: "品項", price: 數字}`
  - 失敗：`{error: "錯誤類型"}`
- **處理**：自動清理 AI 回應中的 markdown 格式

#### `getAnalysis_(records)`
- **功能**：根據記帳記錄產生 AI 分析報告
- **參數**：`records` - 記帳記錄陣列
- **返回值**：AI 生成的分析文字
- **特色**：根據 CURRENT_PERSONA 設定使用不同的人設風格

### 資料操作函式

#### `getUserRecords_(userId)`
- **功能**：從 Google Sheets 讀取特定使用者的所有記帳記錄
- **參數**：`userId` - LINE 使用者 ID
- **返回值**：記錄陣列 `[{item, price}, ...]`

#### `addRecord_(userId, item, price)`
- **功能**：新增一筆記帳記錄到 Google Sheets
- **參數**：
  - `userId`：使用者 ID
  - `item`：品項名稱
  - `price`：金額
- **自動處理**：若工作表不存在會自動建立

### LINE 整合函式

#### `replyToLine_(replyToken, message)`
- **功能**：透過 LINE Messaging API 回覆訊息
- **參數**：
  - `replyToken`：LINE 提供的回覆 token
  - `message`：要回覆的文字訊息
- **日誌**：自動記錄 API 回應狀態

#### `doPost(e)`
- **功能**：LINE Webhook 的入口函式
- **參數**：`e` - Google Apps Script 的 POST 事件物件
- **處理流程**：
  1. 解析 LINE Webhook 資料
  2. 判斷訊息類型（分析 or 記帳）
  3. 呼叫對應的處理函式
  4. 回覆使用者
- **錯誤處理**：完整的 try-catch 和日誌記錄

### 測試函式

#### `testGemini()`
- **功能**：測試 Gemini API 連線
- **用途**：在不連接 LINE 的情況下驗證 API 設定

#### `testParse()`
- **功能**：測試記帳解析功能
- **用途**：驗證 AI 解析邏輯是否正常

#### `setup()`
- **功能**：一鍵初始化所有工作表
- **用途**：首次部署時快速建立資料結構

## 安裝步驟

### 1. 建立 Google Apps Script 專案

1. 開啟 [Google Sheets](https://sheets.google.com)
2. 建立新試算表
3. 點選「擴充功能」→「Apps Script」
4. 將 `chatbot.gs` 的程式碼複製貼上

### 2. 設定 API Keys

1. 在 Apps Script 編輯器中，點選「專案設定」（齒輪圖示）
2. 滾動到「Script Properties」區塊
3. 新增以下三個屬性：

| 屬性名稱 | 取得方式 |
|---------|---------|
| `GEMINI_API_KEY` | 前往 [Google AI Studio](https://makersuite.google.com/app/apikey) 取得 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 在 LINE Developers Console 的 Messaging API 頁面取得 |
| `LINE_CHANNEL_SECRET` | 在 LINE Developers Console 的 Basic Settings 頁面取得 |

### 3. 初始化試算表

1. 在 Apps Script 編輯器中，選擇函式 `setup`
2. 點選「執行」按鈕
3. 授權應用程式存取 Google Sheets

### 4. 部署為 Web 應用程式

1. 點選「部署」→「新增部署作業」
2. 選擇類型：「網頁應用程式」
3. 設定：
   - 執行身分：「我」
   - 具有存取權的使用者：「所有人」
4. 點選「部署」
5. 複製「網頁應用程式 URL」

### 5. 設定 LINE Webhook

1. 前往 [LINE Developers Console](https://developers.line.biz/)
2. 選擇你的 Messaging API Channel
3. 在「Messaging API」頁籤中：
   - 將剛才複製的 URL 貼到「Webhook URL」
   - 啟用「Use webhook」
   - 停用「Auto-reply messages」

### 6. 測試

1. 在 LINE 中加入你的機器人為好友
2. 傳送訊息測試：
   - `午餐 120` → 應該記錄一筆支出
   - `分析` → 應該收到支出分析報告

## 使用範例

### 記帳
```
使用者：早餐 50
機器人：✅ 已紀錄：早餐 50元
       今日累計支出：50元

使用者：買了一杯咖啡花了 80 塊
機器人：✅ 已紀錄：咖啡 80元
       今日累計支出：130元
```

### 分析報告
```
使用者：分析
機器人：（根據 CURRENT_PERSONA 設定回應）

# 正常模式範例
今天總共花了 130 元，主要在飲食上。
建議可以自己準備早餐，每月可省下約 1000 元喔！

# 太監模式範例
啟稟陛下，今日內務府記錄您花費 130 兩銀子，
奴才斗膽進言，若陛下能稍加節制飲食開銷，
國庫將更加充盈，社稷更加穩固啊！
```

## 自訂設定

### 更換 AI 人設

在程式碼第 29 行修改 `CURRENT_PERSONA`：

```javascript
const CURRENT_PERSONA = 'normal';  // 正常模式
// 或
const CURRENT_PERSONA = 'eunuch';  // 太監模式
```

### 新增自訂人設

在 `PERSONAS` 物件中新增：

```javascript
const PERSONAS = {
  normal: `...`,
  eunuch: `...`,
  
  // 新增你的人設
  custom: `你是一個___，以下是使用者今日的支出清單：
{{summary}}
請用___的語氣總結今天的花費。`
};
```

## 常見問題

### Q1: 機器人沒有回應？
- 檢查 Webhook URL 是否正確設定
- 查看 Google Sheets 的 `log` 工作表，確認是否有錯誤訊息
- 確認 Script Properties 中的 API Keys 是否正確

### Q2: AI 解析錯誤？
- 執行 `testParse()` 函式測試
- 查看 `log` 工作表中的 Gemini API 回應
- 確認 GEMINI_API_KEY 是否有效

### Q3: 記帳資料沒有儲存？
- 確認 `records` 工作表是否存在
- 執行 `setup()` 函式重新初始化
- 檢查 `log` 工作表是否有錯誤訊息

### Q4: 如何查看除錯資訊？
- 開啟 Google Sheets
- 查看 `log` 工作表
- 所有 API 呼叫和錯誤都會記錄在此

## 技術細節

### 使用的 API
- **Google Gemini API**
- **LINE Messaging API**

### 試算表欄位說明

#### records 工作表
| 欄位 | 類型 | 說明 |
|------|------|------|
| timestamp | Date | 記錄時間 |
| userId | String | LINE 使用者 ID |
| item | String | 品項名稱 |
| price | Number | 金額 |

#### log 工作表
| 欄位 | 類型 | 說明 |
|------|------|------|
| timestamp | Date | 日誌時間 |
| level | String | 日誌等級（INFO/ERROR） |
| message | String | 日誌訊息 |
| raw | String | 原始資料（JSON） |


