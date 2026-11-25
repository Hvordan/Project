
import express from "express";
import { createServer } from "node:http";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { builtins } from "./decks.js";
import { openStore } from "./store.js";
import { generateDeck } from "./ai.js"; // ии колоды 
import {
  applyAction,
  backToLobby,
  expireTurn,
  newRoom,
  normalize,
  requireRule,
  roomView,
  shortText,
} from "./game.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const publicFolder = fileURLToPath(new URL("../public", import.meta.url));
function ownerHash(key) {
  requireRule(typeof key === "string" && /^[a-f0-9]{64}$/u.test(key), "Потрібен ключ цього браузера.");
  return digest(key);
}
function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join("");
}
export function createGameServer(filename) {
  const app = express();
  const http = createServer(app);
  const io = new Server(http, { maxHttpBufferSize: 16_384 });
  const store = openStore(filename);
  const members = new Map(); // Room code → player id → currently connected socket.
  const lastGenerated = new Map(); // время генерации 
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/decks", (req, res) => res.json(store.decks(ownerHash(req.get("X-Deck-Key")))));
  app.post("/api/decks", (req, res) =>
    res.status(201).json(store.writeDeck(null, ownerHash(req.get("X-Deck-Key")), req.body || {})),
  );
  // создание тематических колод через ии
  app.post("/api/decks/generate", async (req, res, next) => {
    try {
      const owner = ownerHash(req.get("X-Deck-Key"));
      const theme = shortText(req.body?.theme, 60, "Введи тему від 1 до 60 символів.");
      const last = lastGenerated.get(owner) || 0;
      requireRule(Date.now() - last > 30_000, "Зачекай пів хвилини перед наступною генерацією.");
      lastGenerated.set(owner, Date.now());
      let deck;
      try {
        deck = await generateDeck(theme);
      } catch (err) {
        console.error("Генерація колоди:", err.message);
        throw new Error("Не вдалося створити колоду. Спробуй іншу тему або пізніше.");
      }
      res.status(201).json(store.writeDeck(null, owner, deck));
    } catch (err) {
      next(err);
    }
  });
  
  // зашерить колоду со всеми 
  app.post("/api/decks/:id/share", (req, res) => {
    store.shareDeck(req.params.id, ownerHash(req.get("X-Deck-Key")), req.body?.shared);
    res.sendStatus(204);
  });
 
  app.put("/api/decks/:id", (req, res) =>
    res.json(store.writeDeck(req.params.id, ownerHash(req.get("X-Deck-Key")), req.body || {})),
  );
  app.delete("/api/decks/:id", (req, res) => {
    store.deleteDeck(req.params.id, ownerHash(req.get("X-Deck-Key")));
    res.sendStatus(204);
  });
  app.use(express.static(publicFolder));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(400).json({ error: err.message });
  });
  function broadcast(room) {
    const sockets = members.get(room.code);
    if (!sockets) return;
    for (const p of room.players) sockets.get(p.id)?.emit("state", roomView(room, p, sockets));
  }
  function detach(socket) {
    const identity = socket.data.identity;
    if (!identity) return;
    const sockets = members.get(identity.code);
    if (sockets?.get(identity.id) === socket) {
      sockets.delete(identity.id);
      if (!sockets.size) members.delete(identity.code);
      const room = store.room(identity.code);
      if (room) broadcast(room);
    }
    delete socket.data.identity;
  }
  function attach(socket, room, player, key) {
    const sockets = members.get(room.code) || new Map();
    const previous = sockets.get(player.id);
    if (previous && previous !== socket) {
      delete previous.data.identity;
      previous.emit("replaced");
    }
    sockets.set(player.id, socket);
    members.set(room.code, sockets);
    socket.data.identity = { code: room.code, id: player.id, owner: key };
    if (expireTurn(room)) store.save(room);
    broadcast(room);
  }
  io.on("connection", (socket) => {
    function on(name, handler) {
      socket.on(name, (payload, reply) => {
        if (typeof reply !== "function") return;
        try {
          reply({ ok: true, ...handler(payload || {}) });
        } catch (err) {
          reply({ ok: false, error: err.message });
        }
      });
    }
    function enroll(payload, creating) {
      requireRule(!socket.data.identity, "Спочатку вийди з поточної кімнати.");
      const key = ownerHash(payload.key);
      const name = shortText(payload.name, 22, "Введи ім’я від 1 до 22 символів.");
      const token = randomBytes(32).toString("hex");
      const player = { id: randomUUID(), name, team: null, role: null, tokenHash: digest(token) };
      let room;
      if (creating) {
        let code;
        do {
          code = roomCode();
        } while (store.room(code));
        room = newRoom(code, player, builtins[0]);
      } else {
        room = store.room(shortText(payload.code, 5, "Перевір код кімнати.").toUpperCase());
        requireRule(room, "Кімнату за цим кодом не знайдено.");
        requireRule(
          room.stage === "lobby",
          "Партія вже почалася. Нові учасники можуть приєднатися в лобі.",
        );
        requireRule(room.players.length < 12, "У кімнаті вже 12 гравців.");
        requireRule(
          !room.players.some((p) => normalize(p.name) === normalize(name)),
          "Це ім’я в кімнаті вже зайняте.",
        );
        room.players.push(player);
      }
      store.save(room);
      attach(socket, room, player, key);
      return { code: room.code, token };
    }
    on("createRoom", (payload) => enroll(payload, true));
    on("joinRoom", (payload) => enroll(payload, false));
    on("resume", (payload) => {
      requireRule(!socket.data.identity, "Кімнату вже відкрито.");
      const key = ownerHash(payload.key);
      const room = store.room(shortText(payload.code, 5, "Кімнату не знайдено."));
      requireRule(
        typeof payload.token === "string" && /^[a-f0-9]{64}$/u.test(payload.token),
        "Сесію не знайдено.",
      );
      const player = room?.players.find((p) => p.tokenHash === digest(payload.token));
      requireRule(player, "Твоє місце в кімнаті більше недоступне.");
      attach(socket, room, player, key);
    });
    on("action", (action) => {
      const ident = socket.data.identity;
      requireRule(ident, "Спочатку приєднайся до кімнати.");
      const room = store.room(ident.code);
      const player = room?.players.find((p) => p.id === ident.id);
      requireRule(player, "Гравця не знайдено.");
      if (expireTurn(room)) {
        store.save(room);
        broadcast(room);
      }
      if (action.type === "leave") {
        const played = room.stage === "playing" && player.team;
        room.players = room.players.filter((p) => p.id !== player.id);
        if (played) backToLobby(room);
        if (room.host === player.id && room.players.length)
          room.host = (
            room.players.find((p) => members.get(room.code)?.has(p.id)) || room.players[0]
          ).id;
        if (room.players.length) store.save(room);
        else store.remove(room.code);
        detach(socket);
        if (played)
          for (const peer of members.get(room.code)?.values() || [])
            peer.emit("notice", "Гравець покинув партію. Кімната повернулася до лобі.");
        return;
      }
      applyAction(room, player, action, {
        online: members.get(room.code),
        getDeck: (id) => store.deckFor(id, ident.owner, room.deck),
      });
      store.save(room);
      broadcast(room);
    });
    socket.on("disconnect", () => detach(socket));
  });
  const clock = setInterval(() => {
    for (const code of members.keys()) {
      const room = store.room(code);
      if (room && expireTurn(room)) {
        store.save(room);
        broadcast(room);
      }
    }
  }, 1000);
  clock.unref();
  return {
    http,
    close() {
      clearInterval(clock);
      return new Promise((resolve) =>
        io.close(() => {
          store.close();
          resolve();
        }),
      );
    },
  };
}
