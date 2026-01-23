// Google Apps Script 主程式：Gemini + LINE Bot + Google Sheet 記帳小幫手
// 結構目標：
// - 上面區塊專心放「設定」跟「可改變的參數」
// - 中間是「小工具函式」：讀設定 / 寫 Log / 呼叫 Gemini / 操作試算表
// - 最下面是 doPost()：LINE Webhook 進來後的主流程

/***********************
 * 0. 可調整設定區
 ***********************/

// 試算表名稱（
const SHEET_NAME = 'records';      // 記帳資料
const LOG_SHEET_NAME = 'log';      // 除錯用 log

// 角色設定
const PERSONAS = {
  normal: `你是個專業的理財管家，以下是使用者今日的支出清單：
{{summary}}
請用幽默、親切的語氣總結今天的花費，並給出一個實用的理財建議。`,

  eunuch: `你是古代宮廷的總管太監，使用者是皇上或娘娘。以下是內務府紀錄的今日支出：
{{summary}}
請用「奴才」、「陛下/娘娘」等宮廷用語。語氣要極度諂媚，但又要語重心長地勸諫主子節省國庫銀兩，不要鋪張浪費，以免動搖國本。`,

};

// 目前的人設模式，改這一行就可以切換
// 可選：'normal', 'sarcastic', 'eunuch', 'emo_blackmail'
const CURRENT_PERSONA = 'eunuch';


/***********************
 * 1. 讀取 API Key / Token 設定
 ***********************/

// 從「專案屬性 Script Properties」讀取設定
// 老師只要教學生：到「專案設定 → 專案屬性 → Script Properties」新增三個 key 就好
// GEMINI_API_KEY / LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET
function getConfig_() {
  const props = PropertiesService.getScriptProperties();
  return {
    GEMINI_API_KEY: props.getProperty('GEMINI_API_KEY') || '請先在 Script Properties 設定 GEMINI_API_KEY',
    LINE_CHANNEL_ACCESS_TOKEN: props.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '請先設定 LINE_CHANNEL_ACCESS_TOKEN',
    LINE_CHANNEL_SECRET: props.getProperty('LINE_CHANNEL_SECRET') || '請先設定 LINE_CHANNEL_SECRET'
  };
}


/***********************
 * 2. 初始化試算表（建立欄位）
 ***********************/

function initSheets() {
  const ss = SpreadsheetApp.getActive();

  // 記帳資料表
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['timestamp', 'userId', 'item', 'price']);
  }

  // Log 表（記錄錯誤、除錯資訊）
  let logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(LOG_SHEET_NAME);
    logSheet.appendRow(['timestamp', 'level', 'message', 'raw']);
  }
}


/***********************
 * 3. 簡單 Log 工具（寫到試算表）
 ***********************/

function logMessage_(level, message, raw) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(LOG_SHEET_NAME) || ss.insertSheet(LOG_SHEET_NAME);

    sheet.appendRow([
      new Date(),
      level,
      message,
      raw ? JSON.stringify(raw).substring(0, 5000) : ''  // 避免太長
    ]);
  } catch (e) {
    // 如果連 log 都失敗，就寫 console
    console.error('logMessage_ error:', e);
  }
}


/***********************
 * 4. 呼叫 Gemini API
 ***********************/

function callGemini_(prompt) {
  const config = getConfig_();
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key='
              + config.GEMINI_API_KEY;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }]
  };

  const options = {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  const text = res.getContentText();

  logMessage_('INFO', 'Gemini response', { code: code, body: text });

  if (code !== 200) {
    throw new Error('Gemini API error: ' + code + ' ' + text);
  }

  const data = JSON.parse(text);
  try {
    return data.candidates[0].content.parts[0].text;
  } catch (e) {
    throw new Error('Gemini 回傳格式不如預期: ' + text);
  }
}


/***********************
 * 5. 用 Gemini 解析「品項 + 金額」
 ***********************/

function parseExpenseWithAI_(userText) {
  const prompt =
    `請從以下文字中提取「品項」與「金額」：『${userText}』\n` +
    '請務必只回覆 JSON 格式，如：{"item": "品項名稱", "price": 數字}。\n' +
    '如果這句話看起來不像在記帳，請回覆 {"error": "not_record"}。';

  const aiText = callGemini_(prompt);

  // 處理 ```json ... ```
  let clean = aiText.replace(/```json/gi, '').replace(/```/g, '').trim();

  try {
    const obj = JSON.parse(clean);
    return obj;
  } catch (e) {
    logMessage_('ERROR', 'parseExpense JSON 解析失敗', {
      aiText: aiText,
      clean: clean,
      error: e.toString()
    });
    return { error: 'parse_fail' };
  }
}


