const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const { assertAllowedUrl } = require("../../utils/http-client");

const AVATAR_SIZES = [256, 512, 1024, 2048, 4096];

function buildAvatarUrl(source, { size, extension, animated }) {
  const url = source.displayAvatarURL({
    size,
    extension,
    forceStatic: extension !== "gif" || !animated
  });

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
    .setName("avatar")
    .setDescription("Mostra o avatar de um usuario em alta qualidade.")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuario alvo")
        .setRequired(false)
    )
    .addIntegerOption((option) => {
      option
        .setName("tamanho")
        .setDescription("Resolucao da imagem")
        .setRequired(false);

      for (const size of AVATAR_SIZES) {
        option.addChoices({ name: `${size}px`, value: size });
      }

      return option;
    })
    .addBooleanOption((option) =>
      option
        .setName("servidor")
        .setDescription("Prioriza avatar do servidor quando existir")
        .setRequired(false)
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser("usuario") || interaction.user;
    const size = interaction.options.getInteger("tamanho") || 1024;
    const preferGuildAvatar = interaction.options.getBoolean("servidor") ?? true;

    let targetMember = null;

    if (interaction.inGuild()) {
      targetMember = await interaction.guild.members
        .fetch(targetUser.id)
        .catch(() => null);
    }

    const hasGuildAvatar = Boolean(targetMember?.avatar);
    const useGuildAvatar = Boolean(preferGuildAvatar && hasGuildAvatar);
    const source = useGuildAvatar ? targetMember : targetUser;
    const isAnimated = useGuildAvatar
      ? Boolean(targetMember?.avatar?.startsWith("a_"))
      : Boolean(targetUser.avatar?.startsWith("a_"));
    const sourceLabel = useGuildAvatar ? "Servidor" : "Global";

    const previewUrl = buildAvatarUrl(source, {
      size,
      extension: isAnimated ? "gif" : "png",
      animated: isAnimated
    });
    const thumbnailUrl = buildAvatarUrl(targetUser, {
      size: 256,
      extension: "png",
      animated: false
    });

    const actions = [];

    for (const extension of ["png", "jpg", "webp"]) {
      const url = buildAvatarUrl(source, {
        size,
        extension,
        animated: false
      });

      if (url) {
        actions.push({ label: extension.toUpperCase(), url });
      }
    }

    if (isAnimated) {
      const gifUrl = buildAvatarUrl(source, {
        size,
        extension: "gif",
        animated: true
      });

      if (gifUrl) {
        actions.push({ label: "GIF", url: gifUrl });
      }
    }

    if (hasGuildAvatar) {
      if (useGuildAvatar) {
        const globalAvatar = buildAvatarUrl(targetUser, {
          size,
          extension: "png",
          animated: false
        });

        if (globalAvatar) {
          actions.push({ label: "Global", url: globalAvatar });
        }
      } else if (targetMember) {
        const guildAvatar = buildAvatarUrl(targetMember, {
          size,
          extension: "png",
          animated: false
        });

        if (guildAvatar) {
          actions.push({ label: "Servidor", url: guildAvatar });
        }
      }
    }

    const fields = [
      { name: "Usuario", value: `<@${targetUser.id}>` },
      { name: "ID", value: targetUser.id },
      { name: "Fonte", value: sourceLabel },
      { name: "Resolucao", value: `${size}px` },
      { name: "Animado", value: isAnimated ? "Sim" : "Nao" }
    ];

    if (!previewUrl) {
      fields.push({
        name: "Visual",
        value: "A URL da imagem foi bloqueada pela politica de seguranca."
      });
    }

    await interaction.reply(
      createCv2Reply(interaction, {
        tone: previewUrl ? "info" : "warning",
        eyebrow: "Avatar",
        title: `Avatar de ${targetUser.username}`,
        description:
          "Escolha o formato nos botoes abaixo para abrir a imagem em tamanho real.",
        fields,
        thumbnail: thumbnailUrl || undefined,
        image: previewUrl || undefined,
        imageAlt: `avatar-${targetUser.id}`,
        mediaFallbackText: "Nao foi possivel montar a pre-visualizacao agora.",
        actions
      })
    );
  }
};
