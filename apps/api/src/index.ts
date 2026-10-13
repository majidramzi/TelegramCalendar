import { config } from "./config.js";
import { buildApp } from "./app.js";

async function main() {
  const app = await buildApp();
  const host = config.host();
  const port = config.port();
  await app.listen({ host, port });
  console.log(`API listening on http://${host}:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
