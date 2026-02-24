const logger = require("../utils/logger");
const {
  getChatRewardSettings,
  registerChatMessage,
  trackDailyMissionProgress
} = require("../utils/economy-store");

const spamStateByUser = new Map();
let lastTrackerSweepAtMs = 0;

function toClampedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function resolveRuntimeChatSettings() {
  const source = getChatRewardSettings();

  return {
    spamWindowMs: toClampedInteger(source?.spamWindowMs, 10_000, 1000, 60_000),
    spamMessageLimit: toClampedInteger(source?.spamMessageLimit, 10, 2, 30),
    spamCooldownBaseMs: toClampedInteger(source?.spamCooldownBaseMs, 10_000, 1000, 300_000),
    spamCooldownMaxMs: toClampedInteger(source?.spamCooldownMaxMs, 60_000, 1000, 600_000),
    spamStrikeResetMs: toClampedInteger(source?.spamStrikeResetMs, 60_000, 5000, 3_600_000),
    backlogDeleteLimit: toClampedInteger(source?.backlogDeleteLimit, 8, 0, 30),
    spamWarnCooldownMs: toClampedInteger(source?.spamWarnCooldownMs, 2500, 0, 60_000),
    autoMuteCooldownThresholdMs: toClampedInteger(
      source?.autoMuteCooldownThresholdMs,
      30_000,
      0,
      600_000
    ),
    autoMuteDurationMs: toClampedInteger(source?.autoMuteDurationMs, 600_000, 60_000, 2_419_200_000),
    rewardNoticeDeleteAfterMs:
      toClampedInteger(source?.rewardNoticeDeleteAfterSeconds, 15, 0, 300) * 1000
  };
}

function trackerSweepIntervalMs(settings) {
  return Math.max(1000, Math.min(5000, settings.spamWindowMs));
}

function spamHistoryRetentionMs(settings) {
  return settings.spamWindowMs;
}

function trackerStateTtlMs(settings) {
  return Math.max(
    settings.spamWindowMs,
    spamHistoryRetentionMs(settings),
    settings.spamStrikeResetMs,
    settings.spamCooldownMaxMs
  ) * 2;
}

function isServerBooster(member) {
  return Boolean(member?.premiumSinceTimestamp || member?.premiumSince || member?.premium_since);
}

function getMessageTimestampMs(message) {
  const createdTimestamp = Number.parseInt(message?.createdTimestamp, 10);
  return Number.isFinite(createdTimestamp) && createdTimestamp > 0
    ? createdTimestamp
    : Date.now();
}

function pruneOldTimestamps(timestamps, cutoffMs) {
  while (timestamps.length > 0 && timestamps[0] < cutoffMs) {
    timestamps.shift();
  }
}

function pruneOldHistory(history, cutoffMs) {
  while (history.length > 0 && history[0].timestampMs < cutoffMs) {
    history.shift();
  }
}

function ensureSpamState(trackerKey) {
  let state = spamStateByUser.get(trackerKey);

  if (state) {
    return state;
  }

  state = {
    timestamps: [],
    history: [],
    mutedUntilMs: 0,
    strikes: 0,
    lastAutoMuteStrike: 0,
    lastStrikeAtMs: 0,
    lastDeleteWarnAtMs: 0,
    lastWarnAtMs: 0,
    lastCountedAtMs: 0
  };

  spamStateByUser.set(trackerKey, state);
  return state;
}

function resetStrikesIfExpired(state, nowMs, settings) {
  if (!state?.strikes || !state?.lastStrikeAtMs) {
    return;
  }

  if (nowMs - state.lastStrikeAtMs > settings.spamStrikeResetMs) {
    state.strikes = 0;
    state.lastAutoMuteStrike = 0;
    state.lastStrikeAtMs = 0;
  }
}

function computeEscalatedCooldownMs(strikes, settings) {
  const safeStrikes = Math.max(1, toClampedInteger(strikes, 1, 1, 30));
  const rawCooldownMs = settings.spamCooldownBaseMs * (2 ** (safeStrikes - 1));

  return Math.min(
    settings.spamCooldownMaxMs,
    Math.max(settings.spamCooldownBaseMs, Math.floor(rawCooldownMs))
  );
}

function applySpamStrike(state, timestampMs, reason, settings, metadata = {}) {
  state.strikes += 1;
  state.lastStrikeAtMs = timestampMs;

  const cooldownMs = computeEscalatedCooldownMs(state.strikes, settings);
  state.mutedUntilMs = Math.max(state.mutedUntilMs, timestampMs + cooldownMs);

  return {
    isSpam: true,
    reason,
    state,
    cooldownRemainingMs: state.mutedUntilMs - timestampMs,
    ...metadata
  };
}

