const logger = require("../utils/logger");
const { startInflationAnnouncer } = require("../utils/inflation-announcer");

module.exports = {
  name: "ready",
  once: true,
  execute(client) {
    logger.info(`Bot conectado como ${client.user.tag}`);
    startInflationAnnouncer(client);
  }
};
