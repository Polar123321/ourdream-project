const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const {
  getInvestmentPortfolio,
  withdrawInvestment,
  INVESTMENT_WITHDRAW_FEE_PERCENT
} = require("../../utils/economy-store");

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR").format(Math.max(0, Number(value) || 0));
}

function toHistoryText(portfolio) {
  if (!Array.isArray(portfolio?.history) || portfolio.history.length === 0) {
    return "Sem movimentacoes recentes.";
  }

  return portfolio.history
    .slice(0, 6)
    .map((entry) => {
      const signal = entry.amount >= 0 ? "+" : "";
      const dayText = entry.dayKey || "-";
      return `${dayText} | ${entry.type}: ${signal}${formatPoints(entry.amount)} pontos`;
    })
    .join("\n");
}

module.exports = {
  category: "economia",
  cooldownMs: 2200,
  data: new SlashCommandBuilder()
    .setName("carteira")
    .setDescription("Mostra (e opcionalmente saca) sua carteira de investimentos.")
    .setDMPermission(false)
    .addIntegerOption((option) =>
      option
        .setName("sacar")
        .setDescription("Valor para sacar agora da carteira investida")
        .setRequired(false)
        .setMinValue(1)
    ),
  async execute(interaction) {
    const withdrawAmount = interaction.options.getInteger("sacar");

    if (withdrawAmount && withdrawAmount > 0) {
      const withdrawResult = withdrawInvestment(
        interaction.user.id,
        interaction.guildId,
        withdrawAmount
      );

      if (!withdrawResult.ok) {
        if (withdrawResult.reason === "INSUFFICIENT_INVESTMENT_BALANCE") {
          await interaction.reply(
            createCv2Reply(
              interaction,
              {
                tone: "warning",
                eyebrow: "Investimentos",
                title: "Saldo investido insuficiente",
                description: "O valor solicitado e maior que sua carteira investida.",
                fields: [
                  { name: "Solicitado", value: `${formatPoints(withdrawAmount)} pontos` },
                  { name: "Disponivel", value: `${formatPoints(withdrawResult.available || 0)} pontos` },
                  { name: "Faltam", value: `${formatPoints(withdrawResult.missing || 0)} pontos` }
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
              title: "Nao foi possivel sacar",
              description: "Falha ao processar o saque neste momento."
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
            title: "Saque concluido",
            description: `${formatPoints(withdrawResult.netAmount)} pontos voltaram para sua carteira principal.`,
            fields: [
              { name: "Saque bruto", value: `${formatPoints(withdrawResult.grossAmount)} pontos` },
              {
                name: `Taxa (${INVESTMENT_WITHDRAW_FEE_PERCENT}%)`,
                value: `${formatPoints(withdrawResult.fee)} pontos`
              },
              { name: "Liquido recebido", value: `${formatPoints(withdrawResult.netAmount)} pontos` },
              {
                name: "Investido restante",
                value: `${formatPoints(withdrawResult.portfolio.balance)} pontos`
              },
              { name: "Saldo em carteira", value: `${formatPoints(withdrawResult.points)} pontos` }
            ]
          },
          true
        )
      );

      return;
    }

    const snapshot = getInvestmentPortfolio(interaction.user.id, interaction.guildId);

    if (!snapshot.ok) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Investimentos",
            title: "Carteira indisponivel",
            description: "Nao consegui carregar seus dados de investimento agora."
          },
          true
        )
      );
      return;
    }

    const portfolio = snapshot.portfolio;

    await interaction.reply(
      createCv2Reply(
        interaction,
        {
          tone: "info",
          eyebrow: "Investimentos",
          title: "Sua carteira de investimentos",
          description:
            `Aplicacoes sofrem variacao diaria com risco de perda e saque com taxa de ${INVESTMENT_WITHDRAW_FEE_PERCENT}%.`,
          fields: [
            { name: "Saldo investido", value: `${formatPoints(portfolio.balance)} pontos` },
            { name: "Principal em risco", value: `${formatPoints(portfolio.principalNet)} pontos` },
            {
              name: "Lucro/Prejuizo acumulado",
              value: `${portfolio.totalYield >= 0 ? "+" : ""}${formatPoints(portfolio.totalYield)} pontos`
            },
            {
              name: "Valor de saque hoje",
              value: `${formatPoints(portfolio.withdrawableToday)} pontos`
            },
            {
              name: "Ultima atualizacao diaria",
              value: portfolio.lastAppliedDayKey || "-"
            },
            {
              name: "Historico curto",
              value: toHistoryText(portfolio)
            }
          ]
        },
        true
      )
    );
  }
};
