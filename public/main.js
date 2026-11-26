
import { $, esc, notify, modal, closeModal, entryPage, rulesPage, decksPage, deckEditor, aiDeckEditor, libraryPage } from "./ui.js"; // добавлено aiDeckEditor и libraryPage 
import { lobbyPage, gamePage } from "./room.js";
import "./pony.js";

const app = $("#app"),
  socket = window.io({ autoConnect: false });
const keyName = "equestria.deck-key";
let key = localStorage.getItem(keyName);
if (!key) {
  key = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  localStorage.setItem(keyName, key);
}
const savedName = "equestria.nickname",
  savedRoom = "equestria.room";
let room = null,
  decks = [],
  library = [], // колоды других людей
  libraryQuery = "", // поиск в библиотеке 
  page = "play",
  mode = "create",
  code = "",
  nick = localStorage.getItem(savedName) || "";
let renderedContext = "",
  online = false,
  clockOffset = 0;
function rememberEntry() {
  const form = $("#entry-form");
  if (form) {
    nick = form.elements.name.value;
    if (form.elements.code) code = form.elements.code.value;
  }
}
function render() {
  rememberEntry();
  const context = [page, room?.code, room?.stage, room?.turn?.id, mode].join("|");
  const active = document.activeElement;
  const focus =
    active?.name && active.form ? [active.form.id, active.name, active.selectionStart] : null;
  const drafts = [];
  if (renderedContext === context) {
    for (const field of app.querySelectorAll("input[name],textarea[name],select[name]")) {
      if (field.form && field.dataset.edited) drafts.push([field.form.id, field.name, field.value]);
    }
  }
  renderedContext = context;
  document
    .querySelectorAll("nav [data-nav]")
    .forEach((b) => b.setAttribute("aria-current", b.dataset.nav === (page === "library" ? "decks" : page) ? "page" : "false")); 
    if (page === "rules") app.innerHTML = rulesPage();
  else if (page === "decks") app.innerHTML = decksPage(decks);
  else if (page === "library") app.innerHTML = libraryPage(library, libraryQuery); 
  else if (!room) app.innerHTML = entryPage(mode, nick, code, online);
  else
    app.innerHTML =
      (!online ? '<p class="network">З’єднання втрачено. Повертаємо тебе до кімнати…</p>' : "") +
      (room.stage === "lobby" ? lobbyPage(room, decks) : gamePage(room));
  for (const [form, name, value] of drafts) {
    const field = document.getElementById(form)?.elements.namedItem(name);
    if (field) {
      field.value = value;
      field.dataset.edited = "1";
    }
  }
  if (focus) {
    const field = document.getElementById(focus[0])?.elements.namedItem(focus[1]);
    if (field) {
      field.focus({ preventScroll: true });
      if (typeof focus[2] === "number" && field.setSelectionRange)
        field.setSelectionRange(focus[2], focus[2]);
    }
  }
  const log = $("#chat-list");
  if (log) log.scrollTop = log.scrollHeight;
  tick();
}
function tick() {
  const clock = $("#clock");
  if (!clock || !room?.turn) return;
  const n = Math.max(0, Math.ceil((room.turn.deadline - Date.now() - clockOffset) / 1000));
  clock.textContent = Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
  clock.classList.toggle("urgent", n < 11);
}
setInterval(tick, 300);
function emit(event, data) {
  if (!socket.connected) return Promise.reject(new Error("Немає з’єднання із сервером."));
  return new Promise((resolve, reject) =>
    socket.timeout(8000).emit(event, data, (err, reply) => {
      if (err || !reply?.ok)
        reject(new Error(reply?.error || "Сервер не відповідає. Перевір з’єднання."));
      else resolve(reply);
    }),
  );
}
const act = (data) => emit("action", { turnId: room?.turn?.id, ...data });

