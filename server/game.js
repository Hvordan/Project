import { randomInt, randomUUID } from "node:crypto";

export const teams = ["sun", "moon"];
export const powers = ["twilight", "fluttershy"];
export const teamNames = { sun: "Селестія", moon: "Луна" };
export const otherTeam = (team) => (team === "sun" ? "moon" : "sun");
export function requireRule(condition, message) {
  if (!condition) throw new Error(message);
}
export function normalize(word) {
  return word.normalize("NFC").toLocaleLowerCase("uk").replace(/[’ʼ]/gu, "'");
}
export function shortText(value, max, label) {
  requireRule(typeof value === "string", label);
  const text = value.trim().normalize("NFC");
  requireRule(text.length >= 1 && text.length <= max && !/[\p{Cc}]/u.test(text), label);
  return text;
}
function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
export function newRoom(code, creator, deck) {
  return {
    code,
    host: creator.id,
    players: [creator],
    stage: "lobby",
    deck,
    seconds: 90,
    powers: { sun: "twilight", moon: "fluttershy" },
    cards: [],
    turn: null,
    winner: null,
    reason: "",
    used: {},
    history: [],
    chat: [],
  };
}
function log(room, text) {
  room.history.push(text);
  if (room.history.length > 250) room.history.shift();
}
function startTurn(room, team, now) {
  room.turn = {
    id: randomUUID(),
    team,
    phase: "clue",
    clues: [],
    guesses: 0,
    deadline: now + room.seconds * 1000,
  };
  log(room, "Хід команди «" + teamNames[team] + "».");
}
export function expireTurn(room, now = Date.now()) {
  if (room.stage !== "playing" || now < room.turn.deadline) return false;
  log(room, "Час вичерпано.");
  startTurn(room, otherTeam(room.turn.team), now);
  return true;
}
export function remaining(room, team) {
  return room.cards.filter((c) => c.kind === team && !c.open).length;
}
function finish(room, winner, reason) {
  room.stage = "finished";
  room.winner = winner;
  room.reason = reason;
  log(room, "Перемога команди «" + teamNames[winner] + "». " + reason);
}
export function backToLobby(room) {
  Object.assign(room, {
    stage: "lobby",
    cards: [],
    turn: null,
    winner: null,
    reason: "",
    history: [],
    used: {},
  });
}
function startGame(room, online, now) {
  for (const team of teams) {
    for (const role of ["captain", "scout"]) {
      requireRule(
        room.players.some((p) => p.team === team && p.role === role && online.has(p.id)),
        "В обох командах мають бути онлайн капітан і хоча б один розвідник.",
      );
    }
  }
  const first = teams[randomInt(2)];
  const kinds = shuffled([
    ...Array(9).fill(first),
    ...Array(8).fill(otherTeam(first)),
    ...Array(7).fill("neutral"),
    "discord",
  ]);
  room.cards = shuffled(room.deck.words)
    .slice(0, 25)
    .map(({ word, icon }, i) => ({ word, icon, kind: kinds[i], open: false }));
  Object.assign(room, {
    stage: "playing",
    used: { sun: false, moon: false },
    history: [],
    winner: null,
    reason: "",
  });
  startTurn(room, first, now);
}
function readClue(room, raw) {
  const word = shortText(raw, 32, "Введи одне слово-підказку до 32 символів.");
  requireRule(/^[\p{L}]+(?:[-’ʼ'][\p{L}]+)*$/u.test(word), "Підказка має складатися з одного слова.");
  requireRule(!room.cards.some((c) => normalize(c.word) === normalize(word)), "Це слово вже є на полі.");
  return word;
}
export function applyAction(room, player, action, { online, now = Date.now(), getDeck }) {
  const { type } = action;
  if (type === "chat") {
    const text = shortText(action.text, 240, "Повідомлення має містити від 1 до 240 символів.");
    room.chat.push({ id: randomUUID(), name: player.name, text, team: player.team });
    if (room.chat.length > 80) room.chat.shift();
    return;
  }
  if (type === "claimHost") {
    requireRule(!online.has(room.host), "Ведучий зараз у кімнаті.");
    room.host = player.id;
    return;
  }
  if (type === "lobby") {
    requireRule(
      room.host === player.id && room.stage === "finished",
      "Повернутися до лобі може ведучий після гри.",
    );
    return backToLobby(room);
  }
  if (room.stage === "lobby") {
    switch (type) {
      case "seat":
        requireRule(
          teams.includes(action.team) && ["captain", "scout"].includes(action.role),
          "Обери команду й роль.",
        );
        requireRule(
          action.role !== "captain" ||
            !room.players.some(
              (p) => p.id !== player.id && p.team === action.team && p.role === "captain",
            ),
          "Ця команда вже має капітана.",
        );
        Object.assign(player, { team: action.team, role: action.role });
        return;
      case "power":
        requireRule(player.role === "captain" && powers.includes(action.power), "Магію обирає капітан.");
        room.powers[player.team] = action.power;
        return;
      case "settings":
        requireRule(player.id === room.host, "Налаштування змінює ведучий.");
        requireRule([45, 60, 90, 120, 180].includes(action.seconds), "Обери тривалість ходу зі списку.");
        room.deck = getDeck(action.deckId);
        room.seconds = action.seconds;
        return;
      case "start":
        requireRule(player.id === room.host, "Гру починає ведучий.");
        return startGame(room, online, now);
      default:
        throw new Error("Ця дія зараз недоступна.");
    }
  }
  requireRule(room.stage === "playing" && action.turnId === room.turn.id, "Хід уже завершився.");
  const turn = room.turn;
  requireRule(player.team === turn.team, "Зараз хід іншої команди.");
  const checkCaptain = () => requireRule(player.role === "captain", "Це дія капітана.");
  if (type === "clue") {
    checkCaptain();
    requireRule(turn.phase === "clue", "Підказку вже задано.");
    const word = readClue(room, action.word);
    requireRule(
      Number.isInteger(action.count) &&
        action.count >= 1 &&
        action.count <= remaining(room, player.team),
      "Перевір кількість карток.",
    );
    turn.clues.push({ word, count: action.count });
    turn.phase = "guess";
    turn.guesses = action.count + 1;
    return log(room, player.name + ": «" + word + "» — " + action.count + ".");
  }
  if (type === "magic") {
    checkCaptain();
    requireRule(!room.used[player.team], "Команда вже використала магію в цій партії.");
    if (room.powers[player.team] === "twilight") {
      requireRule(turn.phase === "guess", "Спочатку дай основну підказку.");
      const word = readClue(room, action.word);
      requireRule(
        !turn.clues.some((c) => normalize(c.word) === normalize(word)),
        "Додаткова підказка має бути іншою.",
      );
      turn.clues.push({ word });
      log(room, "Твайлайт додає підказку «" + word + "».");
    } else {
      const neutral = room.cards.filter((c) => !c.open && c.kind === "neutral");
      requireRule(neutral.length, "Усі нейтральні картки вже відкрито.");
      const card = neutral[randomInt(neutral.length)];
      card.open = true;
      log(room, "Флаттершай відкриває нейтральну картку «" + card.word + "».");
    }
    room.used[player.team] = true;
    return;
  }
  requireRule(player.role === "scout" && turn.phase === "guess", "Зараз не час для відгадування.");
  if (type === "pass") return startTurn(room, otherTeam(player.team), now);
  requireRule(type === "guess" && Number.isInteger(action.index), "Обери картку.");
  const card = room.cards[action.index];
  requireRule(card && !card.open, "Ця картка недоступна.");
  card.open = true;
  log(room, player.name + " відкриває «" + card.word + "».");
  if (card.kind === "discord") return finish(room, otherTeam(player.team), "Відкрито картку Дискорда.");
  if (teams.includes(card.kind) && remaining(room, card.kind) === 0)
    return finish(room, card.kind, "Знайдено всі знаки команди.");
  turn.guesses--;
  if (card.kind !== player.team || turn.guesses === 0) startTurn(room, otherTeam(player.team), now);
}
export function roomView(room, player, online) {
  const { deck, players, cards, ...publicState } = room;
  return {
    ...publicState,
    serverNow: Date.now(),
    you: player.id,
    deck: { id: deck.id, title: deck.title, count: deck.words.length },
    players: players.map(({ id, name, team, role }) => ({
      id,
      name,
      team,
      role,
      online: online.has(id),
    })),
    remaining: { sun: remaining(room, "sun"), moon: remaining(room, "moon") },
    cards: cards.map(({ word, icon, kind, open }) => ({
      word,
      icon,
      open,
      kind: open || player.role === "captain" || room.stage === "finished" ? kind : null,
    })),
  };
}
