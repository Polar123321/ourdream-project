const fs = require("node:fs");
const path = require("node:path");

const config = require("../config");
const logger = require("./logger");

const MESSAGES_PER_REWARD = 20;
const POINTS_PER_REWARD = 500;
const MAX_TOTAL_BONUS_PERCENT = 50;
const SERVER_BOOSTER_GAIN_MULTIPLIER = 2;

const BASE_INFLATION_INDEX = 100;
const MIN_PRICE_INDEX = 60;
const MAX_PRICE_INDEX = 280;
const MIN_EFFECTIVE_MULTIPLIER = MIN_PRICE_INDEX / BASE_INFLATION_INDEX;
const MAX_EFFECTIVE_MULTIPLIER = MAX_PRICE_INDEX / BASE_INFLATION_INDEX;

const STORAGE_DIR_PATH = path.join(process.cwd(), "storage");
const STORE_FILE_PATH = path.join(STORAGE_DIR_PATH, "economy.json");

let storeState = null;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toNonNegativeInteger(value, fallback = 0) {
  const numeric = Number.parseInt(value, 10);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }

  return numeric;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  if (min === max) {
    return min;
  }

  return Math.random() * (max - min) + min;
}

function isValidSnowflake(input) {
  return /^\d{16,20}$/.test(String(input || "").trim());
}

function normalizeBoosterInventory(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const inventory = {};

  for (const [itemId, amount] of Object.entries(input)) {
    const normalizedId = String(itemId || "").trim();

    if (!normalizedId) {
      continue;
    }

    const quantity = toNonNegativeInteger(amount, 0);

    if (quantity > 0) {
      inventory[normalizedId] = quantity;
    }
  }

  return inventory;
}

function normalizeDayKey(input) {
  const value = String(input || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function normalizeInflationState(input) {
  return {
    dayKey: normalizeDayKey(input?.dayKey),
    lastPublishedDayKey: normalizeDayKey(input?.lastPublishedDayKey),
    dailyPercent: toFiniteNumber(input?.dailyPercent, 0),
    previousDailyPercent: toFiniteNumber(input?.previousDailyPercent, 0),
    priceIndex: clamp(
      toFiniteNumber(input?.priceIndex, BASE_INFLATION_INDEX),
      MIN_PRICE_INDEX,
      MAX_PRICE_INDEX
    ),
    previousPriceIndex: clamp(
      toFiniteNumber(input?.previousPriceIndex, BASE_INFLATION_INDEX),
      MIN_PRICE_INDEX,
      MAX_PRICE_INDEX
    ),
    eventType: String(input?.eventType || "normal").trim() || "normal",
    eventLabel:
      String(input?.eventLabel || "Mercado em oscilacao normal.").trim() ||
      "Mercado em oscilacao normal."
  };
}

function normalizeGuildRecord(input) {
  return {
    inflationChannelId: isValidSnowflake(input?.inflationChannelId)
      ? String(input.inflationChannelId)
      : "",
    inflation: normalizeInflationState(input?.inflation)
  };
}

function createEmptyStore() {
  return {
    version: 3,
    nextRedemptionId: 1,
    users: {},
    guilds: {},
    redemptions: []
  };
}

function normalizeUserRecord(input) {
  return {
    points: toNonNegativeInteger(input?.points, 0),
    messageProgress: toNonNegativeInteger(input?.messageProgress, 0) % MESSAGES_PER_REWARD,
    totalMessages: toNonNegativeInteger(input?.totalMessages, 0),
    totalPointsEarned: toNonNegativeInteger(input?.totalPointsEarned, 0),
    totalPointsSpent: toNonNegativeInteger(input?.totalPointsSpent, 0),
    totalPointsTransferredIn: toNonNegativeInteger(input?.totalPointsTransferredIn, 0),
    totalPointsTransferredOut: toNonNegativeInteger(input?.totalPointsTransferredOut, 0),
    gainBonusPercent: Math.min(
      MAX_TOTAL_BONUS_PERCENT,
      toNonNegativeInteger(input?.gainBonusPercent, 0)
    ),
    boosterInventory: normalizeBoosterInventory(input?.boosterInventory)
  };
}

function normalizeRedemption(input) {
  const cost = toNonNegativeInteger(input?.cost, 0);
  const baseCost = toNonNegativeInteger(input?.baseCost, cost);
  const createdAt = String(input?.createdAt || "").trim();
  const appliedBonusPercent = toNonNegativeInteger(input?.appliedBonusPercent, 0);
  const inflationPriceMultiplier = toFiniteNumber(input?.inflationPriceMultiplier, 1);
  const inflationDailyPercent = toFiniteNumber(input?.inflationDailyPercent, 0);
  const guildId = isValidSnowflake(input?.guildId) ? String(input.guildId) : "";

  return {
    id: String(input?.id || "").trim() || "R000000",
    userId: String(input?.userId || "").trim(),
    guildId,
    itemId: String(input?.itemId || "").trim(),
    itemName: String(input?.itemName || "").trim() || "Item",
    itemType: String(input?.itemType || "reward_irl").trim() || "reward_irl",
    cost,
    baseCost,
    status: String(input?.status || "pending").trim() || "pending",
    createdAt: createdAt || new Date().toISOString(),
    appliedBonusPercent,
    inflationPriceMultiplier,
    inflationDailyPercent
  };
}

function normalizeStore(rawStore) {
  const normalized = createEmptyStore();

  if (!rawStore || typeof rawStore !== "object") {
    return normalized;
  }

  normalized.nextRedemptionId = Math.max(
    1,
    toNonNegativeInteger(rawStore.nextRedemptionId, 1)
  );

  if (rawStore.users && typeof rawStore.users === "object" && !Array.isArray(rawStore.users)) {
    for (const [userId, record] of Object.entries(rawStore.users)) {
      if (!isValidSnowflake(userId)) {
        continue;
      }

      normalized.users[userId] = normalizeUserRecord(record);
    }
  }

  if (rawStore.guilds && typeof rawStore.guilds === "object" && !Array.isArray(rawStore.guilds)) {
    for (const [guildId, record] of Object.entries(rawStore.guilds)) {
      if (!isValidSnowflake(guildId)) {
        continue;
      }

      normalized.guilds[guildId] = normalizeGuildRecord(record);
    }
  }

  if (Array.isArray(rawStore.redemptions)) {
    normalized.redemptions = rawStore.redemptions.map(normalizeRedemption);
  }

  return normalized;
}

function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR_PATH)) {
    fs.mkdirSync(STORAGE_DIR_PATH, { recursive: true });
  }
}

