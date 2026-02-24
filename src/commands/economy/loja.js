const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const { SHOP_ITEMS, isBoosterItem } = require("../../data/shop-items");
const {
  countRedemptionsByItem,
  getInflationSnapshot,
  getInflationAdjustedAmount
} = require("../../utils/economy-store");

function formatPoints(value) {
  return new Intl.NumberFormat("pt-BR").format(Math.max(0, Number(value) || 0));
}

function formatStock(item, guildId) {
  if (!Number.isInteger(item?.stock) || item.stock < 0) {
    return "Sem limite";
  }

  const redeemedCount = countRedemptionsByItem(item.id, guildId);
  const remaining = Math.max(0, item.stock - redeemedCount);
  return `${remaining}/${item.stock} disponivel(is)`;
}

function buildItemValue(item, guildId) {
  const booster = isBoosterItem(item);
  const commandLabel = booster
    ? `/comprar item:${item.id}`
    : `/resgatar item:${item.id}`;
  const priceData = getInflationAdjustedAmount(item.cost, guildId);
  const priceSignal = priceData.snapshot.dailyPercent >= 0 ? "+" : "";

  const lines = [
    `ID: \`${item.id}\``,
    `Tipo: ${booster ? "Booster de ganho" : "Premio IRL"}`,
    `Preco base: ${formatPoints(item.cost)} pontos`,
    `Preco hoje: ${formatPoints(priceData.adjustedAmount)} pontos`,
    `Inflacao aplicada: ${priceSignal}${priceData.snapshot.dailyPercent.toFixed(2)}%`,
    `Estoque: ${formatStock(item, guildId)}`,
    `Entrega: ${
      item.delivery === "manual_irl"
        ? "Manual (feito pela equipe)"
        : "Automatica/imediata"
    }`,
    booster ? `Efeito: +${item.bonusPercent}% no ganho por ciclo` : null,
    `${item.description}`,
    "------------------------------",
    `Comando: \`${commandLabel}\``
  ];

  return lines.filter(Boolean).join("\n");
}

module.exports = {
  category: "economia",
  cooldownMs: 1200,
  data: new SlashCommandBuilder()
    .setName("loja")
    .setDescription("Mostra os premios disponiveis por pontos.")
    .setDMPermission(false),
  async execute(interaction) {
    const guildId = interaction.guildId;
    const inflation = getInflationSnapshot(guildId);
    const inflationSignal = inflation.dailyPercent >= 0 ? "+" : "";

    const fields = SHOP_ITEMS.map((item) => ({
      name: item.name,
      value: buildItemValue(item, guildId)
    }));

    await interaction.reply(
      createCv2Reply(interaction, {
        tone: "info",
        eyebrow: "Loja",
        title: "Troque seus pontos por premios",
        description:
          `Use /comprar para boosters de ganho e /resgatar para premios IRL. Inflacao hoje: ${inflationSignal}${inflation.dailyPercent.toFixed(
            2
          )}%`,
        fields,
        footer: "Use /saldo para acompanhar seus pontos"
      })
    );
  }
};