async function api(path, method = "GET", body) {
  const response = await fetch("/api/decks" + path, {
    method,
    headers: { "X-Deck-Key": key, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = response.status === 204 ? null : await response.json().catch(() => null); 
  if (!response.ok || (result === null && response.status !== 204)) 
    throw new Error(result?.error || "Сервер тимчасово недоступний. Спробуй за хвилину."); 
  return result;
}
async function loadDecks() {
  decks = await api("");
  render();
}
function navigate(next) {
  page = next;
  render();
  window.scrollTo({ top: 0 });
  app.focus({ preventScroll: true });
}
function updateCount() {
  const field = $("#deck-form")?.elements.words;
  if (field)
    $("#word-count").textContent =
      "Карток: " + field.value.split(/\r?\n/u).filter((w) => w.trim()).length;
}
function showEditor(deck) {
  modal(deckEditor(deck));
  updateCount();
}
function forget() {
  sessionStorage.removeItem(savedRoom);
  room = null;
  page = "play";
  closeModal();
  render();
}
socket.on("connect", async () => {
  online = true;
  const saved = sessionStorage.getItem(savedRoom);
  if (saved) {
    let data;
    try {
      data = JSON.parse(saved);
    } catch {
      sessionStorage.removeItem(savedRoom);
    }
    if (data) {
      try {
        await emit("resume", { ...data, key });
      } catch (error) {
        if (!socket.connected) return;
        if (/місце|Сесію|Кімнату не знайдено/u.test(error.message)) forget();
        notify(error.message);
      }
    }
  }
  render();
});
socket.on("disconnect", () => {
  online = false;
  render();
});
socket.on("connect_error", () => {
  online = false;
  render();
});
socket.on("state", (state) => {
  if (
    room &&
    (room.stage !== state.stage || room.turn?.id !== state.turn?.id) &&
    $("#modal").open &&
    $("#modal-content").querySelector("[data-turn-id],#magic-form")
  )
    closeModal();
  room = state;
  clockOffset = state.serverNow - Date.now();
  render();
});
socket.on("notice", notify);
socket.on("replaced", () => {
  forget();
  notify("Твоє місце вже відкрито в іншій вкладці.");
});
document.addEventListener("input", (e) => {
  if (e.target.form) e.target.dataset.edited = "1";
  if (e.target.closest("#deck-form")) updateCount();
});
document.addEventListener("change", async (e) => {
  if (e.target.id === "power-select") {
    try {
      await act({ type: "power", power: e.target.value });
    } catch (error) {
      notify(error.message);
      render();
    }
  }
});
document.addEventListener("click", async (e) => {
  if (e.target === $("#modal")) return closeModal();
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  const d = b.dataset;
  try {
    if ("close" in d) return closeModal();
    if (d.nav) return navigate(d.nav);
    if (d.mode) {
      rememberEntry();
      mode = d.mode;
      return render();
    }
    if ("copy" in d) {
      try {
        await navigator.clipboard.writeText(room.code);
        notify("Код скопійовано.");
      } catch {
        modal(
          '<h2>Код кімнати</h2><p class="big-code">' +
            esc(room.code) +
            "</p><p>Передай друзям цей код і адресу гри.</p>",
        );
      }
      return;
    }
    if ("leave" in d)
      return modal(
        `<h2>Покинути кімнату?</h2><p>${room.stage === "playing" ? "Якщо учасник команди вийде, партія повернеться до лобі. Для короткої перерви можна просто оновити вкладку." : "Твоє місце в кімнаті звільниться."}</p><div class="row"><button class="secondary" data-close>Залишитися</button><button class="primary" data-exit>Вийти</button></div>`,
      );
    if ("exit" in d) {
      await act({ type: "leave" });
      return forget();
    }
    if (d.seat) return await act({ type: "seat", team: d.seat, role: d.role });
    if (d.act) return await act({ type: d.act });
    if ("card" in d) {
      const card = room.cards[Number(d.card)];
      return modal(
        `<h2>Відкрити картку?</h2><div class="chosen-card"><span>${esc(card.icon)}</span><b>${esc(card.word)}</b></div><div class="row"><button class="secondary" data-close>Скасувати</button><button class="primary" data-guess="${d.card}" data-turn-id="${room.turn.id}">Відкрити</button></div>`,
      );
    }
    if ("guess" in d) {
      await act({ type: "guess", index: Number(d.guess), turnId: d.turnId });
      return closeModal();
    }
    if ("magic" in d) {
      const you = room.players.find((p) => p.id === room.you);
      if (room.powers[you.team] === "twilight")
        return modal(
          `<h2>Магія Твайлайт</h2><form id="magic-form" data-turn-id="${room.turn.id}"><label>Додаткове слово-підказка<input name="word" required maxlength="32" autofocus></label><button class="primary">Застосувати магію</button></form>`,
        );
      return modal(
        `<h2>Магія Флаттершай</h2><p>Відкрити одну випадкову нейтральну картку? Ця здібність доступна раз за партію.</p><button class="primary" data-flutter data-turn-id="${room.turn.id}">Відкрити нейтральну</button>`,
      );
    }
    if ("flutter" in d) {
      await act({ type: "magic", turnId: d.turnId });
      return closeModal();
    }
    if ("deckNew" in d) return showEditor(null);
    if ("deckAi" in d) return modal(aiDeckEditor()); 
    
    if (d.deckShare) {
      const share = d.shared === "1";
      await api("/" + d.deckShare + "/share", "POST", { shared: share });
      await loadDecks();
      notify(share ? "Колоду додано до спільних: її бачать усі гравці." : "Колоду прибрано зі спільних.");
      return;
    }
    
    // библиотека колод других людей
    if ("deckLibrary" in d) {
      libraryQuery = "";
      library = await api("/library");
      return navigate("library");
    }
    if (d.libraryView) {
      const deck = library.find((x) => x.id === d.libraryView);
      return modal(
        `<h2>${esc(deck.title)}</h2><p>${deck.words.length} карток</p><div class="chips">${deck.words.map((w) => "<span>" + esc(w.icon) + " " + esc(w.word) + "</span>").join("")}</div>`,
      );
    }
    if (d.librarySave) {
      await api("/library/" + d.librarySave + "/save", "POST");
      await loadDecks();
      library = await api("/library?q=" + encodeURIComponent(libraryQuery));
      render();
      notify("Колоду додано до твоїх. Вона з’явилась на сторінці «Колоди».");
      return;
    }
    
    if (d.deckEdit) return showEditor(decks.find((x) => x.id === d.deckEdit));
    if (d.deckView) {
      const deck = decks.find((x) => x.id === d.deckView);
      return modal(
        `<h2>${esc(deck.title)}</h2><p>${deck.words.length} карток</p><div class="chips">${deck.words.map((w) => "<span>" + esc(w.icon) + " " + esc(w.word) + "</span>").join("")}</div>`,
      );
    }
    if (d.deckDelete)
      return modal(
        `<h2>Видалити цю колоду?</h2><p>Уже створені кімнати збережуть свою копію слів.</p><div class="row"><button class="secondary" data-close>Скасувати</button><button class="primary" data-delete="${esc(d.deckDelete)}">Видалити колоду</button></div>`,
      );
    if (d.delete) {
      await api("/" + d.delete, "DELETE");
      await loadDecks();
      closeModal();
      notify("Колоду видалено.");
    }
  } catch (error) {
    notify(error.message);
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.dataset.pending) return;
  form.dataset.pending = "1";
  const values = Object.fromEntries(new FormData(form));
  try {
    switch (form.id) {
      case "entry-form": {
        nick = values.name.trim();
        code = (values.code || "").trim().toUpperCase();
        const result = await emit(mode === "create" ? "createRoom" : "joinRoom", {
          name: nick,
          code,
          key,
        });
        localStorage.setItem(savedName, nick);
        sessionStorage.setItem(savedRoom, JSON.stringify({ code: result.code, token: result.token }));
        break;
      }
      case "settings-form":
        await act({ type: "settings", deckId: values.deckId, seconds: Number(values.seconds) });
        notify("Налаштування збережено.");
        break;
      case "chat-form":
        await act({ type: "chat", text: values.text });
        if ($("#chat-form")) {
          $("#chat-form").reset();
          delete $("#chat-form").elements.text.dataset.edited;
        }
        break;
      case "clue-form":
        await act({ type: "clue", word: values.word, count: Number(values.count) });
        break;
      case "magic-form":
        await act({ type: "magic", word: values.word, turnId: form.dataset.turnId });
        closeModal();
        break;
      case "deck-form": {
        const id = form.dataset.id;
        await api(id ? "/" + id : "", id ? "PUT" : "POST", {
          title: values.title,
          words: values.words
            .split(/\r?\n/u)
            .map((w) => w.trim())
            .filter(Boolean),
        });
        await loadDecks();
        closeModal();
        notify("Колоду збережено.");
        break;
      }
      // создание колод иишкой за темой
      case "ai-deck-form": {
        notify("Створюємо колоду, це може тривати кілька секунд…");
        await api("/generate", "POST", { theme: values.theme });
        await loadDecks();
        closeModal();
        notify("Колоду створено. Вона з’явилася в списку.");
        break;
      }
      
      // поиск в библиотеке колод других людей
      case "library-form": {
        libraryQuery = values.q.trim();
        library = await api("/library?q=" + encodeURIComponent(libraryQuery));
        render();
        break;
      }
     
    }
  } catch (error) {
    notify(error.message);
  } finally {
    delete form.dataset.pending;
  }
});
render();
loadDecks().catch((error) => notify(error.message));
socket.connect();
