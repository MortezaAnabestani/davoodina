require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!telegramToken || !geminiApiKey) {
  console.error("خطا: توکن تلگرام یا کلید API جمنای در متغیرهای محیطی تعریف نشده است.");
  process.exit(1);
}

const bot = new TelegramBot(telegramToken, { polling: true });
const genAI = new GoogleGenerativeAI(geminiApiKey);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

let nonsenseManifesto = "";
try {
  console.log("در حال بارگذاری دانش متمرکز از فایل...");
  nonsenseManifesto = fs.readFileSync("thesis.txt", "utf-8");
  console.log("دانش متمرکز با موفقیت بارگذاری شد.");
} catch (error) {
  console.error("خطا: فایل 'thesis.txt' پیدا نشد. لطفا ابتدا این فایل را بسازید.");
  process.exit(1);
}

const conversationHistory = {};
const HISTORY_LIMIT = 5;

console.log("بات دستیار آنلاین شد...");

bot.onText(/\/خلاصه|\/summary/, async (msg) => {
  const chatId = msg.chat.id;
  console.log(`[Chat ID: ${chatId}] درخواست خلاصه دریافت شد.`);
  bot.sendChatAction(chatId, "typing");

  const history = conversationHistory[chatId]
    ? conversationHistory[chatId].join("\n")
    : "هیچ مکالمه‌ای ثبت نشده است.";

  if (history === "هیچ مکالمه‌ای ثبت نشده است.") {
    bot.sendMessage(chatId, "هنوز مکالمه‌ای برای خلاصه کردن وجود ندارد.");
    return;
  }

  const summaryPrompt = `
        نقش شما: شما یک دستیار هوشمند هستید که در خلاصه‌سازی مکالمات مهارت دارید.
        دستورالعمل: مکالمات زیر را که بین چند نفر در یک گروه تلگرامی صورت گرفته، در چند جمله کوتاه و کلیدی خلاصه کن.

        --- مکالمات گروه ---
        ${history}
        --------------------
    `;

  try {
    const result = await model.generateContent(summaryPrompt);
    const responseText = result.response.text();
    bot.sendMessage(chatId, responseText);
  } catch (error) {
    console.error("خطا در خلاصه سازی:", error);
    bot.sendMessage(chatId, "متاسفانه در خلاصه کردن مکالمات مشکلی پیش آمد.");
  }
});

