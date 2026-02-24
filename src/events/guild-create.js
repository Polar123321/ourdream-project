const logger = require("../utils/logger");
const { getInflationSnapshot } = require("../utils/economy-store");

module.exports = {
  name: "guildCreate",
  execute(guild) {
    logger.info(`Bot adicionado em: ${guild.name} (${guild.id})`);
    getInflationSnapshot(guild.id);
  }
};