function persistStore() {
  ensureStorageDir();
  fs.writeFileSync(STORE_FILE_PATH, `${JSON.stringify(storeState, null, 2)}\n`, "utf8");
}

function loadStore() {
  if (storeState) {
    return storeState;
  }

  ensureStorageDir();

  if (!fs.existsSync(STORE_FILE_PATH)) {
    storeState = createEmptyStore();
    persistStore();
    return storeState;
  }

  try {
    const raw = fs.readFileSync(STORE_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    storeState = normalizeStore(parsed);
  } catch (error) {
    logger.error("Falha ao carregar storage da economia. Recriando arquivo.", error);
    storeState = createEmptyStore();
    persistStore();
  }

  return storeState;
}

function assertUserId(userId) {
  const normalizedUserId = String(userId || "").trim();

  if (!isValidSnowflake(normalizedUserId)) {
    throw new Error("ID de usuario invalido para economia.");
  }

  return normalizedUserId;
}

function normalizeGuildId(guildId) {
  const normalized = String(guildId || "").trim();
  return isValidSnowflake(normalized) ? normalized : "";
}

function assertGuildId(guildId) {
  const normalizedGuildId = normalizeGuildId(guildId);

  if (!normalizedGuildId) {
    throw new Error("ID de servidor invalido para economia.");
  }

  return normalizedGuildId;
}

function resolveInflationTimeZone() {
  return (
    String(config?.economy?.inflation?.timezone || "")
      .trim() || "America/Sao_Paulo"
  );
}

function getInflationDateParts(date = new Date()) {
  const timeZone = resolveInflationTimeZone();

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });

    const parts = formatter.formatToParts(date);
    const byType = {};

    for (const part of parts) {
      if (part.type !== "literal") {
        byType[part.type] = part.value;
      }
    }

    const year = byType.year || "0000";
    const month = byType.month || "01";
    const day = byType.day || "01";
    const hour = toNonNegativeInteger(byType.hour, 0);
    const minute = toNonNegativeInteger(byType.minute, 0);

    return {
      year,
      month,
      day,
      hour,
      minute,
      dayKey: `${year}-${month}-${day}`
    };
  } catch {
    const utcYear = date.getUTCFullYear();
    const utcMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
    const utcDay = String(date.getUTCDate()).padStart(2, "0");
    const utcHour = date.getUTCHours();
    const utcMinute = date.getUTCMinutes();

    return {
      year: String(utcYear),
      month: utcMonth,
      day: utcDay,
      hour: utcHour,
      minute: utcMinute,
      dayKey: `${utcYear}-${utcMonth}-${utcDay}`
    };
  }
}

