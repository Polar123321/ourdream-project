const fs = require("node:fs");
const path = require("node:path");

const logger = require("../utils/logger");

function loadEvents(client) {
  const eventsPath = path.join(__dirname, "..", "events");

  if (!fs.existsSync(eventsPath)) {
    logger.warn("Pasta de eventos nao encontrada.");
    return;
  }

  const eventFiles = fs
    .readdirSync(eventsPath)
    .filter((file) => file.endsWith(".js"));

  let loaded = 0;

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);

    try {
      const event = require(filePath);

      if (!event?.name || typeof event?.execute !== "function") {
        logger.warn(`Evento invalido ignorado: ${filePath}`);
        continue;
      }

      if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
      } else {
        client.on(event.name, (...args) => event.execute(...args, client));
      }

      loaded += 1;
    } catch (error) {
      logger.error(`Falha ao carregar evento (${filePath}).`, error);
    }
  }

  logger.info(`${loaded} evento(s) carregado(s).`);
}

module.exports = { loadEvents };
