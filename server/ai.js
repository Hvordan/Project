// server/ai.js —генерация колоды и обложки с помощью гемини и так же должно автоматически менять модель 

const clean = (name) => String(name).trim().replace(/^models\//, "");
const MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.8-flash",
  ...(process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash,gemini-3.1-flash-lite").split(","),
]
  .map(clean)
  .filter((name, i, all) => name && all.indexOf(name) === i);
const WORDS_PER_DECK = 48;

// один запрос на гемини и изменение модели если она не ответила
async function callGemini(payload, { timeout = 35000 } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY не задано");
  const body = JSON.stringify(payload);
  let lastError;
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          signal: AbortSignal.timeout(timeout),
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          body,
        },
      );
      if (!res.ok) {
        throw new Error(`Gemini повернув ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      return JSON.parse(text);
    } catch (err) {
      lastError = new Error(`${model}: ${err.message}`);
      console.error("Генерація, пробуємо іншу модель:", lastError.message);
    }
  }
  throw lastError || new Error("Жодна модель не відповіла");
}

// улучшенный запрос слов, чтобы колода было узко привязано к теме
// (была: простая просьба «дай 48 разных украинских существительных по этой теме»).
// изменил 1) модель сначала называет подгруппы темы (поле categories) и распределяет слова между ними;
// 2) запрещены общие слова, которые подошли бы к какой-либо теме; 3) нужны узнаваемые для темы
// имена, названия и термины; 4) запрет придумывать несуществующие названия; 5) propertyOrdering заставляет модель
// сначала составить подгруппы, а потом слова.
const WORDS_THINKING = process.env.GEMINI_WORDS_THINKING || "low"; // тут в теории можно поменять на medium если нужна более точная генерация 

function wordsPayload(topic) {
  return {
    systemInstruction: {
      parts: [
        {
          text:
            "Ти укладач тематичних колод слів для гри на асоціації (на кшталт «Codenames»). " +
            "Твоя головна якість — точність: кожне слово має належати саме до заданої теми, " +
            "а не до загальних понять поруч із нею. Відповідай лише JSON.",
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Тема: "${topic}".\n` +
              `Склади колоду з рівно ${WORDS_PER_DECK} слів, які ВУЗЬКО й точно стосуються цієї теми.\n` +
              `Спершу в полі categories назви від 5 до 8 підгруп цієї теми ` +
              `(для франшизи, гри чи книги: персонажі, місця, предмети, здібності чи заклинання, істоти, події тощо; ` +
              `для загальної теми — її природні підгрупи). ` +
              `Потім розподіли слова між цими підгрупами приблизно порівну.\n` +
              `Правила для слів:\n` +
              `1. Кожне слово має бути впізнаваним саме для цієї теми: власні назви, імена, терміни, предмети, місця, ` +
              `істоти, події. Не додавай загальні слова, що підійшли б до будь-якої теми (на кшталт «магія», «історія», ` +
              `«світ», «сила»), якщо вони не є візитівкою цієї теми.\n` +
              `2. Кожне слово — одне слово без пробілів і без символу "|". Якщо назва складається з кількох слів, ` +
              `бери найвпізнаваніше з них (наприклад, прізвище).\n` +
              `3. Пиши українською; для імен і назв використовуй усталений український варіант, а якщо його немає — ` +
              `залиш оригінальну назву.\n` +
              `4. Слова мають бути різними й не схожими між собою: без синонімів і без форм одного слова. ` +
              `Не повторюй саму назву теми.\n` +
              `5. Не вигадуй неіснуючих імен чи термінів: використовуй лише те, у чому ти впевнений.\n` +
              `6. До кожного слова додай один емодзі, який підходить саме до цього слова.`,
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 8000,
      thinkingConfig: { thinkingLevel: WORDS_THINKING },
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          categories: { type: "ARRAY", items: { type: "STRING" } }, // подгруппы 
          title: { type: "STRING" },
          description: { type: "STRING" },
          words: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { word: { type: "STRING" }, icon: { type: "STRING" } },
              required: ["word", "icon"],
            },
          },
        },
        required: ["categories", "title", "description", "words"],
        propertyOrdering: ["categories", "title", "description", "words"], // генерирует подгруппу а потом слова для точности 
      },
    },
  };
}


function coverPayload(topic) {
  return {
    systemInstruction: {
      parts: [{ text: "Ти художник-ілюстратор плоских іконок. Відповідай лише JSON." }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Тема гри: "${topic}". Обери ОДИН найвпізнаваніший символ цієї теми ` +
              `(наприклад: Гаррі Поттер — шрам-блискавка або чарівна паличка; Elden Ring — розбите кільце; ` +
              `море — хвиля) і намалюй його як просту плоску іконку.\n` +
              `Правила: система координат 64x64, символ по центру і займає більшу частину поля; ` +
              `від 1 до 4 фігур; кожна фігура — SVG path (атрибут d). ` +
              `Команди лише M, L, H, V, C, Q, A, Z і числа. ` +
              `Для кожної фігури вкажи stroke: false — суцільний силует, ` +
              `або stroke: true — лінія завтовшки 4 (для кілець, дуг, паличок, блискавок). ` +
              `Іконка має бути простою, впізнаваною, без дрібних деталей.\n` +
              `Приклад формату (не копіюй, це лише формат): ` +
              `{"symbol":"зірка","shapes":[{"d":"M32 6 L38 26 L58 32 L38 38 L32 58 L26 38 L6 32 L26 26 Z","stroke":false}]}`,
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 4000,
      thinkingConfig: { thinkingLevel: "medium" },
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          symbol: { type: "STRING" },
          shapes: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { d: { type: "STRING" }, stroke: { type: "BOOLEAN" } },
              required: ["d", "stroke"],
            },
          },
        },
        required: ["symbol", "shapes"],
      },
    },
  };
}

// если обложка не сгенерирована будет одна из трех базовых 
function drawCover(topic) {
  let timer;
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => resolve(undefined), 45000);
  });
  const draw = callGemini(coverPayload(topic), { timeout: 30000 })
    .then((result) =>
      (Array.isArray(result.shapes) ? result.shapes : [])
        .slice(0, 4)
        .map((s) => ({ d: String(s?.d || ""), s: s?.stroke === true })),
    )
    .catch((err) => {
      console.error("Обкладинка колоди:", err.message);
      return undefined;
    });
  return Promise.race([draw, limit]).finally(() => clearTimeout(timer));
}

export async function generateDeck(theme) {
  const topic = String(theme || "").trim().slice(0, 60);
  if (!topic) throw new Error("Порожня тема");

  // слова и обложка создаются одновременно 
  const [parsed, cover] = await Promise.all([callGemini(wordsPayload(topic)), drawCover(topic)]);

  const seen = new Set();
  const words = [];
  for (const item of parsed.words || []) {
    const word = String(item.word || "").trim();
    const icon = String(item.icon || "").trim();
    const key = word.toLowerCase();
    
    if (!word || !icon || word.length > 28 || /[\s|]/u.test(word) || seen.has(key) || key === topic.toLowerCase()) continue;
    seen.add(key);
    words.push({ word, icon });
  }
  if (words.length < 30) throw new Error("Gemini повернув замало слів");

  return {
    id: "ai-" + Date.now().toString(36),
    title: String(parsed.title || topic).slice(0, 40),
    description: String(parsed.description || "").slice(0, 120),
    cover, 
    words: words.slice(0, WORDS_PER_DECK),
  };
}
