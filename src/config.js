const dotenv = require("dotenv");

dotenv.config();

function parseIntegerEnv(name, fallback, options = {}) {
  const raw = process.env[name];

  if (raw == null || raw === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const min = typeof options.min === "number" ? options.min : Number.NEGATIVE_INFINITY;
  const max = typeof options.max === "number" ? options.max : Number.POSITIVE_INFINITY;

  return Math.min(max, Math.max(min, parsed));
}

function parseFloatEnv(name, fallback, options = {}) {
  const raw = process.env[name];

  if (raw == null || raw === "") {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const min = typeof options.min === "number" ? options.min : Number.NEGATIVE_INFINITY;
  const max = typeof options.max === "number" ? options.max : Number.POSITIVE_INFINITY;

  return Math.min(max, Math.max(min, parsed));
}

function parseDomainList(name, fallback) {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const domains = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[a-z0-9.-]+$/.test(entry));

  return domains.length > 0 ? [...new Set(domains)] : fallback;
}

const DEFAULT_ALLOWED_API_DOMAINS = [
  "api.waifu.pics",
  "waifu.pics",
  "nekos.best"
];

const DEFAULT_ALLOWED_MEDIA_DOMAINS = [
  "waifu.pics",
  "i.waifu.pics",
  "nekos.best",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "images-ext-1.discordapp.net",
  "images-ext-2.discordapp.net"
];

module.exports = {
  token: process.env.DISCORD_TOKEN || "",
  clientId: process.env.CLIENT_ID || "",
  guildId: process.env.GUILD_ID || "",
  http: {
    timeoutMs: parseIntegerEnv("HTTP_TIMEOUT_MS", 9000, { min: 1500, max: 20_000 }),
    maxRetries: parseIntegerEnv("HTTP_MAX_RETRIES", 2, { min: 0, max: 5 }),
    retryBaseMs: parseIntegerEnv("HTTP_RETRY_BASE_MS", 350, { min: 100, max: 3000 })
  },
  cooldown: {
    defaultMs: parseIntegerEnv("DEFAULT_COMMAND_COOLDOWN_MS", 2500, {
      min: 0,
      max: 30_000
    })
  },
  economy: {
    chatRewards: {
      spamWindowMs: parseIntegerEnv("ECONOMY_SPAM_WINDOW_MS", 10_000, {
        min: 1000,
        max: 60_000
      }),
      spamMessageLimit: parseIntegerEnv("ECONOMY_SPAM_MESSAGE_LIMIT", 10, {
        min: 2,
        max: 30
      }),
      spamCooldownBaseMs: parseIntegerEnv("ECONOMY_SPAM_COOLDOWN_BASE_MS", 10_000, {
        min: 1000,
        max: 300_000
      }),
      spamCooldownMaxMs: parseIntegerEnv("ECONOMY_SPAM_COOLDOWN_MAX_MS", 60_000, {
        min: 1000,
        max: 600_000
      }),
      spamStrikeResetMs: parseIntegerEnv("ECONOMY_SPAM_STRIKE_RESET_MS", 60_000, {
        min: 5000,
        max: 3_600_000
      }),
      backlogDeleteLimit: parseIntegerEnv("ECONOMY_SPAM_BACKLOG_DELETE_LIMIT", 8, {
        min: 0,
        max: 30
      }),
      spamWarnCooldownMs: parseIntegerEnv("ECONOMY_SPAM_WARN_COOLDOWN_MS", 2500, {
        min: 0,
        max: 60_000
      }),
      autoMuteCooldownThresholdMs: parseIntegerEnv(
        "ECONOMY_SPAM_AUTOMUTE_THRESHOLD_MS",
        30_000,
        {
          min: 0,
          max: 600_000
        }
      ),
      autoMuteDurationMs: parseIntegerEnv("ECONOMY_SPAM_AUTOMUTE_DURATION_MS", 600_000, {
        min: 60_000,
        max: 2_419_200_000
      }),
      rewardNoticeDeleteAfterSeconds: parseIntegerEnv(
        "ECONOMY_REWARD_NOTICE_DELETE_SECONDS",
        15,
        {
          min: 0,
          max: 300
        }
      )
    },
    inflation: {
      timezone: process.env.INFLATION_TIMEZONE || "America/Sao_Paulo",
      dailyPostHour: parseIntegerEnv("INFLATION_POST_HOUR", 9, {
        min: 0,
        max: 23
      }),
      dailyPostMinute: parseIntegerEnv("INFLATION_POST_MINUTE", 0, {
        min: 0,
        max: 59
      }),
      minDailyPercent: parseFloatEnv("INFLATION_DAILY_MIN_PERCENT", -5, {
        min: -40,
        max: 40
      }),
      maxDailyPercent: parseFloatEnv("INFLATION_DAILY_MAX_PERCENT", 15, {
        min: -40,
        max: 40
      }),
      extremeEventChancePercent: parseFloatEnv(
        "INFLATION_EXTREME_EVENT_CHANCE_PERCENT",
        12,
        { min: 0, max: 100 }
      ),
      extremeSwingMinPercent: parseFloatEnv(
        "INFLATION_EXTREME_SWING_MIN_PERCENT",
        8,
        { min: 0, max: 60 }
      ),
      extremeSwingMaxPercent: parseFloatEnv(
        "INFLATION_EXTREME_SWING_MAX_PERCENT",
        20,
        { min: 0, max: 80 }
      )
    }
  },
  security: {
    allowedApiDomains: parseDomainList(
      "ALLOWED_API_DOMAINS",
      DEFAULT_ALLOWED_API_DOMAINS
    ),
    allowedMediaDomains: parseDomainList(
      "ALLOWED_MEDIA_DOMAINS",
      DEFAULT_ALLOWED_MEDIA_DOMAINS
    )
  }
};
