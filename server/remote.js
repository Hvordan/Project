
// сохранение колод в turso
const config = () => ({
  url: (process.env.TURSO_DATABASE_URL || "").trim(),
  token: (process.env.TURSO_AUTH_TOKEN || "").trim(),
});

export const remoteEnabled = () => Boolean(config().url && config().token);

function endpoint() {

  const base = config()
    .url.replace(/^(libsql|wss?|https?):\/\//, "https://")
    .replace(/\/+$/, "");
  return base + "/v2/pipeline";
}

const arg = (value) =>
  value === null || value === undefined
    ? { type: "null" }
    : typeof value === "number"
      ? { type: "integer", value: String(value) }
      : { type: "text", value: String(value) };


async function run(statements) {
  const res = await fetch(endpoint(), {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: "Bearer " + config().token, "content-type": "application/json" },
    body: JSON.stringify({
      requests: [
        ...statements.map(({ sql, args = [] }) => ({
          type: "execute",
          stmt: { sql, args: args.map(arg) },
        })),
        { type: "close" },
      ],
    }),
  });
  if (!res.ok) throw new Error("Turso відповів " + res.status + ": " + (await res.text()).slice(0, 200));
  const data = await res.json();
  const results = [];
  for (const item of data.results || []) {
    if (item.type === "error") throw new Error("Turso: " + (item.error?.message || "помилка запиту"));
    if (item.response?.type === "execute") results.push(item.response.result);
  }
  return results;
}

const cell = (c) => (c && c.type !== "null" ? c.value : null);

// создает таблицу колод
export async function remoteInit() {
  await run([
    {
      sql: "CREATE TABLE IF NOT EXISTS decks(id TEXT PRIMARY KEY, owner TEXT NOT NULL, state TEXT NOT NULL, shared INTEGER NOT NULL DEFAULT 0)",
    },
  ]);
}


export async function remoteAll() {
  const [result] = await run([{ sql: "SELECT id, owner, state, shared FROM decks" }]);
  return (result?.rows || []).map((r) => ({
    id: cell(r[0]),
    owner: cell(r[1]),
    state: cell(r[2]),
    shared: Number(cell(r[3])) === 1 ? 1 : 0,
  }));
}

const upsert =
  "INSERT INTO decks(id, owner, state, shared) VALUES (?,?,?,?) " +
  "ON CONFLICT(id) DO UPDATE SET owner=excluded.owner, state=excluded.state, shared=excluded.shared";

// сохранение колоды
export async function remoteSaveMany(rows) {
  for (let i = 0; i < rows.length; i += 20) {
    await run(
      rows.slice(i, i + 20).map((r) => ({
        sql: upsert,
        args: [r.id, r.owner, r.state, Number(r.shared) === 1 ? 1 : 0],
      })),
    );
  }
}

export const remoteSave = (row) => remoteSaveMany([row]);

export async function remoteDelete(id) {
  await run([{ sql: "DELETE FROM decks WHERE id=?", args: [id] }]);
}
