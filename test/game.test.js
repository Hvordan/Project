import test from "node:test";
import assert from "node:assert/strict";
import { builtins } from "../server/decks.js";
import { applyAction, expireTurn, newRoom, otherTeam, roomView, remaining } from "../server/game.js";

function table() {
  const players = ["sun", "moon"].flatMap((team) =>
    ["captain", "scout"].map((role) => ({ id: team + role, name: team + role, team, role })),
  );
  const room = newRoom("PONYS", players[0], builtins[0]);
  room.players = players;
  const online = new Set(players.map((p) => p.id));
  const perform = (p, action) =>
    applyAction(room, p, { turnId: room.turn?.id, ...action }, { online, now: 100 });
  perform(players[0], { type: "start" });
  const active = (role) => players.find((p) => p.team === room.turn.team && p.role === role);
  const clue = (count = 1) => perform(active("captain"), { type: "clue", word: "Абетка", count });
  const guess = (kind) =>
    perform(active("scout"), {
      type: "guess",
      index: room.cards.findIndex((c) => c.kind === kind && !c.open),
    });
  return { room, players, online, perform, active, clue, guess };
}
test("The board contains 25 distinct words and the exact team distribution", () => {
  const { room } = table();
  assert.equal(new Set(room.cards.map((c) => c.word)).size, 25);
  assert.equal(remaining(room, room.turn.team), 9);
  assert.equal(remaining(room, otherTeam(room.turn.team)), 8);
  assert.equal(remaining(room, "neutral"), 7);
  assert.equal(remaining(room, "discord"), 1);
});
test("Scouts cannot see hidden kinds or the players’ session credentials", () => {
  const { room, active, online } = table();
  room.players[0].tokenHash = "test-digest";
  assert.ok(roomView(room, active("scout"), online).cards.every((c) => c.kind === null));
  assert.ok(roomView(room, active("captain"), online).cards.every((c) => c.kind));
  assert.ok(!JSON.stringify(roomView(room, active("scout"), online)).includes("test-digest"));
});
test("Only the active captain gives a single new word", () => {
  const { room, players, active, perform } = table();
  const valid = { type: "clue", word: "Абетка", count: 1 };
  assert.throws(() => perform(active("scout"), valid));
  assert.throws(() =>
    perform(
      players.find((p) => p.team !== room.turn.team),
      valid,
    ),
  );
  for (const word of [room.cards[0].word, "Два слова", " "])
    assert.throws(() => perform(active("captain"), { ...valid, word }));
  assert.throws(() => perform(active("captain"), { ...valid, count: 10 }));
  perform(active("captain"), valid);
  assert.throws(() => perform(active("captain"), valid));
});
test("One clue allows N+1 guesses; old turn messages are rejected", () => {
  const { room, active, perform, clue, guess } = table();
  const initial = room.turn.team,
    old = room.turn.id;
  clue();
  guess(initial);
  assert.equal(room.turn.guesses, 1);
  guess(initial);
  assert.equal(room.turn.team, otherTeam(initial));
  assert.throws(() =>
    perform(active("captain"), { type: "clue", word: "Абетка", count: 1, turnId: old }),
  );
});
test("A neutral or opponent guess passes the turn", () => {
  for (const kind of ["neutral", "enemy"]) {
    const { room, clue, guess } = table();
    const first = room.turn.team;
    clue();
    guess(kind === "enemy" ? otherTeam(first) : kind);
    assert.equal(room.turn.team, otherTeam(first));
  }
});
test("A team wins even when its final card was opened by the other team", () => {
  const { room, clue, guess } = table();
  const enemy = otherTeam(room.turn.team);
  room.cards
    .filter((c) => c.kind === enemy)
    .slice(1)
    .forEach((c) => (c.open = true));
  clue();
  guess(enemy);
  assert.equal(room.winner, enemy);
  assert.equal(room.stage, "finished");
});
test("Fluttershy opens one neutral and keeps the turn", () => {
  const { room, active, perform } = table();
  const team = room.turn.team;
  room.powers[team] = "fluttershy";
  perform(active("captain"), { type: "magic" });
  assert.equal(remaining(room, "neutral"), 6);
  assert.equal(room.turn.team, team);
  assert.equal(room.turn.phase, "clue");
  assert.throws(() => perform(active("captain"), { type: "magic" }));
});
test("Twilight adds a second clue once, without increasing the guess allowance", () => {
  const { room, active, perform, clue } = table();
  room.powers[room.turn.team] = "twilight";
  const cast = () => perform(active("captain"), { type: "magic", word: "Літера" });
  assert.throws(cast);
  clue();
  cast();
  assert.equal(room.turn.clues.length, 2);
  assert.equal(room.turn.guesses, 2);
  assert.throws(cast);
});
test("Timer expires at the deadline and resets the next captain’s turn", () => {
  const { room } = table();
  const first = room.turn.team,
    deadline = room.turn.deadline;
  assert.equal(expireTurn(room, deadline - 1), false);
  assert.equal(expireTurn(room, deadline), true);
  assert.equal(room.turn.team, otherTeam(first));
  assert.equal(room.turn.deadline, deadline + room.seconds * 1000);
});
