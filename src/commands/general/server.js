const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const { assertAllowedUrl } = require("../../utils/http-client");

function safeMediaUrl(url) {
  if (!url) {
    return null;
  }

  try {
    return assertAllowedUrl(url, "media");
  } catch {
    return null;
  }
}

module.exports = {
  category: "general",
  cooldownMs: 2000,
  data: new SlashCommandBuilder()
    .setName("server")
    .setDescription("Mostra informacoes do servidor atual.")
    .setDMPermission(false),
  async execute(interaction) {
    const { guild } = interaction;

    if (!guild) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Este comando so funciona em servidor",
            description: "Abra um canal do servidor e rode /server novamente."
          },
          true
        )
      );
      return;
    }

    const owner = await guild.fetchOwner().catch(() => null);
    const iconUrl = safeMediaUrl(
      guild.iconURL({ size: 2048, extension: "png", forceStatic: true })
    );
    const bannerUrl = safeMediaUrl(
      guild.bannerURL({ size: 2048, extension: "png", forceStatic: true })
    );
    const createdAt = Math.floor(guild.createdTimestamp / 1000);
    const actions = [];

    if (iconUrl) {
      actions.push({ label: "Icone", url: iconUrl });
    }

    if (bannerUrl) {
      actions.push({ label: "Banner", url: bannerUrl });
    }

    await interaction.reply(
      createCv2Reply(interaction, {
        tone: "info",
        eyebrow: "Servidor",
        title: guild.name,
        description: "Visao geral do servidor e recursos disponiveis.",
        fields: [
          { name: "ID", value: guild.id },
          { name: "Dono", value: owner ? `<@${owner.id}>` : "Nao disponivel" },
          { name: "Membros", value: String(guild.memberCount) },
          { name: "Canais", value: String(guild.channels.cache.size) },
          { name: "Cargos", value: String(guild.roles.cache.size) },
          { name: "Criado em", value: `<t:${createdAt}:D> (<t:${createdAt}:R>)` }
        ],
        thumbnail: iconUrl || undefined,
        image: bannerUrl || undefined,
        imageAlt: "server-banner",
        mediaFallbackText: "Sem banner valido para exibir no momento.",
        actions,
        footer: `Shard ${guild.shardId ?? 0}`
      })
    );
  }
};