function sweepSpamTracker(nowMs, settings) {
  if (nowMs - lastTrackerSweepAtMs < trackerSweepIntervalMs(settings)) {
    return;
  }

  const cutoffMs = nowMs - settings.spamWindowMs;
  const historyCutoffMs = nowMs - spamHistoryRetentionMs(settings);

  for (const [trackerKey, state] of spamStateByUser.entries()) {
    pruneOldTimestamps(state.timestamps, cutoffMs);
    pruneOldHistory(state.history, historyCutoffMs);
    resetStrikesIfExpired(state, nowMs, settings);

    const isCoolingDown = state.mutedUntilMs > nowMs;
    const shouldDropState =
      !isCoolingDown
      && state.timestamps.length === 0
      && state.history.length === 0
      && state.strikes === 0
      && nowMs - state.lastCountedAtMs > trackerStateTtlMs(settings)
      && nowMs - state.lastWarnAtMs > trackerStateTtlMs(settings);

    if (shouldDropState) {
      spamStateByUser.delete(trackerKey);
    }
  }

  lastTrackerSweepAtMs = nowMs;
}

function evaluateSpamWindow(userId, guildId, timestampMs, message, settings) {
  sweepSpamTracker(timestampMs, settings);

  const trackerKey = `${guildId}:${userId}`;
  const state = ensureSpamState(trackerKey);
  const cutoffMs = timestampMs - settings.spamWindowMs;
  const historyCutoffMs = timestampMs - spamHistoryRetentionMs(settings);
  pruneOldTimestamps(state.timestamps, cutoffMs);
  pruneOldHistory(state.history, historyCutoffMs);
  resetStrikesIfExpired(state, timestampMs, settings);

  if (state.mutedUntilMs > timestampMs) {
    return {
      isSpam: true,
      reason: "cooldown",
      recentCount: state.timestamps.length,
      state,
      cooldownRemainingMs: state.mutedUntilMs - timestampMs
    };
  }

  state.timestamps.push(timestampMs);

  state.history.push({
    timestampMs,
    channelId: String(message?.channelId || ""),
    messageId: String(message?.id || "")
  });

  if (state.timestamps.length >= settings.spamMessageLimit) {
    return applySpamStrike(state, timestampMs, "burst", settings, {
      recentCount: state.timestamps.length
    });
  }

  state.lastCountedAtMs = timestampMs;

  return {
    isSpam: false,
    reason: "ok",
    recentCount: state.timestamps.length,
    state
  };
}

function shouldLogSpamWarning(state, nowMs, settings) {
  if (!state) {
    return true;
  }

  if (settings.spamWarnCooldownMs <= 0) {
    state.lastWarnAtMs = nowMs;
    return true;
  }

  if (nowMs - state.lastWarnAtMs < settings.spamWarnCooldownMs) {
    return false;
  }

  state.lastWarnAtMs = nowMs;
  return true;
}

function formatSpamWarningDetails(spamState, settings) {
  if (!spamState || spamState.reason === "ok") {
    return "bloqueado";
  }

  if (spamState.reason === "burst") {
    const cooldownSeconds = Math.ceil((spamState.cooldownRemainingMs || 0) / 1000);
    const strikes = toClampedInteger(spamState?.state?.strikes, 1, 1, 999);
    return `${spamState.recentCount} em ${settings.spamWindowMs}ms | cooldown ${cooldownSeconds}s | strikes ${strikes}`;
  }

  if (spamState.reason === "cooldown") {
    const cooldownSeconds = Math.ceil((spamState.cooldownRemainingMs || 0) / 1000);
    return `cooldown ativo (${cooldownSeconds}s restantes)`;
  }

  return `motivo ${spamState.reason}`;
}

