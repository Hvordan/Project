
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { builtins } from "./decks.js";
import { normalize, requireRule, shortText } from "./game.js";

// проверка значка обложки
const coverPath = /^[Mm][MmLlHhVvCcSsQqTtAaZz0-9\s.,+-]{2,699}$/u;
function cleanCover(value) {
  if (!Array.isArray(value)) return undefined;
  const shapes = [];
  for (const item of value) {
    const d = typeof item === "string" ? item : item?.d;
    if (typeof d !== "string" || !coverPath.test(d.trim())) continue;
    
    shapes.push({ d: d.trim(), s: typeof item === "object" && item.s === true });
    if (shapes.length === 4) break;
  }
  return shapes.length ? shapes : undefined;
}

const MAX_SHARED_PER_OWNER = 10; // сколько колод один браузер может открыть 
const MAX_SHARED_LISTED = 100; // сколько чужих колод отображаются 


export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS decks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS deck_owner ON decks(owner);`);
  
  if (!db.prepare("PRAGMA table_info(decks)").all().some((c) => c.name === "shared"))
    db.exec("ALTER TABLE decks ADD COLUMN shared INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE INDEX IF NOT EXISTS deck_shared ON decks(shared)");
 
  const selectRoom = db.prepare("SELECT state FROM rooms WHERE code=?");
  const putRoom = db.prepare("INSERT OR REPLACE INTO rooms VALUES (?,?)");
  function deckFor(id, owner, selectedDeck) {
    const standard = builtins.find((d) => d.id === id);
    if (standard) return standard;
    requireRule(typeof id === "string", "Не вдалося знайти колоду.");
    // доступна собственная колода или общая 
    const row = db
      .prepare("SELECT state FROM decks WHERE id=? AND (owner=? OR shared=1)")
      .get(id, owner);
    if (!row && selectedDeck?.id === id) return selectedDeck;
    requireRule(row, "Ця колода недоступна.");
    return JSON.parse(row.state);
  }
  return {
    room(code) {
      const row = selectRoom.get(code);
      return row ? JSON.parse(row.state) : null;
    },
    save(room) {
      putRoom.run(room.code, JSON.stringify(room));
    },
    remove(code) {
      db.prepare("DELETE FROM rooms WHERE code=?").run(code);
    },
    close() {
      db.close();
    },
    deckFor,
    //  возвращает свои колоды и колоды других людей помоимо встроиных 
    // были только встроеные и собственые (SELECT state FROM decks WHERE owner=?)
    decks(owner) {
      const own = db
        .prepare("SELECT state, shared FROM decks WHERE owner=? ORDER BY rowid DESC")
        .all(owner)
        .map((row) => ({ ...JSON.parse(row.state), custom: true, shared: Number(row.shared) === 1 }));
      // колоды от других людей
      const others = db
        .prepare("SELECT state FROM decks WHERE shared=1 AND owner<>? ORDER BY rowid DESC LIMIT ?")
        .all(owner, MAX_SHARED_LISTED)
        .map((row) => ({ ...JSON.parse(row.state), shared: true }));
      return [...builtins, ...own, ...others];
    },
    writeDeck(id, owner, body) {
      const title = shortText(body.title, 45, "Назва має містити від 1 до 45 символів.");
      requireRule(
        Array.isArray(body.words) && body.words.length >= 25 && body.words.length <= 160,
        "Потрібно від 25 до 160 різних слів.",
      );
      // слово может быть рядом или обьектом 
      // было: word: shortText(w, 28, "..."), icon: "✧"
      const words = body.words.map((w) => ({
        word: shortText(
          typeof w === "string" ? w : w?.word,
          28,
          "Кожна картка має містити від 1 до 28 символів.",
        ),
        icon:
          typeof w?.icon === "string" && w.icon.trim() && w.icon.length <= 8
            ? w.icon.trim()
            : "✧",
      }));
      requireRule(
        new Set(words.map((w) => normalize(w.word))).size === words.length,
        "Прибери повтори в колоді.",
      );
      // описание колоды 
      const description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim().slice(0, 120)
          : "Авторська колода";
      // обложка колоды 
      let cover = cleanCover(body.cover);
      if (id && body.cover === undefined) {
        const old = db.prepare("SELECT state FROM decks WHERE id=? AND owner=?").get(id, owner);
        if (old) cover = cleanCover(JSON.parse(old.state).cover);
      }
      
      // должно добавляться отображение что колода кастомная 
      const deck = { id: id || randomUUID(), title, description, words, ...(cover ? { cover } : {}) };
      if (id) {
        const result = db
          .prepare("UPDATE decks SET state=? WHERE id=? AND owner=?")
          .run(JSON.stringify(deck), id, owner);
        requireRule(result.changes, "Авторську колоду не знайдено.");
      } else {
        
        db.prepare("INSERT INTO decks(id, owner, state) VALUES (?,?,?)").run(
          deck.id,
          owner,
          JSON.stringify(deck),
        );
      }
      
      const row = db.prepare("SELECT shared FROM decks WHERE id=?").get(deck.id);
      return { ...deck, custom: true, shared: Number(row?.shared) === 1 };
    },
//возможность делится колодами
    shareDeck(id, owner, shared) {
      requireRule(typeof shared === "boolean", "Некоректний запит.");
      if (shared) {
        const { n } = db
          .prepare("SELECT COUNT(*) AS n FROM decks WHERE owner=? AND shared=1 AND id<>?")
          .get(owner, String(id));
        requireRule(
          Number(n) < MAX_SHARED_PER_OWNER,
          "Можна поділитися не більше ніж " + MAX_SHARED_PER_OWNER + " колодами.",
        );
      }
      const result = db
        .prepare("UPDATE decks SET shared=? WHERE id=? AND owner=?")
        .run(shared ? 1 : 0, String(id), owner);
      requireRule(result.changes, "Авторську колоду не знайдено.");
    },
   
    deleteDeck(id, owner) {
      const result = db.prepare("DELETE FROM decks WHERE id=? AND owner=?").run(id, owner);
      requireRule(result.changes, "Авторську колоду не знайдено.");
    },
  };
}
