const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const {
  transferPoints,
  trackDailyMissionProgress
} = require("../../utils/economy-store");

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR").format(Math.max(0, Number(value) || 0));
}

module.exports = {
  category: "economia",
  cooldownMs: 2500,
  data: new SlashCommandBuilder()
    .setName("transferir")
    .setDescription("Transfere pontos para outro usuario.")
    .setDMPermission(false)
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuario que vai receber")
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName("quantidade")
        .setDescription("Quantidade de pontos para transferir")
        .setRequired(true)
        .setMinValue(1)
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser("usuario", true);
    const amount = interaction.options.getInteger("quantidade", true);

    if (targetUser.bot) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "warning",
            eyebrow: "Economia",
            title: "Transferencia bloqueada",
            description: "Nao e permitido transferir pontos para bots."
          },
          true
        )
      );
      return;
    }

    const result = transferPoints(interaction.user.id, targetUser.id, amount);

    if (!result.ok) {
      if (result.reason === "SELF_TRANSFER") {
        await interaction.reply(
          createCv2Reply(
            interaction,
            {
              tone: "warning",
              eyebrow: "Economia",
              title: "Transferencia invalida",
              description: "Voce nao pode transferir pontos para si mesmo."
            },
            true
          )
        );
        return;
      }

      if (result.reason === "INSUFFICIENT_POINTS") {
        await interaction.reply(
          createCv2Reply(
            interaction,
            {
              tone: "warning",
              eyebrow: "Economia",
              title: "Saldo insuficiente",
              description: "Voce nao tem pontos suficientes para essa transferencia.",
              fields: [
                { name: "Tentativa", value: `${formatPoints(amount)} pontos` },
                { name: "Seu saldo", value: `${formatPoints(result.points)} pontos` },
                {
                  name: "Faltam",
                  value: `${formatPoints(result.missingPoints || 0)} pontos`
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
            eyebrow: "Economia",
            title: "Nao foi possivel transferir",
            description: "A transferencia falhou por um erro de validacao."
          },
          true
        )
      );
      return;
    }

    const missionUpdate = trackDailyMissionProgress(
      interaction.user.id,
      interaction.guildId,
      "transfer_completed",
      1
    );
    const missionCompleted = (missionUpdate?.completedRewards || [])
      .map((entry) => entry.label)
      .filter(Boolean)
      .join(" | ");

    const fields = [
      { name: "Valor", value: `${formatPoints(result.amount)} pontos` },
      {
        name: "Seu saldo agora",
        value: `${formatPoints(result.senderPoints)} pontos`
      },
      {
        name: "Saldo de quem recebeu",
        value: `${formatPoints(result.receiverPoints)} pontos`
      }
    ];

    if (missionUpdate?.ok && missionUpdate.awardedPoints > 0) {
      fields.push({
        name: "Missoes diarias",
        value: [
          `+${formatPoints(missionUpdate.awardedPoints)} pontos recebidos`,
          missionCompleted ? `Concluidas: ${missionCompleted}` : "",
          missionUpdate.bonusGranted
            ? `Bonus diario +${formatPoints(missionUpdate.bonusRewardPoints)}`
            : ""
        ]
          .filter(Boolean)
          .join("\n")
      });
    }

    await interaction.reply(
      createCv2Reply(interaction, {
        tone: "success",
        eyebrow: "Economia",
        title: "Transferencia concluida",
        description: `<@${interaction.user.id}> transferiu ${formatPoints(
          result.amount
        )} pontos para <@${targetUser.id}>.`,
        fields
      })
    );
  }
};