function getInflationRangeSettings() {
  const settings = config?.economy?.inflation || {};
  const minDaily = toFiniteNumber(settings.minDailyPercent, -5);
  const maxDaily = toFiniteNumber(settings.maxDailyPercent, 15);
  const normalizedMinDaily = Math.min(minDaily, maxDaily);
  const normalizedMaxDaily = Math.max(minDaily, maxDaily);
  const extremeEventChancePercent = clamp(
    toFiniteNumber(settings.extremeEventChancePercent, 12),
    0,
    100
  );
  const extremeSwingMinPercent = Math.max(
    0,
    toFiniteNumber(settings.extremeSwingMinPercent, 8)
  );
  const extremeSwingMaxPercent = Math.max(
    extremeSwingMinPercent,
    toFiniteNumber(settings.extremeSwingMaxPercent, 20)
  );

  return {
    minDailyPercent: normalizedMinDaily,
    maxDailyPercent: normalizedMaxDaily,
    extremeEventChancePercent,
    extremeSwingMinPercent,
    extremeSwingMaxPercent
  };
}

function calculateBoosterPointsPerReward(record) {
  const bonusPercent = Math.min(
    MAX_TOTAL_BONUS_PERCENT,
    toNonNegativeInteger(record?.gainBonusPercent, 0)
  );
  return Math.max(1, Math.floor((POINTS_PER_REWARD * (100 + bonusPercent)) / 100));
}

function resolveServerBoosterMultiplier(options) {
  if (!options || typeof options !== "object") {
    return 1;
  }

  return options.isServerBooster === true ? SERVER_BOOSTER_GAIN_MULTIPLIER : 1;
}

function calculateRewardPointsPerCycle(record, inflationSnapshot, options = {}) {
  const boosterPointsPerReward = calculateBoosterPointsPerReward(record);
  const serverBoosterMultiplier = resolveServerBoosterMultiplier(options);
  const serverBoosterPointsPerReward = Math.max(
    1,
    Math.floor(boosterPointsPerReward * serverBoosterMultiplier)
  );
  const pointsPerReward = Math.max(
    1,
    Math.floor(serverBoosterPointsPerReward * inflationSnapshot.gainMultiplier)
  );

  return {
    boosterPointsPerReward,
    serverBoosterMultiplier,
    serverBoosterPointsPerReward,
    pointsPerReward
  };
}

function toMarketMood(dailyPercent, priceMultiplier) {
  if (dailyPercent >= 8 || priceMultiplier >= 1.4) {
    return {
      key: "heated",
      emoji: "🔥",
      label: "Economia Aquecida"
    };
  }

  if (dailyPercent <= -4 || priceMultiplier <= 0.9) {
    return {
      key: "recession",
      emoji: "❄️",
      label: "Recessao"
    };
  }

  return {
    key: "stable",
    emoji: "⚖️",
    label: "Estavel"
  };
}

function createNeutralInflationSnapshot() {
  const mood = toMarketMood(0, 1);

  return {
    dayKey: "",
    previousDayKey: "",
    dailyPercent: 0,
    previousDailyPercent: 0,
    deltaVsYesterday: 0,
    priceIndex: BASE_INFLATION_INDEX,
    previousPriceIndex: BASE_INFLATION_INDEX,
    priceMultiplier: 1,
    gainMultiplier: 1,
    investmentMultiplier: 1,
    priceImpactPercent: 0,
    gainImpactPercent: 0,
    investmentImpactPercent: 0,
    eventType: "normal",
    eventLabel: "Mercado sem variacoes relevantes.",
    marketMoodKey: mood.key,
    marketMoodEmoji: mood.emoji,
    marketMoodLabel: mood.label,
    channelId: "",
    lastPublishedDayKey: ""
  };
}

