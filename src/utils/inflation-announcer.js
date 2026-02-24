const config = require("../config");
const logger = require("./logger");
const {
  getInflationDateParts,
  getInflationSnapshot,
  markInflationPublished
} = require("./economy-store");

const CHECK_INTERVAL_MS = 60 * 1000;

let inflationIntervalHandle = null;

function formatSignedPercent(value) {
  const numeric = Number(value) || 0;
  const signal = numeric >= 0 ? "+" : "";
  return `${signal}${numeric.toFixed(2)}%`;
}

function formatDirection(percent, positiveLabel, negativeLabel) {
  return (Number(percent) || 0) >= 0 ? positiveLabel : negativeLabel;
}

function buildInflationDailyMessage(snapshot) {
  const trendEmoji = snapshot.dailyPercent >= 0 ? "📈" : "📉";
  const compareEmoji = snapshot.deltaVsYesterday >= 0 ? "⬆️" : "⬇️";
  const salaryImpactAbs = Math.abs(snapshot.gainImpactPercent).toFixed(2);
  const priceImpactAbs = Math.abs(snapshot.priceImpactPercent).toFixed(2);
  const investmentImpactAbs = Math.abs(snapshot.investmentImpactPercent).toFixed(2);
  const salaryDirection = formatDirection(
    snapshot.gainImpactPercent,
    "a mais",
    "a menos"
  );
  const priceDirection = formatDirection(
    snapshot.priceImpactPercent,
    "mais altos",
    "mais baixos"
  );
  const investmentDirection = formatDirection(
    snapshot.investmentImpactPercent,
    "maiores",
    "menores"
  );

  return [
    `📊 **Boletim Diario de Inflacao (${snapshot.dayKey})**`,
    `${trendEmoji} Inflacao atual: **${formatSignedPercent(snapshot.dailyPercent)}**`,
    `${compareEmoji} Comparacao com ontem: **${formatSignedPercent(snapshot.deltaVsYesterday)}**`,
    `Impacto: hoje os salarios valem **${salaryImpactAbs}% ${salaryDirection}** e os precos estao **${priceImpactAbs}% ${priceDirection}**.`,
    `Investimentos: rendimentos estimados **${investmentImpactAbs}% ${investmentDirection}**.`,
    `Humor do mercado: ${snapshot.marketMoodEmoji} **${snapshot.marketMoodLabel}**`,
    `Evento do dia: ${snapshot.eventLabel}`
  ].join("\n");
}

function shouldPublishNow(parts) {
  const targetHour = config?.economy?.inflation?.dailyPostHour ?? 9;
  const targetMinute = config?.economy?.inflation?.dailyPostMinute ?? 0;

  if (parts.hour > targetHour) {
    return true;
  }

  if (parts.hour === targetHour && parts.minute >= targetMinute) {
    return true;
  }

  return false;
}

async function publishInflationForGuild(guild, snapshot) {
  if (!snapshot.channelId) {
    return;
  }

  const channel = guild.channels.cache.get(snapshot.channelId)
    || (await guild.channels.fetch(snapshot.channelId).catch(() => null));

  if (!channel || !channel.isTextBased() || typeof channel.send !== "function") {
    logger.warn(
      `Inflacao: canal configurado invalido para guild ${guild.id} (${snapshot.channelId}).`
    );
    return;
  }

  const message = buildInflationDailyMessage(snapshot);

  await channel.send({ content: message });
  markInflationPublished(guild.id, snapshot.dayKey);
  logger.info(`Inflacao: boletim diario publicado em ${guild.id} no canal ${channel.id}.`);
}

async function tickInflation(client) {
  if (!client?.isReady?.()) {
    return;
  }

  const nowParts = getInflationDateParts(new Date());
  const publishAllowed = shouldPublishNow(nowParts);

  for (const guild of client.guilds.cache.values()) {
    const snapshot = getInflationSnapshot(guild.id);

    if (!publishAllowed) {
      continue;
    }

    if (!snapshot.channelId || snapshot.lastPublishedDayKey === snapshot.dayKey) {
      continue;
    }

    try {
      await publishInflationForGuild(guild, snapshot);
    } catch (error) {
      logger.error(`Inflacao: falha ao publicar boletim na guild ${guild.id}.`, error);
    }
  }
}

function startInflationAnnouncer(client) {
  if (inflationIntervalHandle) {
    return;
  }

  const timezone = config?.economy?.inflation?.timezone || "America/Sao_Paulo";
  const hour = config?.economy?.inflation?.dailyPostHour ?? 9;
  const minute = config?.economy?.inflation?.dailyPostMinute ?? 0;

  const runTick = () => tickInflation(client).catch((error) => {
    logger.error("Inflacao: erro no agendador diario.", error);
  });

  setTimeout(runTick, 5_000);
  inflationIntervalHandle = setInterval(runTick, CHECK_INTERVAL_MS);

  if (typeof inflationIntervalHandle.unref === "function") {
    inflationIntervalHandle.unref();
  }

  logger.info(
    `Agendador de inflacao ativo (timezone ${timezone}, postagem diaria ${String(hour).padStart(
      2,
      "0"
    )}:${String(minute).padStart(2, "0")}).`
  );
}

module.exports = {
  startInflationAnnouncer
};

