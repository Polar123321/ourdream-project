const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const {
  claimDailyReward,
  DAILY_REWARD_BASE_POINTS
} = require("../../utils/economy-store");

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR").format(Math.max(0, Number(value) || 0));
}

module.exports = {
  category: "economia",
  cooldownMs: 1500,
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Resgata sua recompensa diaria com streak.")
    .setDMPermission(false),
  async execute(interaction) {
    const result = claimDailyReward(interaction.user.id, interaction.guildId);

    if (!result.ok) {
      if (result.reason === "ALREADY_CLAIMED") {
        await interaction.reply(
          createCv2Reply(
            interaction,
            {
              tone: "warning",
              eyebrow: "Daily",
              title: "Ja resgatado hoje",
              description: `Voce ja pegou o daily de hoje. Volte <t:${result.nextClaimAtUnix}:R>.`,
              fields: [
                {
                  name: "Streak atual",
                  value: `${result.streak} dia(s)`
                }
              ]
            },
            true
          )
        );
        return;
      }

      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Daily",
            title: "Falha ao resgatar",
            description: "Nao consegui processar sua recompensa diaria agora."
          },
          true
        )
      );
      return;
    }

    await interaction.reply(
      createCv2Reply(
        interaction,
        {
          tone: "success",
          eyebrow: "Daily",
          title: "Daily resgatado",
          description: `+${formatPoints(result.awardedPoints)} pontos adicionados com sucesso.`,
          fields: [
            { name: "Recompensa base", value: `${formatPoints(DAILY_REWARD_BASE_POINTS)} pontos` },
            { name: "Bonus de streak", value: `+${result.bonusPercent}%` },
            { name: "Streak atual", value: `${result.streak} dia(s)` },
            { name: "Maior streak", value: `${result.bestStreak} dia(s)` },
            { name: "Proximo bonus", value: `+${result.nextBonusPercent}%` },
            { name: "Saldo atual", value: `${formatPoints(result.points)} pontos` }
          ],
          footer: `Proximo resgate em <t:${result.nextClaimAtUnix}:R>`
        },
        true
      )
    );
  }
};