function buildInflationSnapshot(guildRecord) {
  const inflation = guildRecord.inflation;
  const priceMultiplier = clamp(
    inflation.priceIndex / BASE_INFLATION_INDEX,
    MIN_EFFECTIVE_MULTIPLIER,
    MAX_EFFECTIVE_MULTIPLIER
  );
  const gainMultiplier = priceMultiplier;
  const investmentMultiplier = priceMultiplier;
  const priceImpactPercent = (priceMultiplier - 1) * 100;
  const gainImpactPercent = (gainMultiplier - 1) * 100;
  const investmentImpactPercent = (investmentMultiplier - 1) * 100;
  const mood = toMarketMood(inflation.dailyPercent, priceMultiplier);

  return {
    dayKey: inflation.dayKey,
    previousDayKey: "",
    dailyPercent: inflation.dailyPercent,
    previousDailyPercent: inflation.previousDailyPercent,
    deltaVsYesterday: inflation.dailyPercent - inflation.previousDailyPercent,
    priceIndex: inflation.priceIndex,
    previousPriceIndex: inflation.previousPriceIndex,
    priceMultiplier,
    gainMultiplier,
    investmentMultiplier,
    priceImpactPercent,
    gainImpactPercent,
    investmentImpactPercent,
    eventType: inflation.eventType,
    eventLabel: inflation.eventLabel,
    marketMoodKey: mood.key,
    marketMoodEmoji: mood.emoji,
    marketMoodLabel: mood.label,
    channelId: guildRecord.inflationChannelId,
    lastPublishedDayKey: inflation.lastPublishedDayKey
  };
}

function generateDailyInflation(guildRecord) {
  const settings = getInflationRangeSettings();
  const prevIndex = clamp(
    toFiniteNumber(guildRecord?.inflation?.priceIndex, BASE_INFLATION_INDEX),
    MIN_PRICE_INDEX,
    MAX_PRICE_INDEX
  );

  const baseRoll = randomBetween(settings.minDailyPercent, settings.maxDailyPercent);
  const meanReversion = ((BASE_INFLATION_INDEX - prevIndex) / BASE_INFLATION_INDEX) * 8;

  let dailyPercent = baseRoll + meanReversion;
  let eventType = "normal";
  let eventLabel = "Mercado em oscilacao normal.";

  if (Math.random() * 100 < settings.extremeEventChancePercent) {
    const swingAbs = randomBetween(
      settings.extremeSwingMinPercent,
      settings.extremeSwingMaxPercent
    );
    let sign = Math.random() < 0.5 ? -1 : 1;

    if (prevIndex >= 125 && Math.random() < 0.75) {
      sign = -1;
    } else if (prevIndex <= 85 && Math.random() < 0.75) {
      sign = 1;
    }

    const swing = swingAbs * sign;
    dailyPercent += swing;

    if (swing >= 0) {
      eventType = "spike";
      eventLabel = "Choque de demanda elevou os precos.";
    } else {
      eventType = "drop";
      eventLabel = "Queda brusca de consumo pressionou os precos para baixo.";
    }
  }

  const minClamp = settings.minDailyPercent - settings.extremeSwingMaxPercent;
  const maxClamp = settings.maxDailyPercent + settings.extremeSwingMaxPercent;
  dailyPercent = clamp(dailyPercent, minClamp, maxClamp);

  const rawNextIndex = prevIndex * (1 + dailyPercent / 100);
  const nextIndex = clamp(rawNextIndex, MIN_PRICE_INDEX, MAX_PRICE_INDEX);
  const adjustedDailyPercent = ((nextIndex / prevIndex) - 1) * 100;

  return {
    dailyPercent: adjustedDailyPercent,
    priceIndex: nextIndex,
    eventType,
    eventLabel
  };
}

function ensureUser(userId) {
  const store = loadStore();
  const normalizedUserId = assertUserId(userId);

  if (!store.users[normalizedUserId]) {
    store.users[normalizedUserId] = normalizeUserRecord();
  }

  return {
    userId: normalizedUserId,
    record: store.users[normalizedUserId]
  };
}

