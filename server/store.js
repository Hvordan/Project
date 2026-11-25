
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { builtins } from "./decks.js";
import { normalize, requireRule, shortText } from "./game.js";
import { remoteEnabled, remoteInit, remoteAll, remoteSave, remoteSaveMany, remoteDelete } from "./remote.js"; // сранение колод

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

const MAX_SHARED_PER_OWNER = 10; // сколько колод один браузер может открыть для всех 
const MAX_LIBRARY_PAGE = 60; // сколько колод библеотеки показывать за раз 
const MAX_OWN_DECKS = 50; // сколько колод может иметь один браузер 

//  зеркало колод в Turso. Локальная SQLite остается рабочей копией, а после каждой смены колоды
// в фоне сохраняется еще и у Turso. После перезапуска сервера (когда диск Render стирается) restore()
// возвращает колоду из Turso назад. Изменения идут поочередно, чтобы старше не затерла более новую.
let mirrorQueue = Promise.resolve();
function mirror(task) {
  if (!remoteEnabled()) return;
  mirrorQueue = mirrorQueue
    .then(task)
    .catch((err) => console.error("Збереження колод у Turso:", err.message));
}


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
  // отпралвение актуального состояния колоды
  function pushDeck(id) {
    mirror(() => {
      const row = db.prepare("SELECT id, owner, state, shared FROM decks WHERE id=?").get(id);
      return row ? remoteSave(row) : remoteDelete(id);
    });
  }
  function deckFor(id, owner, selectedDeck) {
    const standard = builtins.find((d) => d.id === id);
    if (standard) return standard;
    requireRule(typeof id === "string", "Не вдалося знайти колоду.");
    
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
    // востановление колож из турсо 
    async restore() {
      if (!remoteEnabled()) return null;
      await remoteInit();
      const remote = await remoteAll();
      const remoteIds = new Set(remote.map((r) => r.id));
      const put = db.prepare("INSERT OR REPLACE INTO decks(id, owner, state, shared) VALUES (?,?,?,?)");
      for (const r of remote) put.run(r.id, r.owner, r.state, r.shared);
      const localOnly = db
        .prepare("SELECT id, owner, state, shared FROM decks")
        .all()
        .filter((r) => !remoteIds.has(r.id));
      if (localOnly.length) await remoteSaveMany(localOnly);
      return { restored: remote.length, uploaded: localOnly.length };
    },
    // подождаь пока все колоды сохраняться 
    flush() {
      return mirrorQueue;
    },
    
    decks(owner) {
      const own = db
        .prepare("SELECT state, shared FROM decks WHERE owner=? ORDER BY rowid DESC")
        .all(owner)
        .map((row) => ({ ...JSON.parse(row.state), custom: true, shared: Number(row.shared) === 1 }));
      return [...builtins, ...own];
    },
    // библиотека колод от  других людей
    library(owner, query = "") {
      const q = String(query || "").trim().toLowerCase().slice(0, 60);
      const saved = new Set(
        db
          .prepare("SELECT state FROM decks WHERE owner=?")
          .all(owner)
          .map((row) => JSON.parse(row.state).from)
          .filter(Boolean),
      );
      return db
        .prepare("SELECT state FROM decks WHERE shared=1 AND owner<>? ORDER BY rowid DESC LIMIT 200")
        .all(owner)
        .map((row) => JSON.parse(row.state))
        .filter(
          (d) =>
            !q ||
            String(d.title).toLowerCase().includes(q) ||
            String(d.description || "").toLowerCase().includes(q),
        )
        .slice(0, MAX_LIBRARY_PAGE)
        .map((d) => ({ ...d, saved: saved.has(d.id) }));
    },
    // добавление колоды из библиотеки 
    saveFromLibrary(id, owner) {
      const source = db
        .prepare("SELECT state FROM decks WHERE id=? AND shared=1 AND owner<>?")
        .get(String(id), owner);
      requireRule(source, "Цієї колоди немає в бібліотеці.");
      const own = db
        .prepare("SELECT state FROM decks WHERE owner=?")
        .all(owner)
        .map((row) => JSON.parse(row.state));
      requireRule(!own.some((d) => d.from === String(id)), "Ця колода вже є у твоїх.");
      requireRule(own.length < MAX_OWN_DECKS, "Можна мати не більше " + MAX_OWN_DECKS + " колод.");
      const original = JSON.parse(source.state);
      const copy = { ...original, id: randomUUID(), from: original.id };
      db.prepare("INSERT INTO decks(id, owner, state) VALUES (?,?,?)").run(
        copy.id,
        owner,
        JSON.stringify(copy),
      );
      pushDeck(copy.id);
      return { ...copy, custom: true, shared: false };
    },
    
    writeDeck(id, owner, body) {
      const title = shortText(body.title, 45, "Назва має містити від 1 до 45 символів.");
      requireRule(
        Array.isArray(body.words) && body.words.length >= 25 && body.words.length <= 160,
        "Потрібно від 25 до 160 різних слів.",
      );
      // слово может быть рядом и объектом 
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
     
      const description =
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim().slice(0, 120)
          : "Авторська колода";
      
      const oldRow = id
        ? db.prepare("SELECT state FROM decks WHERE id=? AND owner=?").get(id, owner)
        : null;
      const old = oldRow ? JSON.parse(oldRow.state) : null;
      const cover = body.cover === undefined ? cleanCover(old?.cover) : cleanCover(body.cover);
      // лимит колод на один браузер
      if (!id) {
        const { n } = db.prepare("SELECT COUNT(*) AS n FROM decks WHERE owner=?").get(owner);
        requireRule(Number(n) < MAX_OWN_DECKS, "Можна мати не більше " + MAX_OWN_DECKS + " колод.");
      }
      
      
      const deck = {
        id: id || randomUUID(),
        title,
        description,
        words,
        ...(cover ? { cover } : {}),
        ...(old?.from ? { from: old.from } : {}),
      };
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
      pushDeck(deck.id); // сохранить колоду и в turso
      
      const row = db.prepare("SELECT shared FROM decks WHERE id=?").get(deck.id);
      return { ...deck, custom: true, shared: Number(row?.shared) === 1 };
    },
    // открыть колоду для всех
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
      pushDeck(String(id)); // сохраниеть изминения в turso
    },
  
    deleteDeck(id, owner) {
      const result = db.prepare("DELETE FROM decks WHERE id=? AND owner=?").run(id, owner);
      requireRule(result.changes, "Авторську колоду не знайдено.");
      pushDeck(id); // удаление колоды из turso
    },
  };
}
