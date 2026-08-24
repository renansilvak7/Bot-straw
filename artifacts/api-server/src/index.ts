import app from "./app";
import { logger } from "./lib/logger";
import { startDiscordBot } from "./discord-bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function startProductionKeepAlive(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const intervalMs = Number(process.env.KEEP_ALIVE_INTERVAL_MS ?? 30_000);
  const interval = setInterval(() => {
    void fetch(`http://127.0.0.1:${port}/api/healthz`).catch((error) => {
      logger.warn({ err: error }, "Keep-alive do serviço falhou");
    });
  }, intervalMs);

  logger.info({ intervalMs }, "Keep-alive de produção ativado");
  interval.unref();
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startProductionKeepAlive();
  void startDiscordBot().catch((error) => {
    logger.error({ err: error }, "Falha ao iniciar o bot do Discord");
  });
});
