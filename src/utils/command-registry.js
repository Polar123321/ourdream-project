const fs = require("node:fs");
const path = require("node:path");

function discoverCommandModules(basePath) {
  const commandsPath =
    basePath || path.join(__dirname, "..", "commands");
  const discovered = [];
  const errors = [];

  if (!fs.existsSync(commandsPath)) {
    return { discovered, errors };
  }

  const folders = fs
    .readdirSync(commandsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const folder of folders) {
    const folderPath = path.join(commandsPath, folder);
    const commandFiles = fs
      .readdirSync(folderPath)
      .filter((file) => file.endsWith(".js"));

    for (const file of commandFiles) {
      const filePath = path.join(folderPath, file);

      try {
        const command = require(filePath);

        if (!command?.data || typeof command?.execute !== "function") {
          errors.push({
            filePath,
            message: "Comando invalido: exporte data e execute."
          });
          continue;
        }

        const serialized = command.data.toJSON();
        const commandName = serialized?.name;

        if (!commandName) {
          errors.push({
            filePath,
            message: "Comando sem nome no SlashCommandBuilder."
          });
          continue;
        }

        discovered.push({
          commandName,
          category: command.category || folder,
          filePath,
          serialized,
          command
        });
      } catch (error) {
        errors.push({
          filePath,
          message: error?.message || "Erro ao carregar modulo."
        });
      }
    }
  }

  return { discovered, errors };
}

module.exports = {
  discoverCommandModules
};
