// server/ai.js —генерация колоды с помощью гемини и так же должно автоматически менять модель 
const clean = (name) => String(name).trim().replace(/^models\//, "");
const MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.8-flash",
  ...(process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash,gemini-3.1-flash-lite").split(","),
]
  .map(clean)
  .filter((name, i, all) => name && all.indexOf(name) === i);
const RETRY_STATUSES = [404, 429, 500, 503];
const WORDS_PER_DECK = 48;

export async function generateDeck(theme) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY не задано");

  const topic = String(theme || "").trim().slice(0, 60);
  if (!topic) throw new Error("Порожня тема");

  const body = JSON.stringify({
    systemInstruction: {
      parts: [{ text: "Ти створюєш колоди слів для гри. Відповідай лише JSON." }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Тема: "${topic}". Дай рівно ${WORDS_PER_DECK} різних українських іменників ` +
              `за цією темою. Кожне слово — одне слово без пробілів і без символу "|", ` +
              `до нього один емодзі.`,
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 8000,
      thinkingConfig: { thinkingLevel: "low" },
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          description: { type: "STRING" },
          words: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                word: { type: "STRING" },
                icon: { type: "STRING" },
              },
              required: ["word", "icon"],
            },
          },
        },
        required: ["title", "description", "words"],
      },
    },
  });

  let data;
  let lastError;
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          signal: AbortSignal.timeout(35000),
          headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
          body,
        },
      );
      if (res.ok) {
        data = await res.json();
        break;
      }
      lastError = new Error(
        `${model}: Gemini повернув ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
      if (!RETRY_STATUSES.includes(res.status)) throw lastError;
    } catch (err) {
      lastError = err;
      if (err.name !== "TimeoutError" && err.name !== "AbortError" && !String(err.message).includes("Gemini повернув")) {
        throw err;
      }
      console.error("Генерація колоди, пробуємо іншу модель:", err.message);
    }
  }
  if (!data) throw lastError || new Error("Жодна модель не відповіла");

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const parsed = JSON.parse(text);

  const seen = new Set();
  const words = [];
  for (const item of parsed.words || []) {
    const word = String(item.word || "").trim();
    const icon = String(item.icon || "").trim();
    const key = word.toLowerCase();
    if (!word || !icon || word.length > 28 || /[\s|]/u.test(word) || seen.has(key)) continue;
    seen.add(key);
    words.push({ word, icon });
  }
  if (words.length < 30) throw new Error("Gemini повернув замало слів");

  return {
    id: "ai-" + Date.now().toString(36),
    title: String(parsed.title || topic).slice(0, 40),
    description: String(parsed.description || "").slice(0, 120),
    words: words.slice(0, WORDS_PER_DECK),
  };
}
