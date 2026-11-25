import { esc, marks, names, opt, spellMark, spellNames, spellRules } from "./ui.js";

const teams = ["sun", "moon"];
const me = (s) => s.players.find((p) => p.id === s.you);
export function roomHeader(s) {
  const host = s.players.find((p) => p.id === s.host);
  return `<div class="room-bar"><div><span class="muted">Кімната</span> <button class="code" title="Скопіювати код кімнати" data-copy>${esc(s.code)} ⧉</button></div><div class="row">
  ${host && !host.online ? '<button class="text-btn" data-act="claimHost">Стати ведучим</button>' : ""}
  <button class="text-btn" data-leave>Покинути кімнату</button></div></div>`;
}
function chat(s) {
  return `<section class="panel chat"><h3>Спільний чат</h3><div id="chat-list" aria-label="Повідомлення">${s.chat.length ? s.chat.map((m) => `<p><b>${esc(m.name)}</b> ${esc(m.text)}</p>`).join("") : '<p class="muted">Тут можна привітатися з командою.</p>'}</div>
  <form id="chat-form" class="inline"><input name="text" aria-label="Повідомлення" required maxlength="240" placeholder="Повідомлення…"><button class="secondary">Надіслати</button></form></section>`;
}
function playerLine(p, s) {
  return `<li><span class="status ${p.online ? "on" : ""}" title="${p.online ? "Онлайн" : "Поза мережею"}"></span><b>${esc(p.name)}${p.id === s.you ? " (ти)" : ""}</b><small>${p.role === "captain" ? "Капітан" : "Розвідник"}${!p.online ? " · офлайн" : ""}</small></li>`;
}
export function lobbyPage(s, decks) {
  const you = me(s),
    host = s.host === s.you;
  const eligible = teams.every((t) =>
    ["captain", "scout"].every((role) =>
      s.players.some((p) => p.team === t && p.role === role && p.online),
    ),
  );
  const chosen = decks.some((d) => d.id === s.deck.id) ? decks : [s.deck, ...decks];
  const waiting = s.players.filter((p) => !p.team).map((p) => esc(p.name));
  return (
    roomHeader(s) +
    `<div class="page-head tight"><h1>Лобі кімнати</h1><p>Передай друзям код <strong>${s.code}</strong>. Оберіть команди й ролі.</p></div>
  <div class="team-grid">${teams
    .map((t) => {
      const members = s.players.filter((p) => p.team === t),
        captain = members.find((p) => p.role === "captain");
      const power = s.powers[t];
      return `<section class="panel team ${t}"><header><span class="crest">${marks[t]}</span><div><small>Команда</small><h2>${names[t]}</h2></div><span class="member-count">${members.length}</span></header>
    <ul>${members.length ? members.map((p) => playerLine(p, s)).join("") : '<li class="muted">Місця ще вільні</li>'}</ul>
    <div class="row"><button class="secondary" data-seat="${t}" data-role="captain" ${captain ? "disabled" : ""}>Стати капітаном</button><button class="secondary" data-seat="${t}" data-role="scout" ${you.team === t && you.role === "scout" ? "disabled" : ""}>Стати розвідником</button></div>
    <div class="team-spell">${
      you.team === t && you.role === "captain"
        ? `<label>Магія команди<select id="power-select">${Object.keys(spellNames)
            .map((k) => opt(k, spellNames[k], power))
            .join("")}</select></label>`
        : `<strong>${spellMark[power]} ${spellNames[power]}</strong>`
    }<p>${spellRules[power]}</p></div></section>`;
    })
    .join("")}</div>
  ${waiting.length ? '<p class="muted waiting">Ще обирають команду: ' + waiting.join(", ") + ".</p>" : ""}
  <div class="lobby-bottom"><section class="panel settings"><h3>Налаштування партії</h3>${
    host
      ? `<form id="settings-form"><label>Колода<select name="deckId">${chosen.map((d) => opt(d.id, d.title, s.deck.id)).join("")}</select></label><label>Час на хід<select name="seconds">${[45, 60, 90, 120, 180].map((n) => opt(n, n + " с", s.seconds)).join("")}</select></label><button class="secondary">Зберегти налаштування</button></form>
  <button class="primary full" data-act="start" ${eligible ? "" : "disabled"}>Почати гру</button>${eligible ? "" : '<p class="note">Потрібні капітан і розвідник онлайн у кожній команді.</p>'}`
      : `<p>${esc(s.deck.title)} · ${s.seconds} с на хід</p><p class="muted">Коли обидві команди зберуться, ведучий почне партію.</p>`
  }</section>${chat(s)}</div>`
  );
}
function turnActions(s) {
  const you = me(s),
    t = s.turn;
  if (s.stage === "finished")
    return `<h3>Партію завершено</h3><p>${esc(s.reason)}</p>${s.host === s.you ? '<button class="primary" data-act="lobby">Зіграти ще раз</button>' : '<p class="note">Ведучий може відкрити нову партію.</p>'}`;
  const active = you.team === t.team;
  const captain = active && you.role === "captain";
  const scout = active && you.role === "scout";
  const power = you.team && s.powers[you.team];
  return `<h3>Підказка капітана</h3>${t.clues.length ? t.clues.map((c) => `<div class="clue">${esc(c.word)} ${c.count ? "<b>" + c.count + "</b>" : "<small>магія</small>"}</div>`).join("") : '<p class="muted">Капітан добирає слово…</p>'}
    ${captain && t.phase === "clue" ? `<form id="clue-form"><label>Одне слово<input name="word" required maxlength="32" placeholder="Наприклад, ніч"></label><label>Кількість карток<select name="count">${Array.from({ length: s.remaining[you.team] }, (_, i) => opt(i + 1, i + 1, 1)).join("")}</select></label><button class="primary full">Дати підказку</button></form>` : ""}
    ${t.phase === "guess" ? '<p class="note">Залишок спроб: ' + t.guesses + "</p>" : ""}
    ${scout && t.phase === "guess" ? '<p class="note">Натисни картку на полі, щоб обрати її.</p><button class="secondary full" data-act="pass">Передати хід</button>' : ""}
    ${
      you.team
        ? `<div class="magic-area"><h3>${spellMark[power]} ${spellNames[power]}</h3><p>${spellRules[power]}</p>
    ${s.used[you.team] ? "<small>Магію вже використано</small>" : captain && (power === "fluttershy" || t.phase === "guess") ? '<button class="secondary full" data-magic>Застосувати магію</button>' : "<small>Один раз за партію</small>"}</div>`
        : ""
    }`;
}
export function gamePage(s) {
  const you = me(s),
    finished = s.stage === "finished",
    current = finished ? s.winner : s.turn.team;
  const canGuess = !finished && you.team === current && you.role === "scout" && s.turn.phase === "guess";
  return (
    roomHeader(s) +
    `<div class="game-head"><div><small>${esc(s.deck.title)} · ${you.role === "captain" ? "Ти капітан" : you.role === "scout" ? "Ти розвідник" : "Ти спостерігач"}${you.team ? " · " + names[you.team] : ""}</small>
    <h1>${finished ? "Перемогла команда" : "Хід команди"} <em class="ink-${current}">${names[current]}</em></h1></div>
    ${!finished ? '<span class="clock" id="clock" aria-label="Час до кінця ходу">—</span>' : ""}</div>
  <div class="game-layout"><section><div class="scorebar">${teams.map((t) => `<span class="score ${t}">${marks[t]} ${names[t]} <b>${s.remaining[t]}</b></span>`).join("")}<small>Знаків лишилось</small></div>
  <div class="board">${s.cards
    .map((c, i) => {
      const label = c.kind ? names[c.kind] : "Прихована";
      return `<button class="tile ${c.kind || "hidden"} ${c.open ? "revealed" : ""}" aria-label="${esc(c.word)}, ${label}${c.open ? ", відкрито" : ""}" data-card="${i}" ${canGuess && !c.open ? "" : "disabled"}>
      <span class="card-mark" aria-hidden="true">${c.kind ? marks[c.kind] : "✧"}</span><span class="tile-icon" aria-hidden="true">${esc(c.icon)}</span>
      <b>${esc(c.word)}</b><small>${c.open ? "Відкрито" : c.kind ? label : ""}</small></button>`;
    })
    .join("")}</div></section><aside class="panel turn">${turnActions(s)}</aside></div>
  <div class="lobby-bottom"><section class="panel history"><h3>Історія партії</h3><ol>${[...s.history]
    .reverse()
    .map((line) => "<li>" + esc(line) + "</li>")
    .join("")}</ol></section>${chat(s)}</div>`
  );
}
