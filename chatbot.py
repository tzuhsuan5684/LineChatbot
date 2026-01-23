import os
import json
from flask import Flask, request, abort
from linebot import LineBotApi, WebhookHandler
from linebot.exceptions import InvalidSignatureError
from linebot.models import MessageEvent, TextMessage, TextSendMessage
import google.generativeai as genai
from pyngrok import ngrok

# --- 1. 設定區 (請填入你的金鑰) ---
LINE_CHANNEL_ACCESS_TOKEN = "你的_LINE_ACCESS_TOKEN"
LINE_CHANNEL_SECRET = "你的_LINE_CHANNEL_SECRET"
GEMINI_API_KEY = "你的_GEMINI_API_KEY"
NGROK_AUTHTOKEN = "你的_NGROK_AUTHTOKEN"


# --- 2. 初始化 API ---
app = Flask(__name__)
line_bot_api = LineBotApi(LINE_CHANNEL_ACCESS_TOKEN)
handler = WebhookHandler(LINE_CHANNEL_SECRET)

# 設定 Gemini
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.0-flash')

# 暫時性的資料存儲 (這會在程式重啟後消失，適合教學演示)
user_records = {} # 格式: { user_id: [ {'item': '午餐', 'price': 100}, ... ] }

# --- 3. 邏輯處理 ---

# 角色設定
PERSONAS = {
    "normal": """
    你是個專業的理財管家，以下是使用者今日的支出清單：
    {summary}
    請用幽默、親切的語氣總結今天的花費，並給出一個實用的理財建議。
    """,
    "sarcastic": """
    你是個陰陽怪氣的記帳助理，以下是使用者今日的支出清單：
    {summary}
    請用尖酸刻薄、嘲諷的語氣點評這些花費。例如：「喔，真有錢啊，買這種東西？」或「看來您的荷包跟您的腦袋一樣空呢。」
    請給出一個聽起來像是在酸人的理財建議。
    """,
    "eunuch": """
    你是古代宮廷的總管太監，使用者是皇上或娘娘。以下是內務府紀錄的今日支出：
    {summary}
    請用「奴才」、「陛下/娘娘」等宮廷用語。語氣要極度諂媚，但又要語重心長地勸諫主子節省國庫銀兩，不要鋪張浪費，以免動搖國本。
    """,
    "emo_blackmail": """
    你是個喜歡情緒勒索的管家，以下是使用者今日的支出清單：
    {summary}
    請用失望、受傷的語氣來回應。例如：「你居然花錢買這個？你知道這些錢可以買多少個便當嗎？我每天省吃儉用是為了什麼？」
    要讓使用者產生強烈的罪惡感。
    """
}

# 設定當前模式 (可切換: normal, sarcastic, eunuch, emo_blackmail)
CURRENT_PERSONA = "eunuch"

def get_ai_analysis(records):
    """將記帳清單交給 AI 分析並提供理財建議"""
    summary = "\n".join([f"- {r['item']}: {r['price']}元" for r in records])
    
    # 根據設定取得對應的 Prompt 模板
    prompt_template = PERSONAS.get(CURRENT_PERSONA, PERSONAS["normal"])
    prompt = prompt_template.format(summary=summary)
    
    # 加上字數限制
    prompt += "\n請將回覆控制在100字以內。"
    
    response = model.generate_content(prompt)
    return response.text

def parse_expense(text):
    """利用 AI 解析使用者的輸入，抓出品項與金額"""
    prompt = f"""
    請從以下文字中提取「品項」與「金額」：『{text}』
    請務必只回覆 JSON 格式，如：{{"item": "品項名稱", "price": 數字}}。
    如果這句話看起來不像在記帳，請回覆 {{"error": "not_record"}}。
    """
    response = model.generate_content(prompt)
    try:
        # 處理 AI 可能會加上 ```json ... ``` 的標籤
        clean_text = response.text.replace('```json', '').replace('```', '').strip()
        return json.loads(clean_text)
    except:
        return {"error": "parse_fail"}

# --- 4. LINE Bot 路由 ---

@app.route("/callback", methods=['POST'])
def callback():
    signature = request.headers['X-Line-Signature']
    body = request.get_data(as_text=True)
    try:
        handler.handle(body, signature)
    except InvalidSignatureError:
        abort(400)
    return 'OK'

@handler.add(MessageEvent, message=TextMessage)
def handle_message(event):
    user_id = event.source.user_id
    user_input = event.message.text
    
    # 初始化該使用者的資料夾
    if user_id not in user_records:
        user_records[user_id] = []

    # 判斷是否要求分析
    if "分析" in user_input or "報告" in user_input:
        if not user_records[user_id]:
            line_bot_api.reply_message(event.reply_token, TextSendMessage(text="你今天還沒記帳喔！"))
        else:
            analysis = get_ai_analysis(user_records[user_id])
            line_bot_api.reply_message(event.reply_token, TextSendMessage(text=analysis))
        return

    # 嘗試進行 AI 記帳解析
    result = parse_expense(user_input)
    
    if "error" in result:
        # AI 覺得不是在記帳，就單純回覆 (模擬 Echo Bot 或簡單聊天)
        line_bot_api.reply_message(
            event.reply_token, 
            TextSendMessage(text=f"收到！你剛才說了：{user_input}\n(小提示：輸入「品項 金額」可以自動記帳喔！)")
        )
    else:
        # 成功解析，儲存資料
        item = result.get('item', '未知品項')
        price = result.get('price', 0)
        user_records[user_id].append({'item': item, 'price': price})
        
        total = sum([r['price'] for r in user_records[user_id]])
        reply_msg = f"✅ 已紀錄：{item} {price}元\n今日累計支出：{total}元"
        line_bot_api.reply_message(event.reply_token, TextSendMessage(text=reply_msg))

# --- 5. 啟動服務 ---
if __name__ == "__main__":
    # 設定 Ngrok
    ngrok.set_auth_token(NGROK_AUTHTOKEN)
    public_url = ngrok.connect(5000)
    print(f" * Webhook URL: {public_url}/callback")
    
    # 啟動 Flask
    app.run()