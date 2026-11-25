
export const $ = (selector) => document.querySelector(selector);
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
export const names = { sun: "Селестія", moon: "Луна", neutral: "Нейтральна", discord: "Дискорд" };
export const marks = { sun: "☀", moon: "☾", neutral: "◇", discord: "ϟ" };
export const spellNames = { twilight: "Твайлайт", fluttershy: "Флаттершай" };
export const spellRules = {
  twilight: "Капітан додає друге слово-підказку під час відгадування.",
  fluttershy: "Капітан відкриває одну випадкову нейтральну картку.",
};
export const spellMark = { twilight: "✶", fluttershy: "❀" };
export function opt(value, title, current) {
  return (
    '<option value="' +
    esc(value) +
    '"' +
    (String(value) === String(current) ? " selected" : "") +
    ">" +
    esc(title) +
    "</option>"
  );
}
let timer;
export function notify(message) {
  if ($("#modal").open) {
    let feedback = $("#modal-feedback");
    if (!feedback) {
      feedback = document.createElement("p");
      feedback.id = "modal-feedback";
      feedback.setAttribute("role", "status");
      $("#modal-content").append(feedback);
    }
    feedback.textContent = message;
    return;
  }
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove("show"), 4800);
}
export function modal(html) {
  $("#modal-content").innerHTML =
    '<button type="button" class="close" aria-label="Закрити" data-close>×</button>' + html;
  if (!$("#modal").open) $("#modal").showModal();
}
export const closeModal = () => $("#modal").close();
export function entryPage(mode, nick, code, connected) {
  const join = mode === "join";
  return `<div class="entry-grid">
    <section class="hero"><div class="hero-picture"></div>
      <div class="hero-copy"><div class="ornament" aria-hidden="true"><i></i>✦<i></i></div>
        <h1>Таємні знаки<br><em>Еквестрії</em></h1>
        <p>Дай підказку. Знайди знаки своєї команди. Остерігайся Дискорда.</p>
      </div></section>
    <section class="panel entry"><span class="entry-symbol" aria-hidden="true">✧</span><h2>Ігрова кімната</h2>
      <p class="muted">Збери друзів і обери, за кого грати — Селестію чи Луну.</p>
      <div class="switch"><button type="button" data-mode="create" class="${!join ? "selected" : ""}" aria-pressed="${!join}">Створити</button><button type="button" data-mode="join" class="${join ? "selected" : ""}" aria-pressed="${join}">Приєднатися</button></div>
      <form id="entry-form"><label>Твоє ім’я<input name="name" required maxlength="22" autocomplete="nickname" placeholder="Як тебе називати?" value="${esc(nick)}"></label>
        ${join ? `<label>Код кімнати<input name="code" class="room-input" required minlength="5" maxlength="5" autocapitalize="characters" placeholder="Наприклад, K7LAN" value="${esc(code)}"></label>` : ""}
        <button class="primary full" ${connected ? "" : "disabled"}>${!connected ? "Підключення…" : join ? "Увійти до кімнати" : "Створити кімнату"}</button>
      </form>
      <div class="entry-facts"><div><b>4–12</b><small>гравців</small></div><div><b>2</b><small>команди</small></div><div><b>25</b><small>карток</small></div></div>
    </section>
  </div>
  <section class="powers-section"><div class="section-line"><h2>Магія поні</h2><button class="text-btn" data-nav="rules">Усі правила</button></div>
    <div class="power-grid">${Object.keys(spellNames)
      .map(
        (id) =>
          `<article class="power-card ${id}"><span class="power-glyph" aria-hidden="true">${spellMark[id]}</span><div><h3>${spellNames[id]}</h3><p>${spellRules[id]}</p></div></article>`,
      )
      .join("")}</div></section>`;
}
export function rulesPage() {
  return `<div class="page-head"><h1>Правила гри</h1><p>Дві команди шукають свої знаки на спільному полі з 25 карток.</p></div>
  <div class="rule-grid">${[
    [
      "☀",
      "Зберіться в кімнаті",
      "Від 4 до 12 учасників. Для кожної команди потрібен один капітан і хоча б один розвідник. Якщо вас п’ятеро, одна команда може мати двох розвідників.",
    ],
    [
      "✧",
      "Дайте підказку",
      "Капітани бачать кольори всіх карток. Капітан активної команди називає одне слово й число — скільки власних карток із ним пов’язано. Слова з поля як підказки заборонені.",
    ],
    [
      "◇",
      "Відкривайте картки",
      "Розвідник обирає й підтверджує картку. Своя картка дозволяє продовжити. Доступно до N + 1 спроб, де N — число капітана. Нейтральна або чужа картка, пас чи завершення таймера передають хід супернику.",
    ],
    [
      "☾",
      "Знайдіть усі знаки",
      "Перша команда має 9 карток, друга — 8. На полі також 7 нейтральних і 1 Дискорд. Команда перемагає, щойно відкрито всі її знаки. Дискорд одразу приносить перемогу супернику.",
    ],
    [
      "✶",
      "Оберіть магію",
      "У лобі капітан обирає Твайлайт або Флаттершай. Команда може скористатися її здібністю один раз за партію під час свого ходу. Додаткова підказка Твайлайт не збільшує кількість спроб.",
    ],
    [
      "⌛",
      "Стежте за часом",
      "Ведучий обирає тривалість ходу в лобі. Один таймер охоплює підказку й відгадування. Після оновлення вкладки ти автоматично повернешся на своє місце.",
    ],
  ]
    .map(
      ([icon, title, body]) =>
        `<article class="panel rule"><span aria-hidden="true">${icon}</span><h2>${title}</h2><p>${body}</p></article>`,
    )
    .join("")}</div>`;
}

