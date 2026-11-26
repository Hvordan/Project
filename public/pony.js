
const PONY_SRC = "/art/pony.png"; //путь к картинке
const HIDE_AFTER_MS = 3800; // сколько поняшка весит 
const SAY_DELAY_MS = 450;  // облачко с фразой 
const BRAND_TEXT = "Еквестрія"; 
const NAV_TEXTS = ["Грати", "Колоди", "Правила"]; 
const HEADER_MAX_BOTTOM = 90; 

//все реплики можно будет еще чет добавить 
const LINES = [
  "Я бачила твій хід… Цікаво.",
  "Знаки не брешуть. Шукай уважніше.",
  "Тсс… Не кажи Селестії, що я тут.",
  "Моя сила росте. А що з твоєю підказкою?",
  "Хто шукає таємні знаки, той знаходить мене.",
  "Не відволікай мене від магії!",
  "Зірка впала. Загадай слово.",
  "Гадаєш, я просто проходила повз?",
];
// звездочки 
const SPARKS = [
  { x: 2, y: 6, s: 22, c: "#ffd23f", d: 0.0 },
  { x: 74, y: 2, s: 16, c: "#ff9a3c", d: 0.5 },
  { x: -14, y: 38, s: 18, c: "#ff4d5a", d: 0.9 },
  { x: 88, y: 30, s: 20, c: "#ffe9b0", d: 0.3 },
  { x: 10, y: 66, s: 14, c: "#ffd23f", d: 1.1 },
  { x: 60, y: 12, s: 12, c: "#ffe9b0", d: 0.7 },
  { x: -22, y: 12, s: 14, c: "#ff9a3c", d: 1.3 },
  { x: 94, y: 62, s: 16, c: "#ff4d5a", d: 0.2 },
];

let scene, bubble, hideTimer, sayTimer, lastLine = -1;
let broken = false;


if (typeof Image !== "undefined") {
  const probe = new Image();
  probe.onerror = () => {
    broken = true;
    console.warn("Поняшка: не знайдено картинку " + PONY_SRC + ". Поклади файл у public/art/pony.png");
  };
  probe.src = PONY_SRC;
}


function isBrandClick(target) {
  let el = target;
  for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
    const text = el.textContent || "";
    if (!text.includes(BRAND_TEXT)) continue;
    if (NAV_TEXTS.some((word) => text.includes(word))) return false;
    return el.getBoundingClientRect().bottom <= HEADER_MAX_BOTTOM;
  }
  return false;
}

