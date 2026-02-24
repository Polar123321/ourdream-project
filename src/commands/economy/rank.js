const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const { getGuildRankingSnapshot } = require("../../utils/economy-store");

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR").format(Math.max(0, Number(value) || 0));
}

async function resolveDisplayName(interaction, userId) {
  const cachedMember = interaction.guild.members.cache.get(userId);

  if (cachedMember) {
    return cachedMember.displayName;
  }

  const fetchedMember = await interaction.guild.members.fetch(userId).catch(() => null);

  if (fetchedMember) {
    return fetchedMember.displayName;
  }

  return `Usuario ${userId}`;
}

function medalForRank(rank) {
  if (rank === 1) {
    return "??";
  }

  if (rank === 2) {
    return "??";
  }

  if (rank === 3) {
    return "??";
  }

  return `#${rank}`;
}

module.exports = {
  category: "economia",
  cooldownMs: 2200,
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Mostra o ranking de economia do servidor.")
    .setDMPermission(false)
    .addStringOption((option) =>
      option
        .setName("periodo")
        .setDescription("Qual periodo do ranking")
        .setRequired(false)
        .addChoices(
          { name: "Global", value: "global" },
          { name: "Semanal", value: "weekly" },
          { name: "Mensal", value: "monthly" }
        )
    ),
  async execute(interaction) {
    const period = interaction.options.getString("periodo") || "global";
    const ranking = getGuildRankingSnapshot(
      interaction.guildId,
      period,
      interaction.user.id
    );

    if (!ranking.ok) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Ranking",
            title: "Nao foi possivel carregar",
            description: "Nao consegui consultar o ranking deste servidor agora."
          },
          true
        )
      );
      return;
    }

    if (ranking.topEntries.length === 0) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "warning",
            eyebrow: "Ranking",
            title: "Sem dados suficientes",
            description: `Ainda nao ha pontuacao para o periodo ${ranking.period.label.toLowerCase()}.`
          },
          true
        )
      );
      return;
    }

    const lines = [];

    for (const entry of ranking.topEntries) {
      const displayName = await resolveDisplayName(interaction, entry.userId);
      lines.push(
        `${medalForRank(entry.rank)} **${displayName}** - ${formatPoints(entry.score)} pontos`
      );
    }

    const viewerPosition = ranking.viewer.position
      ? `#${ranking.viewer.position} - ${formatPoints(ranking.viewer.score)} pontos`
      : "Sem pontuacao neste periodo";

    const gapText =
      typeof ranking.viewer.differenceToNext === "number"
        ? `${formatPoints(ranking.viewer.differenceToNext)} pontos`
        : "-";

    await interaction.reply(
      createCv2Reply(
        interaction,
        {
          tone: "info",
          eyebrow: "Ranking",
          title: `Top economia | ${ranking.period.label}`,
          description: `Participantes com pontuacao: ${ranking.totalParticipants}`,
          fields: [
            {
              name: "Top 10",
              value: lines.join("\n")
            },
            {
              name: "Sua posicao",
              value: viewerPosition
            },
            {
              name: "Diferenca para subir",
              value: gapText
            }
          ]
        },
        true
      )
    );
  }
};