function formatDurationMs(durationMs) {
  const totalSeconds = Math.max(1, Math.ceil((Number(durationMs) || 0) / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${hours}h`;
}

async function resolveMemberForSpamAction(message) {
  if (message?.member) {
    return message.member;
  }

  if (!message?.guild || !message?.author?.id) {
    return null;
  }

  return message.guild.members.fetch(message.author.id).catch(() => null);
}

async function sendAutoMuteDm(user, payload) {
  if (!user || typeof user.send !== "function") {
    return;
  }

  const text =
    [
      "Seu chat foi temporariamente restringido por spam detectado no sistema de economia.",
      "",
      `Tempo de mute: ${payload.muteDurationText}.`,
      `Cooldown de spam detectado: ${payload.cooldownText}.`,
      "",
      "Quando o mute acabar, envie mensagens em ritmo normal para voltar a ganhar pontos."
    ].join("\n");

  await user.send(text);
}

async function applyAutoMuteForSpam(message, spamState, timestampMs, settings) {
  if (!spamState?.state) {
    return;
  }

  if (settings.autoMuteCooldownThresholdMs <= 0) {
    return;
  }

  if (
    spamState.reason === "cooldown"
    || spamState.reason === "ok"
  ) {
    return;
  }

  if ((spamState.cooldownRemainingMs || 0) < settings.autoMuteCooldownThresholdMs) {
    return;
  }

  const state = spamState.state;

  if (state.lastAutoMuteStrike >= state.strikes) {
    return;
  }

  const member = await resolveMemberForSpamAction(message);

  if (!member) {
    return;
  }

  if (member.id === message.guild?.ownerId) {
    state.lastAutoMuteStrike = state.strikes;
    return;
  }

  if (!member.moderatable) {
    logger.warn(
      `Economia: nao consegui aplicar mute automatico em ${message.author.tag} (sem permissao/hierarquia).`
    );
    return;
  }

  if (
    Number.isFinite(member.communicationDisabledUntilTimestamp)
    && member.communicationDisabledUntilTimestamp > timestampMs + 2000
  ) {
    state.lastAutoMuteStrike = state.strikes;
    return;
  }

  const cooldownText = formatDurationMs(spamState.cooldownRemainingMs || 0);
  const muteDurationText = formatDurationMs(settings.autoMuteDurationMs);
  const reason = `Auto-mute por spam (economia) | cooldown detectado: ${cooldownText}`;

  try {
    await member.timeout(settings.autoMuteDurationMs, reason);
    state.lastAutoMuteStrike = state.strikes;

    logger.warn(
      `Economia: ${message.author.tag} recebeu mute automatico por spam (${muteDurationText}, cooldown ${cooldownText}).`
    );

    await sendAutoMuteDm(member.user, {
      muteDurationText,
      cooldownText
    }).catch((error) => {
      if (Number.parseInt(error?.code, 10) === 50007) {
        return;
      }

      logger.warn(
        `Economia: falha ao enviar DM de mute para ${message.author.tag}: ${
          error?.code || error?.message || "erro"
        }`
      );
    });
  } catch (error) {
    logger.warn(
      `Economia: falha ao aplicar mute automatico em ${message.author.tag}: ${
        error?.code || error?.message || "erro"
      }`
    );
  }
}

function shouldSkipDeleteError(error) {
  const code = Number.parseInt(error?.code, 10);
  return code === 10008 || code === 50001 || code === 50013;
}

function collectBacklogMessageIdsForDeletion(state, channelId, nowMs, settings) {
  if (!state?.history?.length || settings.backlogDeleteLimit <= 0) {
    return [];
  }

  const normalizedChannelId = String(channelId || "");
  const cutoffMs = nowMs - spamHistoryRetentionMs(settings);
  const messageIds = [];

  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    if (messageIds.length >= settings.backlogDeleteLimit) {
      break;
    }

    const entry = state.history[index];

    if (!entry || entry.timestampMs < cutoffMs) {
      break;
    }

    if (entry.channelId !== normalizedChannelId) {
      continue;
    }

    if (!entry.messageId) {
      continue;
    }

    messageIds.push(entry.messageId);
  }

  return [...new Set(messageIds)];
}

function shouldLogDeleteWarning(state, nowMs, settings) {
  if (!state) {
    return true;
  }

  if (settings.spamWarnCooldownMs <= 0) {
    state.lastDeleteWarnAtMs = nowMs;
    return true;
  }

  if (nowMs - state.lastDeleteWarnAtMs < settings.spamWarnCooldownMs) {
    return false;
  }

  state.lastDeleteWarnAtMs = nowMs;
  return true;
}

async function deleteSpamMessages(message, spamState, timestampMs, settings) {
  if (!message?.channel || typeof message.channel.messages?.delete !== "function") {
    return;
  }

  const messageIdsToDelete = new Set([String(message.id || "")]);

  if (spamState?.reason === "burst") {
    const backlogIds = collectBacklogMessageIdsForDeletion(
      spamState?.state,
      message.channelId,
      timestampMs,
      settings
    );

    for (const backlogMessageId of backlogIds) {
      if (backlogMessageId) {
        messageIdsToDelete.add(backlogMessageId);
      }
    }
  }

  for (const messageId of messageIdsToDelete) {
    if (!messageId) {
      continue;
    }

    await message.channel.messages.delete(messageId).catch((error) => {
      if (shouldSkipDeleteError(error)) {
        return;
      }

      if (!shouldLogDeleteWarning(spamState?.state, timestampMs, settings)) {
        return;
      }

      logger.warn(
        `Economia: falha ao apagar mensagem de spam (${messageId}) de ${message.author?.tag || "usuario"}: ${
          error?.code || error?.message || "erro"
        }`
      );
    });
  }
}

function scheduleMessageDeletion(sentMessage, deleteAfterMs) {
  if (!sentMessage || deleteAfterMs <= 0) {
    return;
  }

  const timer = setTimeout(() => {
    sentMessage.delete().catch((error) => {
      if (shouldSkipDeleteError(error)) {
        return;
      }

      logger.warn(
        `Nao consegui apagar aviso ${sentMessage.id || "desconhecido"}: ${
          error?.code || error?.message || "erro"
        }`
      );
    });
  }, deleteAfterMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }
}

function buildMissionRewardText(userId, missionUpdate) {
  if (!missionUpdate?.awardedPoints || missionUpdate.awardedPoints <= 0) {
    return "";
  }

  const completedLabels = (missionUpdate.completedRewards || [])
    .map((entry) => entry.label)
    .filter(Boolean);

  const completedText = completedLabels.length > 0
    ? `Concluidas: ${completedLabels.join(" | ")}.`
    : "Missao concluida.";

  const bonusText = missionUpdate.bonusGranted
    ? ` Bonus diario de +${missionUpdate.bonusRewardPoints} aplicado.`
    : "";

  return `[Missoes] <@${userId}> recebeu +${missionUpdate.awardedPoints} pontos. ${completedText}${bonusText}`;
}

module.exports = {
  name: "messageCreate",
  async execute(message) {
    if (!message?.guildId) {
      return;
    }

    if (!message.author || message.author.bot || message.webhookId) {
      return;
    }

    const chatSettings = resolveRuntimeChatSettings();
    const messageTimestampMs = getMessageTimestampMs(message);
    const spamState = evaluateSpamWindow(
      message.author.id,
      message.guildId,
      messageTimestampMs,
      message,
      chatSettings
    );

    if (spamState.isSpam) {
      if (shouldLogSpamWarning(spamState.state, messageTimestampMs, chatSettings)) {
        logger.warn(
          `Economia: mensagens de ${message.author.tag} ignoradas por spam (${formatSpamWarningDetails(spamState, chatSettings)}).`
        );
      }

      await deleteSpamMessages(message, spamState, messageTimestampMs, chatSettings);
      await applyAutoMuteForSpam(message, spamState, messageTimestampMs, chatSettings);

      return;
    }

    const result = registerChatMessage(message.author.id, message.guildId, {
      isServerBooster: isServerBooster(message.member)
    });

    const missionUpdate = trackDailyMissionProgress(
      message.author.id,
      message.guildId,
      "chat_message",
      1
    );

    if (result.awardedPoints > 0) {
      const boosterText =
        result.boosterAwardedPoints > 0 ? ` | booster +${result.boosterAwardedPoints}` : "";
      const serverBoosterText =
        result.serverBoosterAwardedPoints > 0
          ? ` | boost-servidor +${result.serverBoosterAwardedPoints}`
          : "";
      const publicServerBoosterText =
        result.serverBoosterMultiplier > 1
          ? ` | booster do servidor ${result.serverBoosterMultiplier}x ativo (+${result.serverBoosterAwardedPoints})`
          : "";
      const inflationSignal = result.inflationAwardedPoints >= 0 ? "+" : "";
      const inflationText =
        result.inflationAwardedPoints !== 0
          ? ` | inflacao ${inflationSignal}${result.inflationAwardedPoints}`
          : "";

      logger.info(
        `Economia: ${message.author.tag} ganhou +${result.awardedPoints} pontos (${result.messagesPerReward} mensagens${boosterText}${serverBoosterText}${inflationText}). Saldo atual: ${result.points}.`
      );

      const rewardNotice = await message.channel
        .send(
          `[Economia] @${message.author.username} recebeu +${result.awardedPoints} pontos por completar ${result.messagesPerReward} mensagens (ganho por ciclo ${result.pointsPerReward}${publicServerBoosterText} | inflacao do dia ${result.inflationDailyPercent.toFixed(2)}%). Saldo atual: ${result.points} pontos.`
        )
        .catch((error) => {
          logger.warn(
            `Nao consegui enviar aviso de premio no canal ${message.channel?.id || "desconhecido"}: ${
              error?.code || error?.message || "erro"
            }`
          );
        });

      scheduleMessageDeletion(rewardNotice, chatSettings.rewardNoticeDeleteAfterMs);
    }

    if (missionUpdate?.ok && missionUpdate.awardedPoints > 0) {
      const missionText = buildMissionRewardText(message.author.id, missionUpdate);

      if (missionText) {
        const missionNotice = await message.channel.send(missionText).catch((error) => {
          logger.warn(
            `Nao consegui enviar aviso de missao no canal ${message.channel?.id || "desconhecido"}: ${
              error?.code || error?.message || "erro"
            }`
          );
        });

        scheduleMessageDeletion(missionNotice, chatSettings.rewardNoticeDeleteAfterMs);
      }
    }
  }
};
