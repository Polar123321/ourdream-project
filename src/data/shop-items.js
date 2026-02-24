function shopItem(config) {
  return {
    type: "reward_irl",
    delivery: "manual",
    stock: 10,
    bonusPercent: 0,
    uniquePerUser: false,
    ...config
  };
}

const SHOP_ITEMS = [
  shopItem({
    id: "nitro_1_mes",
    name: "Discord Nitro (1 mes)",
    cost: 5_000_000,
    description: "Assinatura Nitro por 1 mes, entregue pela equipe.",
    type: "reward_irl",
    delivery: "manual_irl",
    stock: 10
  }),
  shopItem({
    id: "giftcard_steam_25",
    name: "Gift Card Steam R$25",
    cost: 8_000_000,
    description: "Codigo de gift card Steam no valor de R$25.",
    type: "reward_irl",
    delivery: "manual_irl",
    stock: 10
  }),
  shopItem({
    id: "giftcard_ifood_30",
    name: "Gift Card iFood R$30",
    cost: 9_000_000,
    description: "Codigo de gift card iFood no valor de R$30.",
    type: "reward_irl",
    delivery: "manual_irl",
    stock: 10
  }),
  shopItem({
    id: "booster_chat_i",
    name: "Booster de Chat I",
    cost: 12_000,
    description: "Aumenta em +3% os pontos ganhos por ciclo.",
    type: "booster",
    delivery: "automatic",
    bonusPercent: 3,
    uniquePerUser: true,
    stock: 10
  }),
  shopItem({
    id: "booster_chat_ii",
    name: "Booster de Chat II",
    cost: 24_000,
    description: "Aumenta em +5% os pontos ganhos por ciclo.",
    type: "booster",
    delivery: "automatic",
    bonusPercent: 5,
    uniquePerUser: true,
    stock: 10
  }),
  shopItem({
    id: "booster_chat_iii",
    name: "Booster de Chat III",
    cost: 42_000,
    description: "Aumenta em +7% os pontos ganhos por ciclo.",
    type: "booster",
    delivery: "automatic",
    bonusPercent: 7,
    uniquePerUser: true,
    stock: 10
  })
];

const SHOP_ITEMS_BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));
const BOOSTER_ITEMS = SHOP_ITEMS.filter((item) => item.type === "booster");
const REWARD_ITEMS = SHOP_ITEMS.filter((item) => item.type !== "booster");

function getShopItemById(itemId) {
  return SHOP_ITEMS_BY_ID.get(String(itemId || "").trim()) || null;
}

function isBoosterItem(item) {
  return Boolean(item) && item.type === "booster";
}

function isRewardItem(item) {
  return Boolean(item) && item.type !== "booster";
}

module.exports = {
  SHOP_ITEMS,
  BOOSTER_ITEMS,
  REWARD_ITEMS,
  getShopItemById,
  isBoosterItem,
  isRewardItem
};
