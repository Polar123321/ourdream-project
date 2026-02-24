const fs = require("node:fs");
const path = require("node:path");

const config = require("../config");
const logger = require("./logger");

const STORE_VERSION = 4;

const DEFAULT_MESSAGES_PER_REWARD = 20;
const DEFAULT_POINTS_PER_REWARD = 500;
const MAX_TOTAL_BONUS_PERCENT = 50;
const SERVER_BOOSTER_GAIN_MULTIPLIER = 2;

const DAILY_REWARD_BASE_POINTS = 300;
const DAILY_REWARD_BONUS_STEP_PERCENT = 5;
const DAILY_REWARD_MAX_BONUS_PERCENT = 100;

const INVESTMENT_WITHDRAW_FEE_PERCENT = 2;
const INVESTMENT_HISTORY_LIMIT = 16;
const GAIN_DAY_RETENTION_DAYS = 120;
const AUDIT_LOG_LIMIT = 200;

const BASE_INFLATION_INDEX = 100;
const MIN_PRICE_INDEX = 60;
const MAX_PRICE_INDEX = 280;
const MIN_EFFECTIVE_MULTIPLIER = MIN_PRICE_INDEX / BASE_INFLATION_INDEX;
const MAX_EFFECTIVE_MULTIPLIER = MAX_PRICE_INDEX / BASE_INFLATION_INDEX;

const MESSAGES_PER_REWARD = DEFAULT_MESSAGES_PER_REWARD;
const POINTS_PER_REWARD = DEFAULT_POINTS_PER_REWARD;

const STORAGE_DIR_PATH = path.join(process.cwd(), "storage");
const STORE_FILE_PATH = path.join(STORAGE_DIR_PATH, "economy.json");

const DAILY_MISSION_DEFINITIONS = [
  {
    id: "chat_messages",
    event: "chat_message",
    label: "Enviar 30 mensagens validas",
    target: 30,
    rewardPoints: 350
  },
  {
    id: "action_commands",
    event: "action_command",
    label: "Usar 2 comandos de acao",
    target: 2,
    rewardPoints: 250
  },
  {
    id: "transfer_points",
    event: "transfer_completed",
    label: "Fazer 1 transferencia",
    target: 1,
    rewardPoints: 300
  }
];

const DAILY_MISSION_ALL_COMPLETED_BONUS_POINTS = 500;

const DAILY_MISSION_BY_ID = new Map(
  DAILY_MISSION_DEFINITIONS.map((mission) => [mission.id, mission])
);

const DAILY_MISSION_ID_BY_EVENT = DAILY_MISSION_DEFINITIONS.reduce((acc, mission) => {
  acc[mission.event] = mission.id;
  return acc;
}, {});

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

