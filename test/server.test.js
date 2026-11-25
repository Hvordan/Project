import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io as connect } from "socket.io-client";
import { createGameServer } from "../server/app.js";

async function start(filename = ":memory:") {
  const server = createGameServer(filename);
  server.http.listen(0, "127.0.0.1");
  await once(server.http, "listening");
  return { server, url: "http://127.0.0.1:" + server.http.address().port };
}
async function client(url) {
  const socket = connect(url, { forceNew: true, reconnection: false, autoConnect: false });
  const peer = { key: randomBytes(32).toString("hex"), socket, state: null };
  socket.on("state", (s) => {
    peer.state = s;
  });
  const ready = once(socket, "connect");
  socket.connect();
  await ready;
  peer.send = (event, payload) => socket.timeout(3000).emitWithAck(event, { key: peer.key, ...payload });
  peer.act = (data) => peer.send("action", { turnId: peer.state?.turn?.id, ...data });
  return peer;
}
function good(reply) {
  assert.equal(reply.ok, true, reply.error);
  return reply;
}
async function waitUntil(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Очікуване оновлення не надійшло.");
}
test(
  "Four live clients, shared clues, permissions, Discord, rematch and reconnect",
  { timeout: 15000 },
  async (t) => {
    const { server, url } = await start();
    const peers = [];
    t.after(async () => {
      for (const p of peers) p.socket.disconnect();
      await server.close();
    });
    for (let i = 0; i < 4; i++) peers.push(await client(url));
    const [host, a, b, c] = peers;
    const opening = good(await host.send("createRoom", { name: "Капітан А" }));
    const code = opening.code;
    assert.match(code, /^[A-Z2-9]{5}$/);
    assert.equal((await host.act({ type: "start" })).ok, false);
    for (const [p, name] of [
      [a, "Розвідник А"],
      [b, "Капітан Б"],
      [c, "Розвідник Б"],
    ])
      good(await p.send("joinRoom", { name, code }));
    good(await host.act({ type: "seat", team: "sun", role: "captain" }));
    assert.equal((await a.act({ type: "seat", team: "sun", role: "captain" })).ok, false);
    good(await a.act({ type: "seat", team: "sun", role: "scout" }));
    good(await b.act({ type: "seat", team: "moon", role: "captain" }));
    good(await c.act({ type: "seat", team: "moon", role: "scout" }));
    assert.equal((await c.act({ type: "start" })).ok, false);
    good(await host.act({ type: "start" }));
    await waitUntil(() => peers.every((p) => p.state.stage === "playing"));
    const sun = host.state.turn.team === "sun";
    const captain = sun ? host : b,
      scout = sun ? a : c;
    const enemy = sun ? "moon" : "sun";
    assert.ok(captain.state.cards.every((card) => card.kind));
    assert.ok(scout.state.cards.every((card) => card.kind === null));
    const index = captain.state.cards.findIndex((card) => card.kind === "discord");
    assert.equal((await scout.act({ type: "guess", index })).ok, false);
    good(await captain.act({ type: "clue", word: "Сузірник", count: 1 }));
    await waitUntil(() => scout.state.turn.phase === "guess");
    good(await scout.act({ type: "guess", index }));
    await waitUntil(() => peers.every((p) => p.state.stage === "finished" && p.state.winner === enemy));
    good(await host.act({ type: "lobby" }));
    good(await c.act({ type: "chat", text: "Ще одну партію?" }));
    await waitUntil(() => host.state.chat.at(-1)?.text === "Ще одну партію?");
    const id = host.state.you;
    host.socket.disconnect();
    await waitUntil(() => a.state.players.find((p) => p.id === id)?.online === false);
    const replacement = await client(url);
    peers.push(replacement);
    good(await replacement.send("resume", { code, token: opening.token }));
    assert.equal(replacement.state.you, id);
    assert.equal(replacement.state.players.length, 4);
  },
);
test("SQLite restores the same room and player after a server restart", { timeout: 12000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), "equestria-"));
  const filename = join(folder, "test.sqlite");
  let app, peer;
  try {
    app = await start(filename);
    peer = await client(app.url);
    const ticket = good(await peer.send("createRoom", { name: "Луна" }));
    good(await peer.act({ type: "chat", text: "До зустрічі" }));
    const original = peer.state.you;
    peer.socket.disconnect();
    await app.server.close();
    app = null;
    app = await start(filename);
    peer = await client(app.url);
    good(await peer.send("resume", { code: ticket.code, token: ticket.token }));
    assert.equal(peer.state.you, original);
    assert.equal(peer.state.chat.at(-1).text, "До зустрічі");
  } finally {
    peer?.socket.disconnect();
    if (app) await app.server.close();
    await rm(folder, { force: true, recursive: true });
  }
});
test("Author decks support create, edit, select, delete and room snapshots", async (t) => {
  const { server, url } = await start();
  const author = await client(url);
  t.after(async () => {
    author.socket.disconnect();
    await server.close();
  });
  const key = author.key,
    other = randomBytes(32).toString("hex");
  const call = (path, method = "GET", body, owner = key) =>
    fetch(url + "/api/decks" + path, {
      method,
      headers: { "X-Deck-Key": owner, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  const body = {
    title: "Тестова колода",
    words: Array.from({ length: 30 }, (_, i) => "Карта " + (i + 1)),
  };
  const invalid = await call("", "POST", { ...body, words: Array(25).fill("Одне") });
  assert.equal(invalid.status, 400);
  const created = await call("", "POST", body);
  assert.equal(created.status, 201);
  const deck = await created.json();
  assert.equal((await (await call("", "GET", null, other)).json()).length, 3);
  assert.equal((await call("/" + deck.id, "PUT", body, other)).status, 400);
  assert.equal((await call("/" + deck.id, "PUT", { ...body, title: "Моя колода" })).status, 200);
  good(await author.send("createRoom", { name: "Автор" }));
  good(await author.act({ type: "settings", deckId: deck.id, seconds: 60 }));
  assert.equal(author.state.deck.title, "Моя колода");
  assert.equal((await call("/" + deck.id, "PUT", { ...body, title: "Оновлена колода" })).status, 200);
  good(await author.act({ type: "settings", deckId: deck.id, seconds: 60 }));
  assert.equal(author.state.deck.title, "Оновлена колода");
  assert.equal((await call("/" + deck.id, "DELETE")).status, 204);
  good(await author.act({ type: "chat", text: "Перевірка" }));
  assert.equal(author.state.deck.count, 30);
  assert.equal((await (await call("")).json()).length, 3);
});
