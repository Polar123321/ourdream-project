const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const { sanitizeInlineText } = require("../../utils/sanitize");

const CATEGORY_LABELS = {
  general: "Geral",
  moderation: "Moderacao",
  actions: "Acoes",
  economia: "Economia",
  economy: "Economia"
};

function normalizeCategory(rawCategory) {
  const value = String(rawCategory || "general").trim().toLowerCase();
  return value || "general";
}

function toCategoryLabel(category) {
  if (CATEGORY_LABELS[category]) {
    return CATEGORY_LABELS[category];
  }

  return category.charAt(0).toUpperCase() + category.slice(1);
}

function formatCommandLine(command) {
  const name = sanitizeInlineText(command.data.name, { maxLength: 32 });
  const description = sanitizeInlineText(command.data.description, {
    maxLength: 140
  });

  return `- \`/${name}\` - ${description}`;
}

module.exports = {
  category: "general",
  cooldownMs: 1500,
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Lista os comandos disponiveis."),
  async execute(interaction, client) {
    const allCommands = Array.from(client.commands.values()).sort((a, b) =>
      a.data.name.localeCompare(b.data.name, "pt-BR")
    );

    const grouped = new Map();

    for (const command of allCommands) {
      const category = normalizeCategory(command.category);
      const group = grouped.get(category) || [];
      group.push(command);
      grouped.set(category, group);
    }

    const fields = Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
      .map(([category, commands]) => ({
        name: toCategoryLabel(category),
        value:
          commands.length > 0
            ? commands.map(formatCommandLine).join("\n")
            : "Nenhum comando registrado nesta categoria."
      }));

    await interaction.reply(
      createCv2Reply(
        interaction,
        {
          tone: "info",
          eyebrow: "Central de comandos",
          title: "Tudo que voce pode usar",
          description:
            "Escolha um comando da lista abaixo e use com barra. O painel se adapta automaticamente aos comandos carregados.",
          fields,
          footer: `Total: ${allCommands.length} comando(s)`
        },
        true
      )
    );
  }
};