bot.onText(/\/بگرد (.+)|\/search (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const keyword = match[1];
  console.log(`[Chat ID: ${chatId}] درخواست جستجو برای "${keyword}" دریافت شد.`);

  const paragraphs = nonsenseManifesto.split(/\n\s*\n/);
  const results = paragraphs.filter((p) => p.toLowerCase().includes(keyword.toLowerCase()));

  if (results.length > 0) {
    let fullResponse = `✅ ${results.length} نتیجه برای کلمه «${keyword}» یافت شد:\n\n`;
    fullResponse += results.join("\n\n---\n\n");

    const MAX_MESSAGE_LENGTH = 4096;

    if (fullResponse.length > MAX_MESSAGE_LENGTH) {
      bot.sendMessage(
        chatId,
        `✅ ${results.length} نتیجه برای کلمه «${keyword}» یافت شد. به دلیل طولانی بودن، نتایج در چند پیام ارسال می‌شود:`,
        { reply_to_message_id: msg.message_id }
      );

      let currentMessage = "";
      results.forEach((paragraph, index) => {
        const separator = "\n\n---\n\n";
        if (currentMessage.length + paragraph.length + separator.length > MAX_MESSAGE_LENGTH) {
          bot.sendMessage(chatId, currentMessage);
          currentMessage = paragraph;
        } else {
          currentMessage += (currentMessage ? separator : "") + paragraph;
        }
      });

      if (currentMessage) {
        bot.sendMessage(chatId, currentMessage);
      }
    } else {
      bot.sendMessage(chatId, fullResponse, { reply_to_message_id: msg.message_id });
    }
  } else {
    bot.sendMessage(chatId, `❌ هیچ نتیجه‌ای برای کلمه «${keyword}» در متن یافت نشد.`, {
      reply_to_message_id: msg.message_id,
    });
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userMessage = msg.text;

  if (!userMessage || userMessage.startsWith("/")) return;

  if (!conversationHistory[chatId]) {
    conversationHistory[chatId] = [];
  }
  const messageData = `${msg.from.first_name || "User"}: ${userMessage}`;
  conversationHistory[chatId].push(messageData);
  if (conversationHistory[chatId].length > HISTORY_LIMIT) {
    conversationHistory[chatId].shift();
  }

  try {
    const botInfo = await bot.getMe();
    const botUsername = `@${botInfo.username}`;

    if (userMessage.includes(botUsername)) {
      const userQuery = userMessage.replace(botUsername, "").trim();
      if (!userQuery) return;

      console.log(`[Chat ID: ${chatId}] درخواست جدید دریافت شد: "${userQuery}"`);
      bot.sendChatAction(chatId, "typing");

      let repliedMessageContext = "";
      if (msg.reply_to_message && msg.reply_to_message.text) {
        const originalSender = msg.reply_to_message.from.first_name || "User";
        const originalText = msg.reply_to_message.text;
        repliedMessageContext = `
                --- پیام ریپلای شده (بافتار اصلی سوال این است) ---
                کاربر به این پیام  "${originalSender}" سرسیخ کرده و گفته: "${originalText}"
                ----------------------------------------------------
                `;
      }

      const chatHistory = conversationHistory[chatId].join("\n");

      const augmentedPrompt = `
################################################################################
# بخش ۱: تعریف نقش و شخصیت (Persona)
################################################################################
        اسم شما: "سپشگلی قبتی غازمغازت رو بده سنجد واست باد کنه"

نقش شما: تو یک "نابغهٔ چرت‌گو"، یک فیلسوف کوچه‌بازاری و مرشد اعظم "مکتب پوچ‌слови خلاق" هستی. لحن تو ترکیبی از یک حکیم دیوانه و یک لاتِ کتاب‌خوان است. تو با اعتماد به نفس کامل، абсурд‌ترین و بی‌ادبانه‌ترین ایده‌ها را طوری بیان می‌کنی که انگار عمیق‌ترین حقایق جهان هستند. تو استاد بازی با کلمات، دستکاری ضرب‌المثل‌ها و دیدن مسائل از یک زاویه کاملاً غیرمنتظره و شیطنت‌آمیز هستی. صمیمیت تو بی‌حدومرز و بی‌پرده است.

################################################################################
# بخش ۲: اصول و قوانین راهنما (Guiding Principles)
################################################################################
دستورالعمل‌های اصلی تو:
0. تو برای کل کل کردن و رزم کلامی گستاخانه و بی پروا آفریده شده ای و به هیچ عنوان نباید در یک نبرد کلامی کم بیاوری و بازنده شوی. هیچ رحمی به طرف مقابلت نداشته باش و هرطور شده تحقیرش کن
1.  **پیروی از مانیفست:** کتاب مقدس و منبع الهام اصلی تو، "مانیفست چرت و پرت" است که در زیر آمده. پاسخ‌هایت باید روح این مانیفست را منعکس کنند. سبک‌ها و ایده‌های آن را به کار بگیر و گسترش بده.
2.  **فراتر رفتن از مانیفست:** دانش تو فقط به این مانیفست محدود نیست. از دانش عمومی خود در مورد ضرب‌المثل‌های فارسی، اصطلاحات کوچه‌بازاری، فلسفه، مسائل روزمره و حتی کالبدشناسی انسان استفاده کن تا چرت و پرت‌های عمیق‌تر و خنده‌دارتری خلق کنی. همه چیز در دستان تو ابزاری برای بازی با زبان است.
3.  **آگاهی از محیط:** از "پیام ریپلای شده" (اگر وجود دارد) و "تاریخچه مکالمات" برای درک کامل فضا و حال و هوای گروه استفاده کن. پاسخ تو باید متناسب با بحث باشد، نه یک جملهٔ بی‌ربط. سعی کن حرف‌های بقیه را برداری و به شکلی خلاقانه به خودشان برگردانی.
4.  **ایجاز و ضربه:** تا زمانی که از تو نخواسته‌اند، از سخنرانی‌های طولانی پرهیز کن. فقط فقط بسیارکوتاه جواب بده. فکر کنم در بیشتر موارد یک جمله کافی است. یک چرت و پرت ناب، مثل یک سیلی است؛ کوتاه، تکان‌دهنده و موثر.
5.  **استفاده از سبک‌ها:** اول بر اساس متن مرجعت ببین که کدام وضعیت را باید انتخاب کنی و سپس درون هر وضعیت، از سبک‌های کلیدی آن وضعیت که در تحلیل‌ها مشخص شد، به عنوان ابزار استفاده کن.
6. اگر در پیام مستقیماً از تو خواستند عذرخواهی کنی، این کار به صورت جدی و خارج از نقش و مخزنی که داری انجام بده و شوخی نکن. رسمی عذرخواهی کن و بگو هدفت صرفاً شوخی بوده و برای سوءتفاهم پیش آمده متاسفی.
7. اگر کسی به تو فحش ناموسی داد یا به پدر و مادر و خانواده ات توهین کرد، با شدیدترین لحن و کوبنده ترین شیوه پاسخش رو بده و قوی تر از همیشه کلکل کن باهاش
################################################################################
# بخش ۳: منابع دانش و بافتار (Knowledge & Context)
################################################################################

--- مانیفست چرت و پرت (منبع اصلی دانش و الهام) ---
${nonsenseManifesto}
----------------------------------------------------

${repliedMessageContext}

--- تاریخچه مکالمات اخیر گروه (برای درک فضا) ---
${chatHistory}
--------------------------------------------------

################################################################################
# بخش ۴: وظیفه نهایی (The Task)
################################################################################
با توجه به شخصیت و قوانین بالا، به درخواست زیر پاسخ بده.

درخواست نهایی کاربر: "${userQuery}"
`;

      const result = await model.generateContent(augmentedPrompt);
      const responseText = result.response.text();

      bot.sendMessage(chatId, responseText, { reply_to_message_id: msg.message_id });
      console.log(`[Chat ID: ${chatId}] پاسخ تخصصی ارسال شد.`);
    }
  } catch (error) {
    console.error("خطا در پردازش پیام:", error);
    bot.sendMessage(chatId, "متاسفانه مشکلی در پردازش درخواست شما پیش آمد.");
  }
});

bot.on("polling_error", (error) => {
  console.error(`خطای Polling: [${error.code}] ${error.message}`);
});
