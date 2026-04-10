import { createServer } from "node:http";

import { loadEnv } from "./config/env.js";
import { createApp } from "./http/create-app.js";
import { createOrchestrationHost } from "./orchestrator/host-factory.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const host = createOrchestrationHost(env);

  const app = createApp(host);
  const server = createServer(app);
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    server.close();
    await host.dispose();
  };

  server.listen(env.PORT, () => {
    console.log(`HTTP orchestrator listening on http://localhost:${env.PORT}`);
  });

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
