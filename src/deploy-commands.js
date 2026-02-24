const { REST, Routes } = require("discord.js");

const config = require("./config");
const logger = require("./utils/logger");
const { discoverCommandModules } = require("./utils/command-registry");

if (!config.token || !config.clientId) {
  logger.error("CLIENT_ID e DISCORD_TOKEN sao obrigatorios para deploy.");
  process.exit(1);
}

const { discovered, errors } = discoverCommandModules();

if (errors.length > 0) {
  for (const loadError of errors) {
    logger.error(
      `Falha ao preparar comando (${loadError.filePath}): ${loadError.message}`
    );
  }
  process.exit(1);
}

const names = new Set();
const commands = [];

for (const item of discovered) {
  if (names.has(item.commandName)) {
    logger.error(`Comando duplicado encontrado: /${item.commandName}`);
    process.exit(1);
  }

  names.add(item.commandName);
  commands.push(item.serialized);
}

const rest = new REST({ version: "10" }).setToken(config.token);

async function deploy() {
  try {
    if (config.guildId) {
      logger.info(
        `Deploy de ${commands.length} comando(s) para a guild ${config.guildId}.`
      );

      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands }
      );

      logger.info("Deploy por guild concluido.");
      return;
    }

    logger.info(
      `Deploy global de ${commands.length} comando(s). A propagacao pode levar ate 1 hora.`
    );

    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commands
    });

    logger.info("Deploy global concluido.");
  } catch (error) {
    logger.error("Erro ao fazer deploy dos comandos.", error);
    process.exit(1);
  }
}

deploy();
