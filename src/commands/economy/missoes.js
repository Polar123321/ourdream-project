const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const {
  getDailyMissionStatus,
  DAILY_MISSION_ALL_COMPLETED_BONUS_POINTS
} = require("../../utils/economy-store");

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR").format(Math.max(0, Number(value) || 0));
}

function toMissionLine(mission) {
  const icon = mission.completed ? "?" : "?";
  return `${icon} ${mission.label} (${mission.progress}/${mission.target} | ${mission.completionPercent}%)`;
}

module.exports = {
  category: "economia",
  cooldownMs: 1200,
  data: new SlashCommandBuilder()
    .setName("missoes")
    .setDescription("Mostra o progresso das missoes diarias de economia.")
    .setDMPermission(false),
  async execute(interaction) {
    const missionData = getDailyMissionStatus(interaction.user.id, interaction.guildId);

    if (!missionData.ok) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Missoes",
            title: "Nao consegui carregar",
            description: "Tente novamente em alguns instantes."
          },
          true
        )
      );
      return;
    }

    const status = missionData.status;
    const missionText = status.missions.map(toMissionLine).join("\n");
    const completedText = `${status.completedCount}/${status.missions.length}`;

    await interaction.reply(
      createCv2Reply(
        interaction,
        {
          tone: status.allCompleted ? "success" : "info",
          eyebrow: "Missoes diarias",
          title: status.allCompleted ? "Todas as missoes concluidas" : "Progresso diario",
          description: `Reset em <t:${missionData.nextResetAtUnix}:R>.`,
          fields: [
            { name: "Checklist", value: missionText },
            { name: "Concluidas", value: completedText },
            {
              name: "Recompensa total do dia",
              value: `${formatPoints(status.totalAwardedToday)} pontos`
            },
            {
              name: "Bonus por fechar tudo",
              value: status.allCompletedBonusGranted
                ? `Recebido (+${formatPoints(DAILY_MISSION_ALL_COMPLETED_BONUS_POINTS)})`
                : `Pendente (+${formatPoints(DAILY_MISSION_ALL_COMPLETED_BONUS_POINTS)})`
            }
          ]
        },
        true
      )
    );
  }
};