const STYLES = `
.pony-scene{position:fixed;right:0;bottom:0;z-index:2147483000;pointer-events:none;
  user-select:none;-webkit-user-select:none;height:min(42vh,340px);aspect-ratio:599/760;
  visibility:hidden;transform:translate(115%,115%) rotate(-10deg);transform-origin:100% 100%;
  transition:transform .6s cubic-bezier(.22,1.2,.36,1),visibility 0s .6s}
.pony-scene.show{visibility:visible;transform:none;
  transition:transform .6s cubic-bezier(.22,1.2,.36,1),visibility 0s 0s}
.pony-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;
  filter:drop-shadow(0 6px 14px rgba(0,0,0,.45))}
.pony-glow{position:absolute;inset:-18% -45% -12% -35%;border-radius:50%;
  background:radial-gradient(closest-side,rgba(255,176,64,.6),rgba(224,54,44,.34) 55%,rgba(120,10,24,0) 100%);
  filter:blur(8px);opacity:0;transform:scale(.55);
  transition:opacity .5s .12s,transform .7s .12s cubic-bezier(.2,.9,.3,1.3)}
.pony-scene.show .pony-glow{opacity:1;transform:scale(1);animation:pony-pulse 1.8s ease-in-out .8s infinite alternate}
.pony-spark{position:absolute;left:var(--x);top:var(--y);width:var(--s);height:var(--s);background:var(--c);
  clip-path:polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%);opacity:0}
.pony-scene.show .pony-spark{animation:pony-twinkle 1.4s ease-in-out var(--d) infinite}
.pony-bubble{position:absolute;right:88%;top:4%;width:max-content;
  max-width:min(230px,calc(100vw - 100% - 16px));padding:9px 13px;background:#fff4e8;color:#3b0d11;
  border:2px solid #7a1417;border-radius:16px;box-shadow:0 6px 18px rgba(0,0,0,.35);
  font-family:inherit;font-weight:600;font-size:15px;line-height:1.3;
  opacity:0;transform:scale(.4) translateY(8px);transform-origin:100% 100%;
  transition:opacity .2s,transform .35s cubic-bezier(.2,1.4,.4,1)}
.pony-bubble::after{content:"";position:absolute;right:-8px;bottom:16px;width:12px;height:12px;
  background:#fff4e8;border:2px solid #7a1417;border-left:0;border-bottom:0;transform:rotate(45deg)}
.pony-bubble.say{opacity:1;transform:none}
@keyframes pony-pulse{from{transform:scale(1);opacity:.85}to{transform:scale(1.08);opacity:1}}
@keyframes pony-twinkle{0%{opacity:0;transform:scale(.2) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}100%{opacity:0;transform:scale(.2) rotate(90deg)}}
@media (max-width:520px){.pony-scene{height:min(34vh,260px)}}
@media (prefers-reduced-motion: reduce){
  .pony-scene{transform:none;opacity:0;transition:opacity .2s,visibility 0s .2s}
  .pony-scene.show{opacity:1;transition:opacity .2s,visibility 0s 0s}
  .pony-glow,.pony-scene.show .pony-glow{transform:none;animation:none;transition:none}
  .pony-scene.show .pony-spark{animation:none;opacity:.9}
  .pony-bubble{transform:none;transition:none}
}`;

function createScene() {
  const style = document.createElement("style");
  style.textContent = STYLES;
  document.head.append(style);

  const root = document.createElement("div");
  root.className = "pony-scene";
  root.setAttribute("aria-hidden", "true");

  const glow = document.createElement("div");
  glow.className = "pony-glow";
  root.append(glow);

  for (const spark of SPARKS) {
    const star = document.createElement("i");
    star.className = "pony-spark";
    star.style.setProperty("--x", spark.x + "%");
    star.style.setProperty("--y", spark.y + "%");
    star.style.setProperty("--s", spark.s + "px");
    star.style.setProperty("--c", spark.c);
    star.style.setProperty("--d", spark.d + "s");
    root.append(star);
  }

  const img = document.createElement("img");
  img.className = "pony-img";
  img.src = PONY_SRC;
  img.alt = "";
  img.draggable = false;
  img.addEventListener("error", () => {
    broken = true;
  });
  root.append(img);

  bubble = document.createElement("div");
  bubble.className = "pony-bubble";
  root.append(bubble);

  document.body.append(root);
  return root;
}

function pickLine() {
  let i;
  do {
    i = Math.floor(Math.random() * LINES.length);
  } while (LINES.length > 1 && i === lastLine);
  lastLine = i;
  return LINES[i];
}

function sayLine() {
  bubble.classList.remove("say");
  bubble.textContent = pickLine();
  void bubble.offsetWidth; 
  bubble.classList.add("say");
}

function showPony() {
  if (broken) return;
  if (!scene) scene = createScene();
  clearTimeout(hideTimer);
  clearTimeout(sayTimer);
  if (!scene.classList.contains("show")) {
    void scene.offsetWidth; // облачко с текстом вылазит каждое нажатие 
    scene.classList.add("show");
    sayTimer = setTimeout(sayLine, SAY_DELAY_MS); // облачко вылазит когда пони уже полностью выехала 
  } else {
    sayLine(); // новая реплика каждый клик и обновление таймера
  }
  hideTimer = setTimeout(() => {
    bubble.classList.remove("say");
    scene.classList.remove("show");
  }, HIDE_AFTER_MS);
}

document.addEventListener("click", (e) => {
  if (isBrandClick(e.target)) showPony();
});

