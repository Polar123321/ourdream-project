const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const { BOOSTER_ITEMS } = require("../../data/shop-items");
const {
  getUserEconomy,
  getInflationSnapshot,
  MESSAGES_PER_REWARD,
  POINTS_PER_REWARD
} = require("../../utils/economy-store");

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR").format(Math.max(0, Number(value) || 0));
}

function isServerBooster(member) {
  return Boolean(member?.premiumSinceTimestamp || member?.premiumSince || member?.premium_since);
}

async function resolveServerBoosterStatus(interaction, userId) {
  if (!interaction.guild) {
    return false;
  }

  if (interaction.user.id === userId) {
    return isServerBooster(interaction.member);
  }

  const cachedMember = interaction.guild.members.cache.get(userId);

  if (cachedMember) {
    return isServerBooster(cachedMember);
  }

  const fetchedMember = await interaction.guild.members.fetch(userId).catch(() => null);
  return isServerBooster(fetchedMember);
}

function buildBoosterSummary(economy) {
  const inventory = economy?.boosterInventory || {};
  const entries = Object.entries(inventory).filter(([, amount]) => Number(amount) > 0);

  if (entries.length === 0) {
    return "Nenhum booster comprado.";
  }

  return entries
    .map(([itemId, amount]) => {
      const item = BOOSTER_ITEMS.find((candidate) => candidate.id === itemId);
      const name = item?.name || itemId;
      const bonus = item?.bonusPercent ? ` (+${item.bonusPercent}% cada)` : "";
      return `- ${name} x${amount}${bonus}`;
    })
    .join("\n");
}

module.exports = {
  category: "economia",
  cooldownMs: 1200,
  data: new SlashCommandBuilder()
    .setName("saldo")
    .setDescription("Mostra seus pontos ou de outro usuario.")
    .addUserOption((option) =>
      option
        .setName("usuario")
        .setDescription("Usuario para consultar saldo")
        .setRequired(false)
    ),
  async execute(interaction) {
    const targetUser = interaction.options.getUser("usuario") || interaction.user;
    const guildId = interaction.guildId || "";
    const isTargetServerBooster = await resolveServerBoosterStatus(interaction, targetUser.id);
    const economy = getUserEconomy(targetUser.id, guildId, {
      isServerBooster: isTargetServerBooster
    });
    const inflation = getInflationSnapshot(guildId);
    const ownBalance = targetUser.id === interaction.user.id;
    const boostersText = buildBoosterSummary(economy);
    const inflationSignal = inflation.dailyPercent >= 0 ? "+" : "";
    const priceSignal = inflation.priceImpactPercent >= 0 ? "+" : "";

    await interaction.reply(
      createCv2Reply(
        interaction,
        {
          tone: "info",
          eyebrow: "Economia",
          title: ownBalance
            ? "Carteira de pontos"
            : `Carteira de ${targetUser.username}`,
          description:
            `Base: +${POINTS_PER_REWARD} pontos a cada ${MESSAGES_PER_REWARD} mensagens. Boosters aumentam esse ganho e Nitro Booster recebe 2x.`,
          fields: [
            { name: "Usuario", value: `<@${targetUser.id}>` },
            { name: "Pontos atuais", value: `${formatPoints(economy.points)} pontos` },
            {
              name: "Progresso do bonus",
              value: `${economy.messageProgress}/${MESSAGES_PER_REWARD} mensagens`
            },
            {
              name: `Faltam para +${formatPoints(economy.pointsPerReward)}`,
              value: `${economy.messagesToNextReward} mensagem(ns)`
            },
            {
              name: "Bonus de ganho",
              value: `+${economy.gainBonusPercent}%`
            },
            {
              name: "Booster do servidor",
              value: isTargetServerBooster ? "Ativo (2x ganhos)" : "Nao ativo"
            },
            {
              name: "Ganho por ciclo",
              value: `${formatPoints(economy.basePointsPerReward)} -> ${formatPoints(
                economy.pointsPerReward
              )} pontos`
            },
            {
              name: "Total de mensagens",
              value: `${formatPoints(economy.totalMessages)} mensagens`
            },
            {
              name: "Total ganho",
              value: `${formatPoints(economy.totalPointsEarned)} pontos`
            },
            {
              name: "Total gasto",
              value: `${formatPoints(economy.totalPointsSpent)} pontos`
            },
            {
              name: "Inflacao do dia",
              value: `${inflationSignal}${inflation.dailyPercent.toFixed(2)}%`
            },
            {
              name: "Impacto de mercado",
              value: `Ganhos e precos em ${priceSignal}${inflation.priceImpactPercent.toFixed(
                2
              )}%`
            },
            {
              name: "Rendimento de investimento",
              value: `${priceSignal}${inflation.investmentImpactPercent.toFixed(2)}%`
            },
            {
              name: "Boosters ativos",
              value: boostersText
            }
          ],
          footer: `Regra ativa: +${POINTS_PER_REWARD} pontos por ciclo`
        },
        ownBalance
      )
    );
  }
};