function ensureGuild(guildId) {
  const store = loadStore();
  const normalizedGuildId = assertGuildId(guildId);

  if (!store.guilds[normalizedGuildId]) {
    store.guilds[normalizedGuildId] = normalizeGuildRecord();
  }

  return {
    guildId: normalizedGuildId,
    record: store.guilds[normalizedGuildId]
  };
}

function ensureDailyInflation(guildId, date = new Date()) {
  const { record } = ensureGuild(guildId);
  const { dayKey } = getInflationDateParts(date);

  if (record.inflation.dayKey === dayKey) {
    return record;
  }

  const generated = generateDailyInflation(record);

  record.inflation.previousDailyPercent = record.inflation.dailyPercent;
  record.inflation.previousPriceIndex = record.inflation.priceIndex;
  record.inflation.dailyPercent = generated.dailyPercent;
  record.inflation.priceIndex = generated.priceIndex;
  record.inflation.eventType = generated.eventType;
  record.inflation.eventLabel = generated.eventLabel;
  record.inflation.dayKey = dayKey;

  persistStore();
  return record;
}

function getInflationSnapshot(guildId, date = new Date()) {
  const normalizedGuildId = normalizeGuildId(guildId);

  if (!normalizedGuildId) {
    return createNeutralInflationSnapshot();
  }

  const record = ensureDailyInflation(normalizedGuildId, date);
  return buildInflationSnapshot(record);
}

function setInflationChannel(guildId, channelId) {
  const normalizedChannelId = String(channelId || "").trim();

  if (!isValidSnowflake(normalizedChannelId)) {
    throw new Error("ID de canal invalido para inflacao.");
  }

  const { record } = ensureGuild(guildId);
  record.inflationChannelId = normalizedChannelId;
  persistStore();

  return buildInflationSnapshot(record);
}

function markInflationPublished(guildId, dayKey) {
  const normalizedDayKey = normalizeDayKey(dayKey);

  if (!normalizedDayKey) {
    return false;
  }

  const { record } = ensureGuild(guildId);
  record.inflation.lastPublishedDayKey = normalizedDayKey;
  persistStore();
  return true;
}

function getInflationAdjustedAmount(baseAmount, guildId, date = new Date()) {
  const base = toNonNegativeInteger(baseAmount, 0);
  const snapshot = getInflationSnapshot(guildId, date);
  const adjusted = base <= 0 ? 0 : Math.max(1, Math.round(base * snapshot.priceMultiplier));

  return {
    baseAmount: base,
    adjustedAmount: adjusted,
    snapshot
  };
}

function toPublicUserSnapshot(record, inflationSnapshot, options = {}) {
  const messageProgress = toNonNegativeInteger(record?.messageProgress, 0) % MESSAGES_PER_REWARD;
  const gainBonusPercent = Math.min(
    MAX_TOTAL_BONUS_PERCENT,
    toNonNegativeInteger(record?.gainBonusPercent, 0)
  );
  const {
    boosterPointsPerReward,
    serverBoosterMultiplier,
    serverBoosterPointsPerReward,
    pointsPerReward
  } = calculateRewardPointsPerCycle(record, inflationSnapshot, options);

  return {
    points: toNonNegativeInteger(record?.points, 0),
    messageProgress,
    messagesToNextReward:
      messageProgress === 0 ? MESSAGES_PER_REWARD : MESSAGES_PER_REWARD - messageProgress,
    totalMessages: toNonNegativeInteger(record?.totalMessages, 0),
    totalPointsEarned: toNonNegativeInteger(record?.totalPointsEarned, 0),
    totalPointsSpent: toNonNegativeInteger(record?.totalPointsSpent, 0),
    totalPointsTransferredIn: toNonNegativeInteger(record?.totalPointsTransferredIn, 0),
    totalPointsTransferredOut: toNonNegativeInteger(record?.totalPointsTransferredOut, 0),
    gainBonusPercent,
    basePointsPerReward: POINTS_PER_REWARD,
    boosterPointsPerReward,
    serverBoosterMultiplier,
    serverBoosterPointsPerReward,
    inflationGainMultiplier: inflationSnapshot.gainMultiplier,
    inflationPriceMultiplier: inflationSnapshot.priceMultiplier,
    inflationDailyPercent: inflationSnapshot.dailyPercent,
    pointsPerReward,
    boosterInventory: { ...normalizeBoosterInventory(record?.boosterInventory) }
  };
}

