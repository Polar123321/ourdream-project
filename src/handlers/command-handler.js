const logger = require("../utils/logger");
const { discoverCommandModules } = require("../utils/command-registry");

function loadCommands(client) {
  const { discovered, errors } = discoverCommandModules();

  if (discovered.length === 0 && errors.length === 0) {
    logger.warn("Pasta de comandos nao encontrada ou vazia.");
    return;
  }

  for (const item of discovered) {
    if (client.commands.has(item.commandName)) {
      logger.warn(
        `Comando duplicado ignorado (${item.commandName}): ${item.filePath}`
      );
      continue;
    }

    item.command.category = item.category;
    client.commands.set(item.commandName, item.command);
  }

  for (const loadError of errors) {
    logger.warn(
      `Falha ao carregar comando (${loadError.filePath}): ${loadError.message}`
    );
  }

  logger.info(`${client.commands.size} comando(s) carregado(s).`);
}

module.exports = { loadCommands };
