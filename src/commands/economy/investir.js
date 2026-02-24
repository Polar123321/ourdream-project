const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const { investPoints } = require("../../utils/economy-store");

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR").format(Math.max(0, Number(value) || 0));
}

module.exports = {
  category: "economia",
  cooldownMs: 2500,
  data: new SlashCommandBuilder()
    .setName("investir")
    .setDescription("Aplica pontos na carteira de investimento.")
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName("valor")
        .setDescription("Quantidade de pontos para investir")
        .setRequired(true)
        .setMinValue(1)
    ),
  async execute(interaction) {
    const amount = interaction.options.getInteger("valor", true);
    const result = investPoints(interaction.user.id, interaction.guildId, amount);

    if (!result.ok) {
      if (result.reason === "INSUFFICIENT_POINTS") {
        await interaction.reply(
          createCv2Reply(
            interaction,
            {
              tone: "warning",
              eyebrow: "Investimentos",
              title: "Saldo insuficiente",
              description: "Voce nao tem pontos suficientes para essa aplicacao.",
              fields: [
                { name: "Tentativa", value: `${formatPoints(amount)} pontos` },
                { name: "Seu saldo", value: `${formatPoints(result.points)} pontos` },
                { name: "Faltam", value: `${formatPoints(result.missingPoints || 0)} pontos` }
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
            eyebrow: "Investimentos",
            title: "Nao foi possivel investir",
            description: "Falha ao validar a aplicacao de pontos."
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
          eyebrow: "Investimentos",
          title: "Aplicacao concluida",
          description: `${formatPoints(result.depositedAmount)} pontos enviados para a carteira de investimento.`,
          fields: [
            { name: "Carteira investida", value: `${formatPoints(result.portfolio.balance)} pontos` },
            { name: "Principal em risco", value: `${formatPoints(result.portfolio.principalNet)} pontos` },
            { name: "Saldo em carteira", value: `${formatPoints(result.points)} pontos` },
            {
              name: "Valor de saque hoje",
              value: `${formatPoints(result.portfolio.withdrawableToday)} pontos`
            }
          ]
        },
        true
      )
    );
  }
};
