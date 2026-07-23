import { buildApp } from "./app.js"

const app = buildApp()

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down API")
  await app.close()
}

process.once("SIGINT", () => {
  void shutdown("SIGINT")
})

process.once("SIGTERM", () => {
  void shutdown("SIGTERM")
})

try {
  const address = await app.listen({
    host: app.config.host,
    port: app.config.port,
  })
  app.log.info({ address }, "Flux API started")
} catch (error) {
  app.log.fatal({ err: error }, "Failed to start Flux API")
  process.exitCode = 1
  await app.close()
}