function coverSvg(shapes) {
  const paths = shapes
    .map((shape) => {
      const d = esc(typeof shape === "string" ? shape : shape.d);
      return shape.s
        ? '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
        : '<path d="' + d + '" fill="currentColor"/>';
    })
    .join("");
  return (
    '<svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" ' +
    'style="filter:drop-shadow(0 0 8px currentColor)">' +
    paths +
    "</svg>"
  );
}

export function decksPage(decks) {
  return `<div class="page-head split"><div><h1>Колоди</h1><p>Обери набір слів для наступної партії або напиши власний.</p></div>${/* : кнопка создать через ии */ ""}<div class="row"><button class="secondary" data-deck-ai>Створити через ШІ</button><button class="primary" data-deck-new>Створити колоду</button></div></div>
  <div class="deck-grid">${decks.map((d, i) => `<article class="panel deck"><div class="deck-cover tone-${i % 3}"><span>${/* обложка от ии */ ""}${d.cover ? coverSvg(d.cover) : ["✦", "❀", "☾"][i % 3]}</span></div><div class="deck-body"><small>${/* изминение подписи */ ""}${d.custom ? (d.shared ? "Твоя колода · спільна" : "Твоя колода") : d.shared ? "Спільна колода" : "Колода Еквестрії"} · ${d.words.length} карток</small><h2>${esc(d.title)}</h2><p>${esc(d.description)}</p><button class="secondary" data-deck-view="${esc(d.id)}">Переглянути слова</button>${d.custom ? ` <button class="text-btn" data-deck-edit="${esc(d.id)}">Редагувати</button> ${/* ДОДАНО: кнопка «Поділитися з усіма» / «Прибрати зі спільних» */ ""}<button class="text-btn" data-deck-share="${esc(d.id)}" data-shared="${d.shared ? 0 : 1}">${d.shared ? "Прибрати зі спільних" : "Поділитися з усіма"}</button>` : ""}</div></article>`).join("")}</div>`;
}
export function deckEditor(d) {
  return `<h2>${d ? "Редагувати колоду" : "Нова колода"}</h2><form id="deck-form" data-id="${esc(d?.id)}"><label>Назва колоди<input name="title" maxlength="45" required value="${esc(d?.title)}"></label><label>Слова, по одному на рядок<textarea name="words" rows="10" required placeholder="Місяць&#10;Кристал&#10;Веселка">${esc(d?.words.map((x) => x.word).join("\n"))}</textarea></label><small id="word-count"></small><p class="note">Від 25 до 160 різних слів. Колодою керує автор у цьому браузері.</p><div class="row"><button class="primary">Зберегти</button>${d ? `<button type="button" class="text-btn danger" data-deck-delete="${esc(d.id)}">Видалити</button>` : ""}</div></form>`;
}
// создание колоды иишкой
export function aiDeckEditor() {
  return `<h2>Колода за допомогою ШІ</h2><form id="ai-deck-form"><label>Тема<input name="theme" maxlength="60" required placeholder="Наприклад, море"></label><p class="note">Створення займає кілька секунд. Не частіше, ніж раз на 30 секунд.</p><button class="primary full">Створити</button></form>`;
}
