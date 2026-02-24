const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const {
  BOOSTER_ITEMS,
  getShopItemById,
  isBoosterItem
} = require("../../data/shop-items");
const {
  getUserEconomy,
  redeemShopItem,
  getInflationAdjustedAmount
} = require("../../utils/economy-store");

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR").format(Math.max(0, Number(value) || 0));
}

function isServerBooster(member) {
  return Boolean(member?.premiumSinceTimestamp || member?.premiumSince || member?.premium_since);
}

function toChoiceLabel(item) {
  const label = `${item.name} (+${item.bonusPercent}% | ${formatPoints(item.cost)} pts)`;
  return label.length <= 100 ? label : label.slice(0, 100);
}

const commandData = new SlashCommandBuilder()
  .setName("comprar")
  .setDescription("Compra boosters que aumentam seu ganho de pontos (preco dinamico).")
  .setDMPermission(false)
  .addStringOption((option) => {
    option
      .setName("item")
      .setDescription("Booster desejado")
      .setRequired(true);

    for (const item of BOOSTER_ITEMS.slice(0, 25)) {
      option.addChoices({
        name: toChoiceLabel(item),
        value: item.id
      });
    }

    return option;
  });

module.exports = {
  category: "economia",
  cooldownMs: 2500,
  data: commandData,
  async execute(interaction) {
    const itemId = interaction.options.getString("item", true);
    const item = getShopItemById(itemId);
    const guildId = interaction.guildId;
    const isUserServerBooster = isServerBooster(interaction.member);

    if (!isBoosterItem(item)) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Economia",
            title: "Item invalido",
            description: "Esse item nao e um booster compravel."
          },
          true
        )
      );
      return;
    }

    const result = redeemShopItem(interaction.user.id, item, guildId, {
      isServerBooster: isUserServerBooster
    });
    const todayCost = getInflationAdjustedAmount(item.cost, guildId).adjustedAmount;

    if (!result.ok) {
      if (result.reason === "INSUFFICIENT_POINTS") {
        const economy = getUserEconomy(interaction.user.id, guildId, {
          isServerBooster: isUserServerBooster
        });
        const missingPoints = Math.max(0, todayCost - economy.points);

        await interaction.reply(
          createCv2Reply(
            interaction,
            {
              tone: "warning",
              eyebrow: "Economia",
              title: "Pontos insuficientes",
              description: "Voce ainda nao tem pontos para comprar esse booster.",
              fields: [
                { name: "Item", value: item.name },
                { name: "Preco base", value: `${formatPoints(item.cost)} pontos` },
                { name: "Preco hoje", value: `${formatPoints(todayCost)} pontos` },
                { name: "Seu saldo", value: `${formatPoints(economy.points)} pontos` },
                { name: "Faltam", value: `${formatPoints(missingPoints)} pontos` }
              ]
            },
            true
          )
        );
        return;
      }

      if (result.reason === "OUT_OF_STOCK") {
        await interaction.reply(
          createCv2Reply(
            interaction,
            {
              tone: "warning",
              eyebrow: "Economia",
              title: "Sem estoque",
              description: "Esse booster esgotou no momento."
            },
            true
          )
        );
        return;
      }

      if (result.reason === "ALREADY_OWNED") {
        await interaction.reply(
          createCv2Reply(
            interaction,
            {
              tone: "warning",
              eyebrow: "Economia",
              title: "Booster ja comprado",
              description: "Esse booster e de compra unica por usuario."
            },
            true
          )
        );
        return;
      }

      if (result.reason === "BONUS_CAP_REACHED") {
        await interaction.reply(
          createCv2Reply(
            interaction,
            {
              tone: "warning",
              eyebrow: "Economia",
              title: "Limite de bonus atingido",
              description: "Seu bonus total de ganho ja esta no limite permitido."
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
            title: "Nao foi possivel comprar",
            description: "Ocorreu um erro ao aplicar o booster."
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
          eyebrow: "Economia",
          title: "Booster aplicado",
          description: "Compra concluida e bonus ativado imediatamente.",
          fields: [
            { name: "Item", value: item.name },
            { name: "Preco pago", value: `${formatPoints(result.effectiveCost)} pontos` },
            { name: "Bonus do item", value: `+${item.bonusPercent}%` },
            { name: "Bonus total atual", value: `+${result.gainBonusPercent}%` },
            {
              name: "Ganho por ciclo agora",
              value: `${formatPoints(result.pointsPerReward)} pontos`
            },
            { name: "Saldo restante", value: `${formatPoints(result.points)} pontos` }
          ]
        },
        true
      )
    );
  }
};