function registerChatMessage(userId, guildId, options = {}) {
  const { record } = ensureUser(userId);
  const inflationSnapshot = getInflationSnapshot(guildId);

  record.totalMessages += 1;
  record.messageProgress += 1;

  let rewardCycles = 0;

  while (record.messageProgress >= MESSAGES_PER_REWARD) {
    record.messageProgress -= MESSAGES_PER_REWARD;
    rewardCycles += 1;
  }

  const {
    boosterPointsPerReward,
    serverBoosterMultiplier,
    serverBoosterPointsPerReward,
    pointsPerReward
  } = calculateRewardPointsPerCycle(record, inflationSnapshot, options);
  const baseAwardedPoints = rewardCycles * POINTS_PER_REWARD;
  const boosterAwardedPoints = rewardCycles * (boosterPointsPerReward - POINTS_PER_REWARD);
  const serverBoosterAwardedPoints =
    rewardCycles * (serverBoosterPointsPerReward - boosterPointsPerReward);
  const awardedPoints = rewardCycles * pointsPerReward;
  const inflationAwardedPoints = awardedPoints - (rewardCycles * serverBoosterPointsPerReward);

  if (awardedPoints > 0) {
    record.points += awardedPoints;
    record.totalPointsEarned += awardedPoints;
  }

  persistStore();

  return {
    awardedPoints,
    baseAwardedPoints,
    boosterAwardedPoints,
    serverBoosterAwardedPoints,
    serverBoosterMultiplier,
    inflationAwardedPoints,
    rewardCycles,
    pointsPerReward,
    ...toPublicUserSnapshot(record, inflationSnapshot, options)
  };
}

function getUserEconomy(userId, guildId = "", options = {}) {
  const { record } = ensureUser(userId);
  const inflationSnapshot = getInflationSnapshot(guildId);
  return toPublicUserSnapshot(record, inflationSnapshot, options);
}

function countRedemptionsByItem(itemId, guildId = "") {
  const store = loadStore();
  const normalizedItemId = String(itemId || "").trim();
  const normalizedGuildId = normalizeGuildId(guildId);

  if (!normalizedItemId) {
    return 0;
  }

  return store.redemptions.reduce((total, redemption) => {
    if (redemption.itemId !== normalizedItemId) {
      return total;
    }

    if (normalizedGuildId && redemption.guildId !== normalizedGuildId) {
      return total;
    }

    return total + 1;
  }, 0);
}

function nextRedemptionCode(store) {
  const code = `R${String(store.nextRedemptionId).padStart(6, "0")}`;
  store.nextRedemptionId += 1;
  return code;
}

function transferPoints(fromUserId, toUserId, amount) {
  const normalizedFrom = assertUserId(fromUserId);
  const normalizedTo = assertUserId(toUserId);
  const transferAmount = toNonNegativeInteger(amount, 0);

  if (normalizedFrom === normalizedTo) {
    return {
      ok: false,
      reason: "SELF_TRANSFER"
    };
  }

  if (transferAmount <= 0) {
    return {
      ok: false,
      reason: "INVALID_AMOUNT"
    };
  }

  const { record: senderRecord } = ensureUser(normalizedFrom);
  const { record: receiverRecord } = ensureUser(normalizedTo);

  if (senderRecord.points < transferAmount) {
    return {
      ok: false,
      reason: "INSUFFICIENT_POINTS",
      points: senderRecord.points,
      missingPoints: transferAmount - senderRecord.points
    };
  }

  senderRecord.points -= transferAmount;
  receiverRecord.points += transferAmount;
  senderRecord.totalPointsTransferredOut += transferAmount;
  receiverRecord.totalPointsTransferredIn += transferAmount;

  persistStore();

  return {
    ok: true,
    amount: transferAmount,
    senderPoints: senderRecord.points,
    receiverPoints: receiverRecord.points
  };
}

