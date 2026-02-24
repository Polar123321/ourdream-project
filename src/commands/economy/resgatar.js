const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const {
  REWARD_ITEMS,
  getShopItemById,
  isRewardItem
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
  const label = `${item.name} (${formatPoints(item.cost)} pts)`;
  return label.length <= 100 ? label : label.slice(0, 100);
}

const commandData = new SlashCommandBuilder()
  .setName("resgatar")
  .setDescription("Troca seus pontos por um item da loja (preco dinamico).")
  .setDMPermission(false)
  .addStringOption((option) => {
    option
      .setName("item")
      .setDescription("Item desejado")
      .setRequired(true);

    for (const item of REWARD_ITEMS.slice(0, 25)) {
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

    if (!item) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Loja",
            title: "Item invalido",
            description: "Esse item nao existe mais na loja atual."
          },
          true
        )
      );
      return;
    }

    if (!isRewardItem(item)) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Loja",
            title: "Item invalido",
            description:
              "Esse item nao esta disponivel para /resgatar. Use /comprar para boosters."
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
              eyebrow: "Loja",
              title: "Pontos insuficientes",
              description: "Ainda nao da para resgatar esse item.",
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
              eyebrow: "Loja",
              title: "Sem estoque",
              description: "Esse item esta esgotado no momento."
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
            eyebrow: "Loja",
            title: "Nao foi possivel resgatar",
            description: "Aconteceu um erro ao registrar seu pedido."
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
          eyebrow: "Loja",
          title: "Pedido de resgate criado",
          description:
            "Seu pedido foi registrado e ficara pendente para entrega manual da equipe.",
          fields: [
            { name: "Pedido", value: result.redemption.id },
            { name: "Item", value: result.redemption.itemName },
            { name: "Preco base", value: `${formatPoints(result.redemption.baseCost)} pontos` },
            { name: "Preco pago", value: `${formatPoints(result.redemption.cost)} pontos` },
            { name: "Status", value: "Pendente" },
            { name: "Saldo restante", value: `${formatPoints(result.points)} pontos` }
          ]
        },
        true
      )
    );
  }
};
