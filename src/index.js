const { Client, Collection, GatewayIntentBits } = require("discord.js");

const config = require("./config");
const { loadCommands } = require("./handlers/command-handler");
const { loadEvents } = require("./handlers/event-handler");
const logger = require("./utils/logger");

if (!config.token) {
  logger.error(
    "DISCORD_TOKEN nao definido. Configure o token no arquivo .env."
  );
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ]
});

client.commands = new Collection();

loadCommands(client);
loadEvents(client);

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection detectada.", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception detectada.", error);
});

client.login(config.token).catch((error) => {
  logger.error("Falha ao conectar no Discord.", error);
  process.exit(1);
});