/***********************
 * 6. 從試算表讀取某位使用者的所有紀錄
 ***********************/

function getUserRecords_(userId) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues(); // [ [header...], [row1...], ... ]
  const records = [];
  for (let i = 1; i < values.length; i++) { // 從第 2 列開始
    const row = values[i];
    if (row[1] === userId) {  // 第 2 欄是 userId
      records.push({
        item: row[2],           // 第 3 欄 item
        price: Number(row[3]) || 0  // 第 4 欄 price
      });
    }
  }
  return records;
}


/***********************
 * 7. 新增一筆紀錄到試算表
 ***********************/

function addRecord_(userId, item, price) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

  // 若是新表，補上標題列
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['timestamp', 'userId', 'item', 'price']);
  }

  sheet.appendRow([new Date(), userId, item, price]);
}


/***********************
 * 8. 產生分析報告（呼叫 Gemini）
 ***********************/

function getAnalysis_(records) {
  if (!records || records.length === 0) {
    return '你今天還沒記帳喔！';
  }

  const summary = records.map(r => `- ${r.item}: ${r.price}元`).join('\n');
  const template = PERSONAS[CURRENT_PERSONA] || PERSONAS.normal;

  let prompt = template.replace('{{summary}}', summary);
  prompt += '\n請將回覆控制在100字以內。';

  return callGemini_(prompt);
}


/***********************
 * 9. 呼叫 LINE Reply API
 ***********************/

function replyToLine_(replyToken, message) {
  const config = getConfig_();
  const url = 'https://api.line.me/v2/bot/message/reply';

  const payload = {
    replyToken: replyToken,
    messages: [{ type: 'text', text: message }]
  };

  const options = {
    method: 'POST',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + config.LINE_CHANNEL_ACCESS_TOKEN
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const res = UrlFetchApp.fetch(url, options);
  logMessage_('INFO', 'LINE reply response', {
    code: res.getResponseCode(),
    body: res.getContentText()
  });
}


/***********************
 * 🔟 LINE Webhook 入口：doPost
 ***********************/

function doPost(e) {
  try {
    const body = e.postData.contents;
    logMessage_('INFO', '收到 LINE Webhook', body);

    const json = JSON.parse(body);
    const events = json.events || [];

    events.forEach(event => {
      if (event.type !== 'message' || event.message.type !== 'text') return;

      const userId = event.source && event.source.userId ? event.source.userId : 'unknown';
      const userText = event.message.text || '';
      const replyToken = event.replyToken;

      // 1. 如果文字裡包含「分析」或「報告」→ 做總結分析
      if (userText.indexOf('分析') !== -1 || userText.indexOf('報告') !== -1) {
        const records = getUserRecords_(userId);
        const analysis = getAnalysis_(records);
        replyToLine_(replyToken, analysis);
        return;
      }

      // 2. 一般文字 → 當成記帳輸入丟給 Gemini 解析
      const parsed = parseExpenseWithAI_(userText);

      if (parsed.error) {
        // 看起來不是在記帳 → 回 Echo + 小提示
        const msg = `收到！你剛才說了：${userText}\n(小提示：輸入「品項 金額」可以自動記帳喔！)`;
        replyToLine_(replyToken, msg);
      } else {
        const item = parsed.item || '未知品項';
        const price = Number(parsed.price) || 0;

        addRecord_(userId, item, price);

        const records = getUserRecords_(userId);
        const total = records.reduce((sum, r) => sum + (Number(r.price) || 0), 0);

        const msg = `✅ 已紀錄：${item} ${price}元\n今日累計支出：${total}元`;
        replyToLine_(replyToken, msg);
      }
    });

    return ContentService.createTextOutput('OK');
  } catch (err) {
    logMessage_('ERROR', 'doPost 發生錯誤', {
      error: err.toString(),
      stack: err.stack
    });
    return ContentService.createTextOutput('ERROR');
  }
}


/***********************
 * 11. 教學輔助：測試函式
 ***********************/

// 不用連 LINE，也可以在 Apps Script 內測試 Gemini 有沒有通
function testGemini() {
  const text = callGemini_('用 30 個字介紹你自己。');
  Logger.log(text);
}

// 測試「記帳解析」
function testParse() {
  const result = parseExpenseWithAI_('午餐 120');
  Logger.log(JSON.stringify(result));
}

// 一鍵建立 Sheet 欄位
function setup() {
  initSheets();
}
