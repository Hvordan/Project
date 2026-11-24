// server/ai.js — генерация колоды с помощью gemini
const MODEL = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim().replace(/^models\//, "");
const WORDS_PER_DECK = 48;

export async function generateDeck(theme) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY не задано");

  const topic = String(theme || "").trim().slice(0, 60);
  if (!topic) throw new Error("Порожня тема");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "x-goog-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
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
        maxOutputTokens: 4000,
        thinkingConfig: { thinkingBudget: 0 },
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
    }),
  });

    if (!res.ok) throw new Error("Gemini повернув " + res.status + ": " + (await res.text()).slice(0, 300));
  const data = await res.json();
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