function toIntegerInRange(value, fallback, min, max) {
  const numeric = Number.parseInt(value, 10);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return clamp(numeric, min, max);
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

function normalizeDayKey(input) {
  const value = String(input || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
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

function parseDayKey(dayKey) {
  const normalized = normalizeDayKey(dayKey);

  if (!normalized) {
    return null;
  }

  const [yearRaw, monthRaw, dayRaw] = normalized.split("-");
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  return { year, month, day };
}

function dayKeyToUtcMs(dayKey) {
  const parsed = parseDayKey(dayKey);

  if (!parsed) {
    return null;
  }

  return Date.UTC(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0);
}

function dayKeyToDate(dayKey) {
  const parsed = parseDayKey(dayKey);

  if (!parsed) {
    return new Date();
  }

  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0, 0));
}

function dayKeyDifference(fromDayKey, toDayKey) {
  const fromMs = dayKeyToUtcMs(fromDayKey);
  const toMs = dayKeyToUtcMs(toDayKey);

  if (fromMs == null || toMs == null) {
    return 0;
  }

  return Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

function addDaysToDayKey(dayKey, daysToAdd) {
  const baseMs = dayKeyToUtcMs(dayKey);

  if (baseMs == null) {
    return "";
  }

  const shiftedMs = baseMs + (daysToAdd * 24 * 60 * 60 * 1000);
  const date = new Date(shiftedMs);

  return [
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function dayKeyToUnixStart(dayKey) {
  const utcMs = dayKeyToUtcMs(dayKey);

  if (utcMs == null) {
    return Math.floor(Date.now() / 1000);
  }

  return Math.floor(utcMs / 1000);
}

function pruneGainByDayMap(gainByDay, referenceDayKey) {
  if (!gainByDay || typeof gainByDay !== "object") {
    return {};
  }

  const normalizedReferenceDayKey = normalizeDayKey(referenceDayKey) || getInflationDateParts().dayKey;
  const pruned = {};

  for (const [dayKeyRaw, amountRaw] of Object.entries(gainByDay)) {
    const dayKey = normalizeDayKey(dayKeyRaw);

    if (!dayKey) {
      continue;
    }

    const amount = toNonNegativeInteger(amountRaw, 0);

    if (amount <= 0) {
      continue;
    }

    const ageInDays = dayKeyDifference(dayKey, normalizedReferenceDayKey);

    if (ageInDays < 0 || ageInDays > GAIN_DAY_RETENTION_DAYS) {
      continue;
    }

    pruned[dayKey] = amount;
  }

  return pruned;
}

function createDefaultMissionProgress() {
  return DAILY_MISSION_DEFINITIONS.reduce((acc, mission) => {
    acc[mission.id] = 0;
    return acc;
  }, {});
}

function createEmptyMissionState() {
  return {
    dayKey: "",
    progress: createDefaultMissionProgress(),
    rewardedByMission: {},
    allCompletedBonusGranted: false,
    totalAwardedToday: 0
  };
}

function normalizeMissionState(input) {
  const progress = createDefaultMissionProgress();

  if (input?.progress && typeof input.progress === "object" && !Array.isArray(input.progress)) {
    for (const mission of DAILY_MISSION_DEFINITIONS) {
      progress[mission.id] = toNonNegativeInteger(input.progress[mission.id], 0);
    }
  }

  const rewardedByMission = {};

  if (
    input?.rewardedByMission
    && typeof input.rewardedByMission === "object"
    && !Array.isArray(input.rewardedByMission)
  ) {
    for (const mission of DAILY_MISSION_DEFINITIONS) {
      rewardedByMission[mission.id] = input.rewardedByMission[mission.id] === true;
    }
  }

  return {
    dayKey: normalizeDayKey(input?.dayKey),
    progress,
    rewardedByMission,
    allCompletedBonusGranted: input?.allCompletedBonusGranted === true,
    totalAwardedToday: toNonNegativeInteger(input?.totalAwardedToday, 0)
  };
}
function createEmptyInvestmentState() {
  return {
    balance: 0,
    principalNet: 0,
    totalDeposited: 0,
    totalWithdrawn: 0,
    totalYield: 0,
    lastAppliedDayKey: "",
    history: []
  };
}

function normalizeInvestmentHistoryEntry(input) {
  const type = String(input?.type || "event").trim() || "event";

  return {
    type,
    amount: Number.isFinite(Number(input?.amount)) ? Number(input.amount) : 0,
    dayKey: normalizeDayKey(input?.dayKey),
    createdAt: String(input?.createdAt || "").trim() || new Date().toISOString(),
    note: String(input?.note || "").trim() || ""
  };
}

function normalizeInvestmentState(input) {
  const normalized = {
    balance: Math.max(0, toFiniteNumber(input?.balance, 0)),
    principalNet: Math.max(0, toFiniteNumber(input?.principalNet, 0)),
    totalDeposited: Math.max(0, toFiniteNumber(input?.totalDeposited, 0)),
    totalWithdrawn: Math.max(0, toFiniteNumber(input?.totalWithdrawn, 0)),
    totalYield: toFiniteNumber(input?.totalYield, 0),
    lastAppliedDayKey: normalizeDayKey(input?.lastAppliedDayKey),
    history: []
  };

  if (Array.isArray(input?.history)) {
    normalized.history = input.history
      .map(normalizeInvestmentHistoryEntry)
      .slice(-INVESTMENT_HISTORY_LIMIT);
  }

  return normalized;
}

function createEmptyDailyClaimState() {
  return {
    lastClaimDayKey: "",
    streak: 0,
    bestStreak: 0,
    totalClaims: 0,
    totalEarned: 0
  };
}

function normalizeDailyClaimState(input) {
  return {
    lastClaimDayKey: normalizeDayKey(input?.lastClaimDayKey),
    streak: toNonNegativeInteger(input?.streak, 0),
    bestStreak: toNonNegativeInteger(input?.bestStreak, 0),
    totalClaims: toNonNegativeInteger(input?.totalClaims, 0),
    totalEarned: toNonNegativeInteger(input?.totalEarned, 0)
  };
}

function createEmptyUserGuildStats() {
  return {
    gainByDay: {},
    mission: createEmptyMissionState(),
    investment: createEmptyInvestmentState()
  };
}

function normalizeUserGuildStats(input) {
  const normalized = createEmptyUserGuildStats();

  normalized.gainByDay = pruneGainByDayMap(input?.gainByDay || {}, getInflationDateParts().dayKey);
  normalized.mission = normalizeMissionState(input?.mission);
  normalized.investment = normalizeInvestmentState(input?.investment);

  return normalized;
}

function normalizeUserGuildStatsMap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const normalized = {};

  for (const [guildId, guildStats] of Object.entries(input)) {
    if (!isValidSnowflake(guildId)) {
      continue;
    }

    normalized[guildId] = normalizeUserGuildStats(guildStats);
  }

  return normalized;
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
      String(input?.eventLabel || "Mercado em oscilacao normal.").trim()
      || "Mercado em oscilacao normal."
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

function resolveDefaultChatRewardSettings() {
  return {
    messagesPerReward: toIntegerInRange(
      config?.economy?.chatRewards?.messagesPerReward,
      DEFAULT_MESSAGES_PER_REWARD,
      1,
      500
    ),
    pointsPerReward: toIntegerInRange(
      config?.economy?.chatRewards?.pointsPerReward,
      DEFAULT_POINTS_PER_REWARD,
      10,
      100_000
    ),
    spamWindowMs: toIntegerInRange(config?.economy?.chatRewards?.spamWindowMs, 10_000, 1000, 60_000),
    spamMessageLimit: toIntegerInRange(config?.economy?.chatRewards?.spamMessageLimit, 10, 2, 30),
    spamCooldownBaseMs: toIntegerInRange(
      config?.economy?.chatRewards?.spamCooldownBaseMs,
      10_000,
      1000,
      300_000
    ),
    spamCooldownMaxMs: toIntegerInRange(
      config?.economy?.chatRewards?.spamCooldownMaxMs,
      60_000,
      1000,
      600_000
    ),
    spamStrikeResetMs: toIntegerInRange(
      config?.economy?.chatRewards?.spamStrikeResetMs,
      60_000,
      5000,
      3_600_000
    ),
    backlogDeleteLimit: toIntegerInRange(
      config?.economy?.chatRewards?.backlogDeleteLimit,
      8,
      0,
      30
    ),
    spamWarnCooldownMs: toIntegerInRange(
      config?.economy?.chatRewards?.spamWarnCooldownMs,
      2500,
      0,
      60_000
    ),
    autoMuteCooldownThresholdMs: toIntegerInRange(
      config?.economy?.chatRewards?.autoMuteCooldownThresholdMs,
      30_000,
      0,
      600_000
    ),
    autoMuteDurationMs: toIntegerInRange(
      config?.economy?.chatRewards?.autoMuteDurationMs,
      600_000,
      60_000,
      2_419_200_000
    ),
    rewardNoticeDeleteAfterSeconds: toIntegerInRange(
      config?.economy?.chatRewards?.rewardNoticeDeleteAfterSeconds,
      15,
      0,
      300
    )
  };
}

function resolveDefaultInflationSettings() {
  return {
    minDailyPercent: clamp(
      toFiniteNumber(config?.economy?.inflation?.minDailyPercent, -5),
      -40,
      40
    ),
    maxDailyPercent: clamp(
      toFiniteNumber(config?.economy?.inflation?.maxDailyPercent, 15),
      -40,
      40
    ),
    extremeEventChancePercent: clamp(
      toFiniteNumber(config?.economy?.inflation?.extremeEventChancePercent, 12),
      0,
      100
    ),
    extremeSwingMinPercent: clamp(
      toFiniteNumber(config?.economy?.inflation?.extremeSwingMinPercent, 8),
      0,
      60
    ),
    extremeSwingMaxPercent: clamp(
      toFiniteNumber(config?.economy?.inflation?.extremeSwingMaxPercent, 20),
      0,
      80
    )
  };
}

function normalizeChatRewardSettings(input, fallback = resolveDefaultChatRewardSettings()) {
  const normalized = {
    messagesPerReward: toIntegerInRange(
      input?.messagesPerReward,
      fallback.messagesPerReward,
      1,
      500
    ),
    pointsPerReward: toIntegerInRange(
      input?.pointsPerReward,
      fallback.pointsPerReward,
      10,
      100_000
    ),
    spamWindowMs: toIntegerInRange(input?.spamWindowMs, fallback.spamWindowMs, 1000, 60_000),
    spamMessageLimit: toIntegerInRange(input?.spamMessageLimit, fallback.spamMessageLimit, 2, 30),
    spamCooldownBaseMs: toIntegerInRange(
      input?.spamCooldownBaseMs,
      fallback.spamCooldownBaseMs,
      1000,
      300_000
    ),
    spamCooldownMaxMs: toIntegerInRange(
      input?.spamCooldownMaxMs,
      fallback.spamCooldownMaxMs,
      1000,
      600_000
    ),
    spamStrikeResetMs: toIntegerInRange(
      input?.spamStrikeResetMs,
      fallback.spamStrikeResetMs,
      5000,
      3_600_000
    ),
    backlogDeleteLimit: toIntegerInRange(
      input?.backlogDeleteLimit,
      fallback.backlogDeleteLimit,
      0,
      30
    ),
    spamWarnCooldownMs: toIntegerInRange(
      input?.spamWarnCooldownMs,
      fallback.spamWarnCooldownMs,
      0,
      60_000
    ),
    autoMuteCooldownThresholdMs: toIntegerInRange(
      input?.autoMuteCooldownThresholdMs,
      fallback.autoMuteCooldownThresholdMs,
      0,
      600_000
    ),
    autoMuteDurationMs: toIntegerInRange(
      input?.autoMuteDurationMs,
      fallback.autoMuteDurationMs,
      60_000,
      2_419_200_000
    ),
    rewardNoticeDeleteAfterSeconds: toIntegerInRange(
      input?.rewardNoticeDeleteAfterSeconds,
      fallback.rewardNoticeDeleteAfterSeconds,
      0,
      300
    )
  };

  normalized.spamCooldownMaxMs = Math.max(
    normalized.spamCooldownBaseMs,
    normalized.spamCooldownMaxMs
  );

  return normalized;
}

function normalizeInflationSettings(input, fallback = resolveDefaultInflationSettings()) {
  const minDailyPercent = clamp(
    toFiniteNumber(input?.minDailyPercent, fallback.minDailyPercent),
    -40,
    40
  );
  const maxDailyPercent = clamp(
    toFiniteNumber(input?.maxDailyPercent, fallback.maxDailyPercent),
    -40,
    40
  );
  const normalizedMinDaily = Math.min(minDailyPercent, maxDailyPercent);
  const normalizedMaxDaily = Math.max(minDailyPercent, maxDailyPercent);

  const extremeSwingMinPercent = clamp(
    toFiniteNumber(input?.extremeSwingMinPercent, fallback.extremeSwingMinPercent),
    0,
    60
  );
  const extremeSwingMaxPercent = clamp(
    toFiniteNumber(input?.extremeSwingMaxPercent, fallback.extremeSwingMaxPercent),
    0,
    80
  );

  return {
    minDailyPercent: normalizedMinDaily,
    maxDailyPercent: normalizedMaxDaily,
    extremeEventChancePercent: clamp(
      toFiniteNumber(input?.extremeEventChancePercent, fallback.extremeEventChancePercent),
      0,
      100
    ),
    extremeSwingMinPercent: Math.min(extremeSwingMinPercent, extremeSwingMaxPercent),
    extremeSwingMaxPercent: Math.max(extremeSwingMinPercent, extremeSwingMaxPercent)
  };
}

function createDefaultSettings() {
  return {
    chatRewards: normalizeChatRewardSettings(),
    inflation: normalizeInflationSettings()
  };
}

function normalizeSettings(input) {
  const fallback = createDefaultSettings();

  return {
    chatRewards: normalizeChatRewardSettings(input?.chatRewards, fallback.chatRewards),
    inflation: normalizeInflationSettings(input?.inflation, fallback.inflation)
  };
}

function normalizeAuditLogEntry(input) {
  const before =
    input?.before && typeof input.before === "object" && !Array.isArray(input.before)
      ? clonePlain(input.before)
      : null;
  const after =
    input?.after && typeof input.after === "object" && !Array.isArray(input.after)
      ? clonePlain(input.after)
      : null;

  return {
    id: String(input?.id || "").trim() || `A${Date.now()}`,
    createdAt: String(input?.createdAt || "").trim() || new Date().toISOString(),
    actorId: isValidSnowflake(input?.actorId) ? String(input.actorId) : "",
    actorTag: String(input?.actorTag || "").trim() || "",
    guildId: isValidSnowflake(input?.guildId) ? String(input.guildId) : "",
    action: String(input?.action || "settings-update").trim() || "settings-update",
    reason: String(input?.reason || "").trim(),
    before,
    after
  };
}

function createEmptyStore() {
  return {
    version: STORE_VERSION,
    nextRedemptionId: 1,
    nextAuditId: 1,
    settings: createDefaultSettings(),
    users: {},
    guilds: {},
    redemptions: [],
    auditLogs: []
  };
}

function normalizeUserRecord(input) {
  return {
    points: toNonNegativeInteger(input?.points, 0),
    messageProgress: toNonNegativeInteger(input?.messageProgress, 0),
    totalMessages: toNonNegativeInteger(input?.totalMessages, 0),
    totalPointsEarned: toNonNegativeInteger(input?.totalPointsEarned, 0),
    totalPointsSpent: toNonNegativeInteger(input?.totalPointsSpent, 0),
    totalPointsTransferredIn: toNonNegativeInteger(input?.totalPointsTransferredIn, 0),
    totalPointsTransferredOut: toNonNegativeInteger(input?.totalPointsTransferredOut, 0),
    gainBonusPercent: Math.min(
      MAX_TOTAL_BONUS_PERCENT,
      toNonNegativeInteger(input?.gainBonusPercent, 0)
    ),
    boosterInventory: normalizeBoosterInventory(input?.boosterInventory),
    dailyClaim: normalizeDailyClaimState(input?.dailyClaim || input?.daily),
    guildStats: normalizeUserGuildStatsMap(input?.guildStats)
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

  normalized.version = toNonNegativeInteger(rawStore.version, STORE_VERSION);
  normalized.nextRedemptionId = Math.max(
    1,
    toNonNegativeInteger(rawStore.nextRedemptionId, 1)
  );
  normalized.nextAuditId = Math.max(
    1,
    toNonNegativeInteger(rawStore.nextAuditId, 1)
  );
  normalized.settings = normalizeSettings(rawStore.settings);

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

  if (Array.isArray(rawStore.auditLogs)) {
    normalized.auditLogs = rawStore.auditLogs
      .map(normalizeAuditLogEntry)
      .slice(0, AUDIT_LOG_LIMIT);
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

function getEconomySettings() {
  const store = loadStore();
  store.settings = normalizeSettings(store.settings);
  return clonePlain(store.settings);
}

function getChatRewardSettings() {
  return getEconomySettings().chatRewards;
}

function nextAuditCode(store) {
  const code = `A${String(store.nextAuditId).padStart(6, "0")}`;
  store.nextAuditId += 1;
  return code;
}

function appendAuditLog(store, payload) {
  const entry = normalizeAuditLogEntry({
    id: nextAuditCode(store),
    createdAt: new Date().toISOString(),
    ...payload
  });

  store.auditLogs.unshift(entry);

  if (store.auditLogs.length > AUDIT_LOG_LIMIT) {
    store.auditLogs = store.auditLogs.slice(0, AUDIT_LOG_LIMIT);
  }

  return entry;
}

function updateEconomySettings(patch = {}, context = {}) {
  const store = loadStore();
  const before = normalizeSettings(store.settings);
  const merged = {
    chatRewards: {
      ...before.chatRewards,
      ...(patch?.chatRewards || {})
    },
    inflation: {
      ...before.inflation,
      ...(patch?.inflation || {})
    }
  };
  const after = normalizeSettings(merged);
  const changed = JSON.stringify(before) !== JSON.stringify(after);

  if (!changed) {
    return {
      changed: false,
      before,
      after,
      audit: null
    };
  }

  store.settings = after;
  const audit = appendAuditLog(store, {
    actorId: context?.actorId,
    actorTag: context?.actorTag,
    guildId: context?.guildId,
    action: context?.action || "settings-update",
    reason: String(context?.reason || "").trim().slice(0, 300),
    before,
    after
  });

  persistStore();

  return {
    changed: true,
    before,
    after,
    audit
  };
}

function getEconomyAuditLogs(limit = 10) {
  const store = loadStore();
  const normalizedLimit = clamp(toNonNegativeInteger(limit, 10), 1, 50);
  return clonePlain(store.auditLogs.slice(0, normalizedLimit));
}

function getInflationRangeSettings() {
  const settings = getEconomySettings().inflation;
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

function calculateBoosterPointsPerReward(record, chatSettings) {
  const bonusPercent = Math.min(
    MAX_TOTAL_BONUS_PERCENT,
    toNonNegativeInteger(record?.gainBonusPercent, 0)
  );
  const basePointsPerReward = toIntegerInRange(
    chatSettings?.pointsPerReward,
    DEFAULT_POINTS_PER_REWARD,
    10,
    100_000
  );

  return Math.max(1, Math.floor((basePointsPerReward * (100 + bonusPercent)) / 100));
}

function resolveServerBoosterMultiplier(options) {
  if (!options || typeof options !== "object") {
    return 1;
  }

  return options.isServerBooster === true ? SERVER_BOOSTER_GAIN_MULTIPLIER : 1;
}

function calculateRewardPointsPerCycle(record, inflationSnapshot, chatSettings, options = {}) {
  const boosterPointsPerReward = calculateBoosterPointsPerReward(record, chatSettings);
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
      emoji: "??",
      label: "Economia Aquecida"
    };
  }

  if (dailyPercent <= -4 || priceMultiplier <= 0.9) {
    return {
      key: "recession",
      emoji: "??",
      label: "Recessao"
    };
  }

  return {
    key: "stable",
    emoji: "??",
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
function ensureUserGuildStats(record, guildId) {
  const normalizedGuildId = assertGuildId(guildId);

  if (!record.guildStats || typeof record.guildStats !== "object" || Array.isArray(record.guildStats)) {
    record.guildStats = {};
  }

  if (!record.guildStats[normalizedGuildId]) {
    record.guildStats[normalizedGuildId] = createEmptyUserGuildStats();
  }

  return {
    guildId: normalizedGuildId,
    stats: record.guildStats[normalizedGuildId]
  };
}

function addGainForRanking(record, guildId, amount, date = new Date()) {
  const normalizedGuildId = normalizeGuildId(guildId);
  const gainAmount = toNonNegativeInteger(amount, 0);

  if (!normalizedGuildId || gainAmount <= 0) {
    return;
  }

  const { stats } = ensureUserGuildStats(record, normalizedGuildId);
  const { dayKey } = getInflationDateParts(date);
  const current = toNonNegativeInteger(stats.gainByDay[dayKey], 0);
  stats.gainByDay[dayKey] = current + gainAmount;
  stats.gainByDay = pruneGainByDayMap(stats.gainByDay, dayKey);
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

function ensureMissionState(stats, date = new Date()) {
  const { dayKey } = getInflationDateParts(date);

  if (stats.mission.dayKey !== dayKey) {
    stats.mission = createEmptyMissionState();
    stats.mission.dayKey = dayKey;
    return {
      changed: true,
      dayKey,
      missionState: stats.mission
    };
  }

  return {
    changed: false,
    dayKey,
    missionState: stats.mission
  };
}

function buildMissionStatusSnapshot(missionState) {
  const missions = DAILY_MISSION_DEFINITIONS.map((definition) => {
    const progressRaw = toNonNegativeInteger(missionState.progress[definition.id], 0);
    const progress = Math.min(definition.target, progressRaw);
    const completed = progress >= definition.target;
    const rewardGranted = missionState.rewardedByMission[definition.id] === true;
    const completionPercent = Math.min(100, Math.round((progress / definition.target) * 100));

    return {
      id: definition.id,
      event: definition.event,
      label: definition.label,
      target: definition.target,
      progress,
      completed,
      rewardPoints: definition.rewardPoints,
      rewardGranted,
      completionPercent
    };
  });

  const completedCount = missions.filter((mission) => mission.completed).length;
  const rewardedCount = missions.filter((mission) => mission.rewardGranted).length;

  return {
    dayKey: missionState.dayKey,
    missions,
    completedCount,
    rewardedCount,
    allCompleted: completedCount === DAILY_MISSION_DEFINITIONS.length,
    allRewardsGranted: rewardedCount === DAILY_MISSION_DEFINITIONS.length,
    allCompletedBonusGranted: missionState.allCompletedBonusGranted === true,
    totalAwardedToday: toNonNegativeInteger(missionState.totalAwardedToday, 0)
  };
}

function getDailyMissionStatus(userId, guildId, date = new Date()) {
  const normalizedGuildId = normalizeGuildId(guildId);
  const { record } = ensureUser(userId);

  if (!normalizedGuildId) {
    return {
      ok: false,
      reason: "INVALID_GUILD",
      status: buildMissionStatusSnapshot(createEmptyMissionState())
    };
  }

  const { stats } = ensureUserGuildStats(record, normalizedGuildId);
  const missionStateResult = ensureMissionState(stats, date);

  if (missionStateResult.changed) {
    persistStore();
  }

  const status = buildMissionStatusSnapshot(missionStateResult.missionState);
  const nextDayKey = addDaysToDayKey(status.dayKey, 1);

  return {
    ok: true,
    guildId: normalizedGuildId,
    nextResetAtUnix: dayKeyToUnixStart(nextDayKey),
    status
  };
}

function trackDailyMissionProgress(userId, guildId, eventKey, amount = 1, date = new Date()) {
  const normalizedGuildId = normalizeGuildId(guildId);
  const normalizedAmount = toNonNegativeInteger(amount, 0);
  const missionId = DAILY_MISSION_ID_BY_EVENT[String(eventKey || "").trim()];

  if (!normalizedGuildId || !missionId || normalizedAmount <= 0) {
    return {
      ok: false,
      reason: "IGNORED",
      awardedPoints: 0,
      completedRewards: [],
      bonusGranted: false,
      status: null
    };
  }

  const missionDefinition = DAILY_MISSION_BY_ID.get(missionId);

  if (!missionDefinition) {
    return {
      ok: false,
      reason: "MISSION_NOT_FOUND",
      awardedPoints: 0,
      completedRewards: [],
      bonusGranted: false,
      status: null
    };
  }

  const { record } = ensureUser(userId);
  const { stats } = ensureUserGuildStats(record, normalizedGuildId);
  const missionStateResult = ensureMissionState(stats, date);
  const missionState = missionStateResult.missionState;

  const previousProgress = toNonNegativeInteger(missionState.progress[missionId], 0);
  missionState.progress[missionId] = Math.min(
    missionDefinition.target,
    previousProgress + normalizedAmount
  );

  let awardedPoints = 0;
  const completedRewards = [];

  for (const definition of DAILY_MISSION_DEFINITIONS) {
    const progress = toNonNegativeInteger(missionState.progress[definition.id], 0);
    const completed = progress >= definition.target;
    const alreadyRewarded = missionState.rewardedByMission[definition.id] === true;

    if (!completed || alreadyRewarded) {
      continue;
    }

    missionState.rewardedByMission[definition.id] = true;
    awardedPoints += definition.rewardPoints;
    completedRewards.push({
      id: definition.id,
      label: definition.label,
      rewardPoints: definition.rewardPoints
    });
  }

  let bonusGranted = false;
  const allMissionsCompleted = DAILY_MISSION_DEFINITIONS.every((definition) => {
    const progress = toNonNegativeInteger(missionState.progress[definition.id], 0);
    return progress >= definition.target;
  });

  if (allMissionsCompleted && missionState.allCompletedBonusGranted !== true) {
    missionState.allCompletedBonusGranted = true;
    bonusGranted = true;
    awardedPoints += DAILY_MISSION_ALL_COMPLETED_BONUS_POINTS;
  }

  if (awardedPoints > 0) {
    record.points += awardedPoints;
    record.totalPointsEarned += awardedPoints;
    missionState.totalAwardedToday += awardedPoints;
    addGainForRanking(record, normalizedGuildId, awardedPoints, date);
  }

  persistStore();

  const status = buildMissionStatusSnapshot(missionState);

  return {
    ok: true,
    awardedPoints,
    completedRewards,
    bonusGranted,
    bonusRewardPoints: bonusGranted ? DAILY_MISSION_ALL_COMPLETED_BONUS_POINTS : 0,
    status
  };
}

function getDailyRewardState(record) {
  if (!record.dailyClaim || typeof record.dailyClaim !== "object" || Array.isArray(record.dailyClaim)) {
    record.dailyClaim = createEmptyDailyClaimState();
  }

  return record.dailyClaim;
}

function claimDailyReward(userId, guildId, date = new Date()) {
  const { record } = ensureUser(userId);
  const dayState = getDailyRewardState(record);
  const { dayKey } = getInflationDateParts(date);

  if (dayState.lastClaimDayKey === dayKey) {
    const nextDayKey = addDaysToDayKey(dayKey, 1);

    return {
      ok: false,
      reason: "ALREADY_CLAIMED",
      dayKey,
      streak: dayState.streak,
      nextClaimAtUnix: dayKeyToUnixStart(nextDayKey)
    };
  }

  const dayDiff = dayState.lastClaimDayKey
    ? dayKeyDifference(dayState.lastClaimDayKey, dayKey)
    : 0;

  let nextStreak = 1;

  if (dayDiff === 1) {
    nextStreak = dayState.streak + 1;
  }

  const bonusPercent = clamp(
    Math.max(0, nextStreak - 1) * DAILY_REWARD_BONUS_STEP_PERCENT,
    0,
    DAILY_REWARD_MAX_BONUS_PERCENT
  );

  const awardedPoints = Math.max(
    1,
    Math.round(DAILY_REWARD_BASE_POINTS * (1 + (bonusPercent / 100)))
  );

  dayState.lastClaimDayKey = dayKey;
  dayState.streak = nextStreak;
  dayState.bestStreak = Math.max(dayState.bestStreak, nextStreak);
  dayState.totalClaims += 1;
  dayState.totalEarned += awardedPoints;

  record.points += awardedPoints;
  record.totalPointsEarned += awardedPoints;
  addGainForRanking(record, guildId, awardedPoints, date);

  persistStore();

  const nextBonusPercent = clamp(
    nextStreak * DAILY_REWARD_BONUS_STEP_PERCENT,
    0,
    DAILY_REWARD_MAX_BONUS_PERCENT
  );

  return {
    ok: true,
    dayKey,
    awardedPoints,
    basePoints: DAILY_REWARD_BASE_POINTS,
    bonusPercent,
    streak: nextStreak,
    bestStreak: dayState.bestStreak,
    totalClaims: dayState.totalClaims,
    totalEarned: dayState.totalEarned,
    points: record.points,
    nextBonusPercent,
    nextClaimAtUnix: dayKeyToUnixStart(addDaysToDayKey(dayKey, 1))
  };
}
function buildInvestmentPublicState(investment, options = {}) {
  const balance = Math.max(0, Math.round(investment.balance));
  const withdrawFee = Math.ceil(balance * (INVESTMENT_WITHDRAW_FEE_PERCENT / 100));
  const withdrawableToday = Math.max(0, balance - withdrawFee);

  return {
    balance,
    principalNet: Math.max(0, Math.round(investment.principalNet)),
    totalDeposited: Math.max(0, Math.round(investment.totalDeposited)),
    totalWithdrawn: Math.max(0, Math.round(investment.totalWithdrawn)),
    totalYield: Math.round(investment.totalYield),
    lastAppliedDayKey: normalizeDayKey(investment.lastAppliedDayKey),
    withdrawFeePercent: INVESTMENT_WITHDRAW_FEE_PERCENT,
    withdrawFee,
    withdrawableToday,
    pendingAppliedDays: toNonNegativeInteger(options.pendingAppliedDays, 0),
    pendingDelta: Math.round(toFiniteNumber(options.pendingDelta, 0)),
    history: Array.isArray(investment.history)
      ? investment.history.slice(-8).reverse().map((entry) => ({
        type: entry.type,
        amount: Math.round(toFiniteNumber(entry.amount, 0)),
        dayKey: normalizeDayKey(entry.dayKey),
        createdAt: entry.createdAt,
        note: String(entry.note || "")
      }))
      : []
  };
}

function pushInvestmentHistory(investment, entry) {
  investment.history.push(normalizeInvestmentHistoryEntry(entry));

  if (investment.history.length > INVESTMENT_HISTORY_LIMIT) {
    investment.history = investment.history.slice(-INVESTMENT_HISTORY_LIMIT);
  }
}

function rollInvestmentDailyPercent(inflationSnapshot) {
  const inflationImpactPercent = toFiniteNumber(inflationSnapshot?.investmentImpactPercent, 0);
  const baseFromInflation = inflationImpactPercent * 0.35;
  const randomSwing = randomBetween(-3.5, 3.5);
  const carryCost = -0.2;

  return clamp(baseFromInflation + randomSwing + carryCost, -12, 12);
}

function applyPendingInvestmentYield(record, guildId, date = new Date()) {
  const normalizedGuildId = normalizeGuildId(guildId);

  if (!normalizedGuildId) {
    return {
      changed: false,
      appliedDays: 0,
      totalDelta: 0
    };
  }

  const { stats } = ensureUserGuildStats(record, normalizedGuildId);
  const investment = stats.investment;
  const { dayKey: currentDayKey } = getInflationDateParts(date);

  if (!investment.lastAppliedDayKey) {
    investment.lastAppliedDayKey = currentDayKey;
    return {
      changed: true,
      appliedDays: 0,
      totalDelta: 0
    };
  }

  const pendingDays = dayKeyDifference(investment.lastAppliedDayKey, currentDayKey);

  if (pendingDays <= 0) {
    return {
      changed: false,
      appliedDays: 0,
      totalDelta: 0
    };
  }

  const inflationSnapshot = getInflationSnapshot(normalizedGuildId, date);
  let totalDelta = 0;
  let appliedDays = 0;

  for (let dayOffset = 1; dayOffset <= pendingDays; dayOffset += 1) {
    const applyDayKey = addDaysToDayKey(investment.lastAppliedDayKey, 1);

    if (!applyDayKey) {
      break;
    }

    appliedDays += 1;

    if (investment.balance > 0) {
      const dailyPercent = rollInvestmentDailyPercent(inflationSnapshot);
      const deltaRaw = investment.balance * (dailyPercent / 100);
      const deltaRounded = Math.round(deltaRaw);
      const nextBalance = Math.max(0, investment.balance + deltaRounded);
      const appliedDelta = nextBalance - investment.balance;

      investment.balance = nextBalance;
      investment.totalYield += appliedDelta;
      totalDelta += appliedDelta;

      if (appliedDelta !== 0) {
        const signal = appliedDelta >= 0 ? "+" : "";

        pushInvestmentHistory(investment, {
          type: "yield",
          amount: appliedDelta,
          dayKey: applyDayKey,
          note: `${signal}${appliedDelta} pontos (${dailyPercent.toFixed(2)}%)`
        });

        if (appliedDelta > 0) {
          addGainForRanking(record, normalizedGuildId, appliedDelta, dayKeyToDate(applyDayKey));
        }
      }
    }

    investment.lastAppliedDayKey = applyDayKey;
  }

  return {
    changed: appliedDays > 0,
    appliedDays,
    totalDelta
  };
}

function getInvestmentPortfolio(userId, guildId, date = new Date()) {
  const normalizedGuildId = normalizeGuildId(guildId);
  const { record } = ensureUser(userId);

  if (!normalizedGuildId) {
    return {
      ok: false,
      reason: "INVALID_GUILD",
      portfolio: buildInvestmentPublicState(createEmptyInvestmentState())
    };
  }

  const { stats } = ensureUserGuildStats(record, normalizedGuildId);
  const sync = applyPendingInvestmentYield(record, normalizedGuildId, date);

  if (sync.changed) {
    persistStore();
  }

  return {
    ok: true,
    points: record.points,
    guildId: normalizedGuildId,
    portfolio: buildInvestmentPublicState(stats.investment, {
      pendingAppliedDays: sync.appliedDays,
      pendingDelta: sync.totalDelta
    })
  };
}

function investPoints(userId, guildId, amount, date = new Date()) {
  const normalizedGuildId = normalizeGuildId(guildId);
  const investAmount = toNonNegativeInteger(amount, 0);

  if (!normalizedGuildId) {
    return {
      ok: false,
      reason: "INVALID_GUILD"
    };
  }

  if (investAmount <= 0) {
    return {
      ok: false,
      reason: "INVALID_AMOUNT"
    };
  }

  const { record } = ensureUser(userId);
  const { stats } = ensureUserGuildStats(record, normalizedGuildId);
  const sync = applyPendingInvestmentYield(record, normalizedGuildId, date);

  if (record.points < investAmount) {
    if (sync.changed) {
      persistStore();
    }

    return {
      ok: false,
      reason: "INSUFFICIENT_POINTS",
      points: record.points,
      missingPoints: investAmount - record.points,
      portfolio: buildInvestmentPublicState(stats.investment, {
        pendingAppliedDays: sync.appliedDays,
        pendingDelta: sync.totalDelta
      })
    };
  }

  const { dayKey } = getInflationDateParts(date);

  record.points -= investAmount;
  stats.investment.balance += investAmount;
  stats.investment.principalNet += investAmount;
  stats.investment.totalDeposited += investAmount;

  if (!stats.investment.lastAppliedDayKey) {
    stats.investment.lastAppliedDayKey = dayKey;
  }

  pushInvestmentHistory(stats.investment, {
    type: "deposit",
    amount: investAmount,
    dayKey,
    note: `Aplicacao de ${investAmount} pontos`
  });

  persistStore();

  return {
    ok: true,
    depositedAmount: investAmount,
    points: record.points,
    portfolio: buildInvestmentPublicState(stats.investment, {
      pendingAppliedDays: sync.appliedDays,
      pendingDelta: sync.totalDelta
    })
  };
}

function withdrawInvestment(userId, guildId, amount, date = new Date()) {
  const normalizedGuildId = normalizeGuildId(guildId);
  const withdrawAmount = toNonNegativeInteger(amount, 0);

  if (!normalizedGuildId) {
    return {
      ok: false,
      reason: "INVALID_GUILD"
    };
  }

  if (withdrawAmount <= 0) {
    return {
      ok: false,
      reason: "INVALID_AMOUNT"
    };
  }

  const { record } = ensureUser(userId);
  const { stats } = ensureUserGuildStats(record, normalizedGuildId);
  const sync = applyPendingInvestmentYield(record, normalizedGuildId, date);
  const investment = stats.investment;

  if (withdrawAmount > investment.balance) {
    if (sync.changed) {
      persistStore();
    }

    return {
      ok: false,
      reason: "INSUFFICIENT_INVESTMENT_BALANCE",
      available: Math.max(0, Math.floor(investment.balance)),
      missing: Math.max(0, Math.ceil(withdrawAmount - investment.balance)),
      portfolio: buildInvestmentPublicState(investment, {
        pendingAppliedDays: sync.appliedDays,
        pendingDelta: sync.totalDelta
      })
    };
  }

  const { dayKey } = getInflationDateParts(date);
  const fee = Math.ceil(withdrawAmount * (INVESTMENT_WITHDRAW_FEE_PERCENT / 100));
  const netAmount = Math.max(0, withdrawAmount - fee);

  investment.balance = Math.max(0, investment.balance - withdrawAmount);
  investment.principalNet = Math.max(0, investment.principalNet - withdrawAmount);
  investment.totalWithdrawn += withdrawAmount;
  record.points += netAmount;

  pushInvestmentHistory(investment, {
    type: "withdraw",
    amount: -withdrawAmount,
    dayKey,
    note: `Saque bruto ${withdrawAmount} | taxa ${fee} | liquido ${netAmount}`
  });

  persistStore();

  return {
    ok: true,
    grossAmount: withdrawAmount,
    fee,
    netAmount,
    points: record.points,
    portfolio: buildInvestmentPublicState(investment, {
      pendingAppliedDays: sync.appliedDays,
      pendingDelta: sync.totalDelta
    })
  };
}

function resolveRankingPeriod(period) {
  const normalized = String(period || "global").trim().toLowerCase();

  if (normalized === "weekly" || normalized === "semanal") {
    return {
      key: "weekly",
      label: "Semanal (ultimos 7 dias)",
      days: 7
    };
  }

  if (normalized === "monthly" || normalized === "mensal") {
    return {
      key: "monthly",
      label: "Mensal (ultimos 30 dias)",
      days: 30
    };
  }

  return {
    key: "global",
    label: "Global",
    days: 0
  };
}

function buildDayKeyWindowSet(referenceDayKey, days) {
  const set = new Set();

  if (!normalizeDayKey(referenceDayKey) || days <= 0) {
    return set;
  }

  for (let offset = 0; offset < days; offset += 1) {
    const dayKey = addDaysToDayKey(referenceDayKey, -offset);

    if (dayKey) {
      set.add(dayKey);
    }
  }

  return set;
}

function sumDayMapInWindow(dayMap, dayWindowSet) {
  if (!dayMap || typeof dayMap !== "object" || dayWindowSet.size === 0) {
    return 0;
  }

  let total = 0;

  for (const [dayKey, amountRaw] of Object.entries(dayMap)) {
    if (!dayWindowSet.has(dayKey)) {
      continue;
    }

    total += toNonNegativeInteger(amountRaw, 0);
  }

  return total;
}

function getGuildRankingSnapshot(guildId, period = "global", viewerUserId = "") {
  const normalizedGuildId = normalizeGuildId(guildId);
  const rankingPeriod = resolveRankingPeriod(period);

  if (!normalizedGuildId) {
    return {
      ok: false,
      reason: "INVALID_GUILD",
      period: rankingPeriod,
      topEntries: [],
      totalParticipants: 0,
      viewer: {
        userId: isValidSnowflake(viewerUserId) ? String(viewerUserId) : "",
        position: null,
        score: 0,
        differenceToNext: null
      }
    };
  }

  const store = loadStore();
  const nowDayKey = getInflationDateParts().dayKey;
  const dayWindowSet = buildDayKeyWindowSet(nowDayKey, rankingPeriod.days);
  const entries = [];

  for (const [userId, record] of Object.entries(store.users)) {
    let score = 0;

    if (rankingPeriod.key === "global") {
      score = toNonNegativeInteger(record?.points, 0);
    } else {
      const userGuildStats = record?.guildStats?.[normalizedGuildId];

      if (!userGuildStats) {
        continue;
      }

      score = sumDayMapInWindow(userGuildStats.gainByDay, dayWindowSet);
    }

    if (score <= 0) {
      continue;
    }

    entries.push({
      userId,
      score
    });
  }

  entries.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    return a.userId.localeCompare(b.userId, "en");
  });

  const rankedEntries = entries.map((entry, index) => ({
    rank: index + 1,
    userId: entry.userId,
    score: entry.score
  }));

  const topEntries = rankedEntries.slice(0, 10);
  const normalizedViewerUserId = isValidSnowflake(viewerUserId) ? String(viewerUserId) : "";
  let viewerPosition = null;
  let viewerScore = 0;
  let differenceToNext = null;

  if (normalizedViewerUserId) {
    const viewerEntry = rankedEntries.find((entry) => entry.userId === normalizedViewerUserId);

    if (viewerEntry) {
      viewerPosition = viewerEntry.rank;
      viewerScore = viewerEntry.score;

      if (viewerEntry.rank > 1) {
        const nextEntry = rankedEntries[viewerEntry.rank - 2];

        if (nextEntry) {
          differenceToNext = Math.max(0, nextEntry.score - viewerEntry.score);
        }
      }
    }
  }

  return {
    ok: true,
    period: rankingPeriod,
    topEntries,
    totalParticipants: rankedEntries.length,
    viewer: {
      userId: normalizedViewerUserId,
      position: viewerPosition,
      score: viewerScore,
      differenceToNext
    }
  };
}
function toPublicUserSnapshot(record, inflationSnapshot, chatSettings, options = {}) {
  const messagesPerReward = toIntegerInRange(
    chatSettings?.messagesPerReward,
    DEFAULT_MESSAGES_PER_REWARD,
    1,
    500
  );
  const messageProgressRaw = toNonNegativeInteger(record?.messageProgress, 0);
  const messageProgress = messageProgressRaw % messagesPerReward;
  const gainBonusPercent = Math.min(
    MAX_TOTAL_BONUS_PERCENT,
    toNonNegativeInteger(record?.gainBonusPercent, 0)
  );
  const {
    boosterPointsPerReward,
    serverBoosterMultiplier,
    serverBoosterPointsPerReward,
    pointsPerReward
  } = calculateRewardPointsPerCycle(record, inflationSnapshot, chatSettings, options);

  return {
    points: toNonNegativeInteger(record?.points, 0),
    messageProgress,
    messagesPerReward,
    messagesToNextReward:
      messageProgress === 0 ? messagesPerReward : messagesPerReward - messageProgress,
    totalMessages: toNonNegativeInteger(record?.totalMessages, 0),
    totalPointsEarned: toNonNegativeInteger(record?.totalPointsEarned, 0),
    totalPointsSpent: toNonNegativeInteger(record?.totalPointsSpent, 0),
    totalPointsTransferredIn: toNonNegativeInteger(record?.totalPointsTransferredIn, 0),
    totalPointsTransferredOut: toNonNegativeInteger(record?.totalPointsTransferredOut, 0),
    gainBonusPercent,
    basePointsPerReward: toIntegerInRange(
      chatSettings?.pointsPerReward,
      DEFAULT_POINTS_PER_REWARD,
      10,
      100_000
    ),
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
  const chatSettings = getChatRewardSettings();
  const messagesPerReward = toIntegerInRange(
    chatSettings.messagesPerReward,
    DEFAULT_MESSAGES_PER_REWARD,
    1,
    500
  );

  record.totalMessages += 1;
  record.messageProgress += 1;

  let rewardCycles = 0;

  while (record.messageProgress >= messagesPerReward) {
    record.messageProgress -= messagesPerReward;
    rewardCycles += 1;
  }

  const {
    boosterPointsPerReward,
    serverBoosterMultiplier,
    serverBoosterPointsPerReward,
    pointsPerReward
  } = calculateRewardPointsPerCycle(record, inflationSnapshot, chatSettings, options);

  const basePointsPerReward = toIntegerInRange(
    chatSettings.pointsPerReward,
    DEFAULT_POINTS_PER_REWARD,
    10,
    100_000
  );
  const baseAwardedPoints = rewardCycles * basePointsPerReward;
  const boosterAwardedPoints = rewardCycles * (boosterPointsPerReward - basePointsPerReward);
  const serverBoosterAwardedPoints =
    rewardCycles * (serverBoosterPointsPerReward - boosterPointsPerReward);
  const awardedPoints = rewardCycles * pointsPerReward;
  const inflationAwardedPoints = awardedPoints - (rewardCycles * serverBoosterPointsPerReward);

  if (awardedPoints > 0) {
    record.points += awardedPoints;
    record.totalPointsEarned += awardedPoints;
    addGainForRanking(record, guildId, awardedPoints, new Date());
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
    messagesPerReward,
    ...toPublicUserSnapshot(record, inflationSnapshot, chatSettings, options)
  };
}

function getUserEconomy(userId, guildId = "", options = {}) {
  const { record } = ensureUser(userId);
  const inflationSnapshot = getInflationSnapshot(guildId);
  const chatSettings = getChatRewardSettings();
  return toPublicUserSnapshot(record, inflationSnapshot, chatSettings, options);
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
  const chatSettings = getChatRewardSettings();
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

  const rewardSnapshot = calculateRewardPointsPerCycle(
    record,
    inflationSnapshot,
    chatSettings,
    options
  );

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
  DAILY_MISSION_DEFINITIONS,
  DAILY_MISSION_ALL_COMPLETED_BONUS_POINTS,
  DAILY_REWARD_BASE_POINTS,
  DAILY_REWARD_BONUS_STEP_PERCENT,
  DAILY_REWARD_MAX_BONUS_PERCENT,
  INVESTMENT_WITHDRAW_FEE_PERCENT,
  registerChatMessage,
  getUserEconomy,
  countRedemptionsByItem,
  redeemShopItem,
  transferPoints,
  getInflationSnapshot,
  setInflationChannel,
  markInflationPublished,
  getInflationDateParts,
  getInflationAdjustedAmount,
  getChatRewardSettings,
  getEconomySettings,
  updateEconomySettings,
  getEconomyAuditLogs,
  claimDailyReward,
  getGuildRankingSnapshot,
  investPoints,
  withdrawInvestment,
  getInvestmentPortfolio,
  getDailyMissionStatus,
  trackDailyMissionProgress
};
