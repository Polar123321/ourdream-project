const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const { sanitizeInlineText } = require("../../utils/sanitize");

function safeReason(rawReason) {
  return sanitizeInlineText(rawReason || "Sem motivo informado", {
    maxLength: 300,
    fallback: "Sem motivo informado"
  });
}

module.exports = {
  category: "moderation",
  cooldownMs: 3500,
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Expulsa um membro do servidor.")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Membro que sera expulso")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("motivo")
        .setDescription("Motivo da expulsao")
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false),
  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Este comando so funciona em servidor",
            description: "Abra um canal do servidor e rode /kick novamente."
          },
          true
        )
      );
      return;
    }

    const targetUser = interaction.options.getUser("usuario", true);
    const reason = safeReason(interaction.options.getString("motivo"));
    const targetMember = await interaction.guild.members
      .fetch(targetUser.id)
      .catch(() => null);

    if (!targetMember) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Membro nao encontrado",
            description: "Nao consegui localizar esse usuario neste servidor."
          },
          true
        )
      );
      return;
    }

    if (targetMember.id === interaction.user.id) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "warning",
            title: "Acao bloqueada",
            description: "Voce nao pode expulsar a si mesmo."
          },
          true
        )
      );
      return;
    }

    if (targetMember.id === interaction.client.user.id) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "warning",
            title: "Acao bloqueada",
            description: "Eu nao posso me expulsar do servidor."
          },
          true
        )
      );
      return;
    }

    if (targetMember.id === interaction.guild.ownerId) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Acao nao permitida",
            description: "Nao e possivel expulsar o dono do servidor."
          },
          true
        )
      );
      return;
    }

    const moderatorMember = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    const me = interaction.guild.members.me;

    if (
      moderatorMember &&
      interaction.guild.ownerId !== interaction.user.id &&
      moderatorMember.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0
    ) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Hierarquia insuficiente",
            description:
              "Voce so pode expulsar membros com cargo abaixo do seu."
          },
          true
        )
      );
      return;
    }

    if (
      !me ||
      me.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0 ||
      !targetMember.kickable
    ) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Nao consigo expulsar este membro",
            description:
              "Revise a hierarquia de cargos e a permissao `KickMembers` do bot."
          },
          true
        )
      );
      return;
    }

    try {
      await targetMember.kick(reason);
    } catch (error) {
      const description =
        error?.code === 50013
          ? "Estou sem permissao para concluir essa expulsao."
          : "Nao consegui expulsar o membro agora. Tente novamente em instantes.";

      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Falha ao expulsar",
            description
          },
          true
        )
      );
      return;
    }

    await interaction.reply(
      createCv2Reply(interaction, {
        tone: "success",
        eyebrow: "Moderacao",
        title: "Membro expulso",
        description: `${targetUser.tag} foi removido do servidor.`,
        fields: [
          { name: "Alvo", value: `${targetUser.tag} (${targetUser.id})` },
          { name: "Moderador", value: `<@${interaction.user.id}>` },
          { name: "Motivo", value: reason }
        ],
        thumbnail: targetUser.displayAvatarURL({
          size: 256,
          extension: "png",
          forceStatic: true
        })
      })
    );
  }
};
