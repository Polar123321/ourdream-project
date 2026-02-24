const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const {
  setInflationChannel,
  getInflationSnapshot
} = require("../../utils/economy-store");

module.exports = {
  category: "economia",
  cooldownMs: 2000,
  data: new SlashCommandBuilder()
    .setName("setarinflacaocanal")
    .setDescription("Define o canal para boletim diario de inflacao.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption((option) =>
      option
        .setName("canal")
        .setDescription("Canal de texto para publicar a inflacao diaria")
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    ),
  async execute(interaction) {
    if (!interaction.guildId) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Inflacao",
            title: "Comando indisponivel",
            description: "Use esse comando dentro de um servidor."
          },
          true
        )
      );
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Inflacao",
            title: "Permissao insuficiente",
            description: "Somente administradores podem definir o canal de inflacao."
          },
          true
        )
      );
      return;
    }

    const channel = interaction.options.getChannel("canal", true);

    try {
      setInflationChannel(interaction.guildId, channel.id);
      const snapshot = getInflationSnapshot(interaction.guildId);
      const signal = snapshot.dailyPercent >= 0 ? "+" : "";

      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "success",
            eyebrow: "Inflacao",
            title: "Canal configurado",
            description:
              "Boletins diarios de inflacao serao publicados automaticamente no canal definido.",
            fields: [
              { name: "Canal", value: `<#${channel.id}>` },
              { name: "Horario padrao", value: "09:00 (timezone configurada)" },
              {
                name: "Inflacao atual",
                value: `${signal}${snapshot.dailyPercent.toFixed(2)}%`
              }
            ]
          },
          true
        )
      );
    } catch (error) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Inflacao",
            title: "Falha ao configurar canal",
            description:
              "Nao consegui salvar o canal de inflacao. Verifique permissoes e tente novamente."
          },
          true
        )
      );
    }
  }
};
