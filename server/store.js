import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { builtins } from "./decks.js";
import { normalize, requireRule, shortText } from "./game.js";

export function openStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS rooms(code TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS decks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS deck_owner ON decks(owner);`);
  const selectRoom = db.prepare("SELECT state FROM rooms WHERE code=?");
  const putRoom = db.prepare("INSERT OR REPLACE INTO rooms VALUES (?,?)");
  function deckFor(id, owner, selectedDeck) {
    const standard = builtins.find((d) => d.id === id);
    if (standard) return standard;
    requireRule(typeof id === "string", "Не вдалося знайти колоду.");
    const row = db.prepare("SELECT state FROM decks WHERE id=? AND owner=?").get(id, owner);
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
    decks(owner) {
      const custom = db
        .prepare("SELECT state FROM decks WHERE owner=? ORDER BY rowid DESC")
        .all(owner)
        .map((row) => ({ ...JSON.parse(row.state), custom: true }));
      return [...builtins, ...custom];
    },
    writeDeck(id, owner, body) {
      const title = shortText(body.title, 45, "Назва має містити від 1 до 45 символів.");
      requireRule(
        Array.isArray(body.words) && body.words.length >= 25 && body.words.length <= 160,
        "Потрібно від 25 до 160 різних слів.",
      );
      const words = body.words.map((w) => ({
        word: shortText(w, 28, "Кожна картка має містити від 1 до 28 символів."),
        icon: "✧",
      }));
      requireRule(
        new Set(words.map((w) => normalize(w.word))).size === words.length,
        "Прибери повтори в колоді.",
      );
      const deck = { id: id || randomUUID(), title, description: "Авторська колода", words };
      if (id) {
        const result = db
          .prepare("UPDATE decks SET state=? WHERE id=? AND owner=?")
          .run(JSON.stringify(deck), id, owner);
        requireRule(result.changes, "Авторську колоду не знайдено.");
      } else {
        db.prepare("INSERT INTO decks VALUES (?,?,?)").run(deck.id, owner, JSON.stringify(deck));
      }
      return { ...deck, custom: true };
    },
    deleteDeck(id, owner) {
      const result = db.prepare("DELETE FROM decks WHERE id=? AND owner=?").run(id, owner);
      requireRule(result.changes, "Авторську колоду не знайдено.");
    },
  };
}
