const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require("discord.js");

const { createCv2Edit, createCv2Reply } = require("../../utils/cv2-components");

module.exports = {
  category: "moderation",
  cooldownMs: 4000,
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("Apaga ate 100 mensagens do canal atual.")
    .addIntegerOption((option) =>
      option
        .setName("quantidade")
        .setDescription("Numero de mensagens para apagar (1 a 100)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),
  async execute(interaction) {
    const amount = interaction.options.getInteger("quantidade", true);

    if (!interaction.inGuild() || !interaction.channel?.isTextBased()) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Canal invalido",
            description:
              "Use /clear em um canal de texto de servidor onde o bot possa gerenciar mensagens."
          },
          true
        )
      );
      return;
    }

    if (typeof interaction.channel.bulkDelete !== "function") {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Canal sem suporte",
            description:
              "Este tipo de canal nao permite limpeza em lote por API."
          },
          true
        )
      );
      return;
    }

    const me =
      interaction.guild.members.me ||
      (await interaction.guild.members.fetchMe().catch(() => null));
    const permissions = me?.permissionsIn(interaction.channel);

    if (
      !permissions ||
      !permissions.has([
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory
      ])
    ) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Permissoes insuficientes",
            description:
              "Preciso de `ManageMessages` e `ReadMessageHistory` neste canal para concluir a limpeza."
          },
          true
        )
      );
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    try {
      const deleted = await interaction.channel.bulkDelete(amount, true);
      const partial = deleted.size < amount;

      await interaction.editReply(
        createCv2Edit(interaction, {
          tone: partial ? "warning" : "success",
          eyebrow: "Moderacao",
          title: partial ? "Limpeza parcial" : "Limpeza concluida",
          description: partial
            ? "Parte das mensagens nao pode ser removida porque o Discord bloqueia exclusao em lote de mensagens antigas."
            : "Mensagens removidas com sucesso.",
          fields: [
            { name: "Solicitado", value: String(amount) },
            { name: "Removido", value: String(deleted.size) },
            { name: "Canal", value: `<#${interaction.channel.id}>` }
          ]
        })
      );
    } catch (error) {
      const description =
        error?.code === 50013
          ? "Nao tenho permissao para apagar mensagens neste canal."
          : "Falhei ao apagar mensagens agora. Verifique permissoes e tente novamente.";

      await interaction.editReply(
        createCv2Edit(interaction, {
          tone: "error",
          eyebrow: "Moderacao",
          title: "Nao foi possivel limpar",
          description
        })
      );
    }
  }
};
