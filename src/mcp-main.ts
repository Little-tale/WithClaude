import { loadEnv } from "./config/env.js";
import { startMcpServer } from "./mcp/server.js";
import { createOrchestrationHost } from "./orchestrator/host-factory.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const host = createOrchestrationHost(env);

  await startMcpServer(host);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