function redeemShopItem(userId, item, guildId = "", options = {}) {
  const store = loadStore();
  const normalizedGuildId = normalizeGuildId(guildId);
  const inflationSnapshot = getInflationSnapshot(normalizedGuildId);
  const { userId: normalizedUserId, record } = ensureUser(userId);
  const itemId = String(item?.id || "").trim();
  const itemName = String(item?.name || itemId || "Item").trim();
  const itemType = String(item?.type || "reward_irl").trim() || "reward_irl";
  const baseCost = toNonNegativeInteger(item?.cost, 0);
  const effectiveCost = baseCost <= 0
    ? 0
    : Math.max(1, Math.round(baseCost * inflationSnapshot.priceMultiplier));
  const limitedStock =
    Number.isInteger(item?.stock) && item.stock >= 0 ? item.stock : null;
  const isBooster = itemType === "booster";
  const bonusPercent = toNonNegativeInteger(item?.bonusPercent, 0);
  const uniquePerUser = item?.uniquePerUser === true;
  const ownedCount = toNonNegativeInteger(record.boosterInventory[itemId], 0);

  if (!itemId || effectiveCost <= 0) {
    return {
      ok: false,
      reason: "INVALID_ITEM",
      points: record.points
    };
  }

  if (isBooster && bonusPercent <= 0) {
    return {
      ok: false,
      reason: "INVALID_ITEM_TYPE",
      points: record.points
    };
  }

  if (record.points < effectiveCost) {
    return {
      ok: false,
      reason: "INSUFFICIENT_POINTS",
      points: record.points,
      missingPoints: effectiveCost - record.points,
      baseCost,
      effectiveCost,
      inflationDailyPercent: inflationSnapshot.dailyPercent
    };
  }

  if (limitedStock !== null) {
    const redeemedCount = countRedemptionsByItem(itemId, normalizedGuildId);

    if (redeemedCount >= limitedStock) {
      return {
        ok: false,
        reason: "OUT_OF_STOCK",
        points: record.points
      };
    }
  }

  if (isBooster && uniquePerUser && ownedCount > 0) {
    return {
      ok: false,
      reason: "ALREADY_OWNED",
      points: record.points
    };
  }

  if (isBooster && record.gainBonusPercent >= MAX_TOTAL_BONUS_PERCENT) {
    return {
      ok: false,
      reason: "BONUS_CAP_REACHED",
      points: record.points
    };
  }

  record.points -= effectiveCost;
  record.totalPointsSpent += effectiveCost;

  if (isBooster) {
    record.gainBonusPercent = Math.min(
      MAX_TOTAL_BONUS_PERCENT,
      record.gainBonusPercent + bonusPercent
    );
    record.boosterInventory[itemId] = ownedCount + 1;
  }

  const rewardSnapshot = calculateRewardPointsPerCycle(record, inflationSnapshot, options);

  const redemption = {
    id: nextRedemptionCode(store),
    userId: normalizedUserId,
    guildId: normalizedGuildId,
    itemId,
    itemName,
    itemType,
    cost: effectiveCost,
    baseCost,
    status: isBooster ? "completed" : "pending",
    createdAt: new Date().toISOString(),
    appliedBonusPercent: isBooster ? bonusPercent : 0,
    inflationPriceMultiplier: inflationSnapshot.priceMultiplier,
    inflationDailyPercent: inflationSnapshot.dailyPercent
  };

  store.redemptions.push(redemption);
  persistStore();

  return {
    ok: true,
    redemption,
    points: record.points,
    gainBonusPercent: record.gainBonusPercent,
    serverBoosterMultiplier: rewardSnapshot.serverBoosterMultiplier,
    pointsPerReward: rewardSnapshot.pointsPerReward,
    baseCost,
    effectiveCost,
    inflationDailyPercent: inflationSnapshot.dailyPercent,
    inflationPriceMultiplier: inflationSnapshot.priceMultiplier
  };
}

module.exports = {
  MESSAGES_PER_REWARD,
  POINTS_PER_REWARD,
  MAX_TOTAL_BONUS_PERCENT,
  registerChatMessage,
  getUserEconomy,
  countRedemptionsByItem,
  redeemShopItem,
  transferPoints,
  getInflationSnapshot,
  setInflationChannel,
  markInflationPublished,
  getInflationDateParts,
  getInflationAdjustedAmount
};
