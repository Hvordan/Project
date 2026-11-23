import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { createGameServer } from "./app.js";

const filename =
  process.env.DB_PATH || fileURLToPath(new URL("../data/equestria.sqlite", import.meta.url));
mkdirSync(dirname(resolve(filename)), { recursive: true });
const argValue = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
};
const port = Number(argValue("--port") || process.env.PORT || 3000);
const host = argValue("--host") || "0.0.0.0";
const game = createGameServer(filename);
game.http.listen(port, host, () => {
  console.log("Таємні знаки Еквестрії — http://localhost:" + port);
  if (host !== "0.0.0.0") return;
  let interfaces;
  try {
    interfaces = networkInterfaces();
  } catch {
    return;
  } // Some managed hosts cannot enumerate local network interfaces.
  for (const list of Object.values(interfaces)) {
    for (const net of list || []) {
      if (net.family === "IPv4" && !net.internal)
        console.log("У спільній Wi-Fi мережі: http://" + net.address + ":" + port);
    }
  }
});
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => game.close());
