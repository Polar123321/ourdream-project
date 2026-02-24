const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");
const {
  getEconomySettings,
  updateEconomySettings,
  getEconomyAuditLogs
} = require("../../utils/economy-store");

function toSignedPercent(value) {
  const numeric = Number(value) || 0;
  const signal = numeric >= 0 ? "+" : "";
  return `${signal}${numeric.toFixed(2)}%`;
}

function hasAdminPermission(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function formatAuditLines(logs) {
  if (!Array.isArray(logs) || logs.length === 0) {
    return "Sem registros recentes.";
  }

  return logs
    .map((entry) => {
      const unix = Math.floor(new Date(entry.createdAt).getTime() / 1000);
      const actor = entry.actorTag || entry.actorId || "desconhecido";
      const reason = entry.reason ? ` | motivo: ${entry.reason}` : "";
      return `<t:${Number.isFinite(unix) ? unix : Math.floor(Date.now() / 1000)}:R> | ${entry.action} | ${actor}${reason}`;
    })
    .join("\n");
}

function formatChatRewardSettings(settings) {
  return [
    `Mensagens por ciclo: ${settings.messagesPerReward}`,
    `Pontos por ciclo: ${settings.pointsPerReward}`
  ].join("\n");
}

function formatSpamSettings(settings) {
  return [
    `Janela: ${settings.spamWindowMs}ms`,
    `Limite de mensagens: ${settings.spamMessageLimit}`,
    `Cooldown base/max: ${settings.spamCooldownBaseMs}/${settings.spamCooldownMaxMs}ms`,
    `Reset de strike: ${settings.spamStrikeResetMs}ms`,
    `Auto-mute limiar/duracao: ${settings.autoMuteCooldownThresholdMs}/${settings.autoMuteDurationMs}ms`
  ].join("\n");
}

function formatInflationSettings(settings) {
  return [
    `Faixa diaria: ${toSignedPercent(settings.minDailyPercent)} a ${toSignedPercent(settings.maxDailyPercent)}`,
    `Chance de evento extremo: ${toSignedPercent(settings.extremeEventChancePercent)}`,
    `Swing extremo min/max: ${toSignedPercent(settings.extremeSwingMinPercent)} / ${toSignedPercent(settings.extremeSwingMaxPercent)}`
  ].join("\n");
}

module.exports = {
  category: "economia",
  cooldownMs: 3000,
  data: new SlashCommandBuilder()
    .setName("economia-admin")
    .setDescription("Gerencia configuracoes da economia em runtime.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-base-reward")
        .setDescription("Define quantos pontos cada ciclo de mensagens concede")
        .addIntegerOption((option) =>
          option
            .setName("pontos")
            .setDescription("Pontos por ciclo")
            .setRequired(true)
            .setMinValue(10)
            .setMaxValue(100000)
        )
        .addStringOption((option) =>
          option
            .setName("motivo")
            .setDescription("Motivo da alteracao")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-messages-per-reward")
        .setDescription("Define quantas mensagens sao necessarias por ciclo")
        .addIntegerOption((option) =>
          option
            .setName("mensagens")
            .setDescription("Mensagens por ciclo")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(500)
        )
        .addStringOption((option) =>
          option
            .setName("motivo")
            .setDescription("Motivo da alteracao")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-inflation-range")
        .setDescription("Ajusta os limites da inflacao diaria")
        .addNumberOption((option) =>
          option
            .setName("min_percent")
            .setDescription("Percentual minimo diario")
            .setRequired(true)
            .setMinValue(-40)
            .setMaxValue(40)
        )
        .addNumberOption((option) =>
          option
            .setName("max_percent")
            .setDescription("Percentual maximo diario")
            .setRequired(true)
            .setMinValue(-40)
            .setMaxValue(40)
        )
        .addNumberOption((option) =>
          option
            .setName("chance_extremo")
            .setDescription("Chance de evento extremo (%)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(100)
        )
        .addNumberOption((option) =>
          option
            .setName("swing_min")
            .setDescription("Swing minimo de evento extremo (%)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(60)
        )
        .addNumberOption((option) =>
          option
            .setName("swing_max")
            .setDescription("Swing maximo de evento extremo (%)")
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(80)
        )
        .addStringOption((option) =>
          option
            .setName("motivo")
            .setDescription("Motivo da alteracao")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set-spam-limits")
        .setDescription("Ajusta limites de antispam da economia")
        .addIntegerOption((option) =>
          option
            .setName("janela_ms")
            .setDescription("Janela de analise de spam em ms")
            .setRequired(true)
            .setMinValue(1000)
            .setMaxValue(60000)
        )
        .addIntegerOption((option) =>
          option
            .setName("limite_mensagens")
            .setDescription("Numero de mensagens na janela para detectar spam")
            .setRequired(true)
            .setMinValue(2)
            .setMaxValue(30)
        )
        .addIntegerOption((option) =>
          option
            .setName("cooldown_base_ms")
            .setDescription("Cooldown base apos strike")
            .setRequired(true)
            .setMinValue(1000)
            .setMaxValue(300000)
        )
        .addIntegerOption((option) =>
          option
            .setName("cooldown_max_ms")
            .setDescription("Cooldown maximo apos strikes")
            .setRequired(true)
            .setMinValue(1000)
            .setMaxValue(600000)
        )
        .addStringOption((option) =>
          option
            .setName("motivo")
            .setDescription("Motivo da alteracao")
            .setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Mostra o status atual da configuracao da economia")
    ),
  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Economia Admin",
            title: "Comando restrito a servidor",
            description: "Use este comando em um servidor."
          },
          true
        )
      );
      return;
    }

    if (!hasAdminPermission(interaction)) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Economia Admin",
            title: "Permissao insuficiente",
            description: "Apenas administradores podem alterar essas configuracoes."
          },
          true
        )
      );
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "status") {
      const settings = getEconomySettings();
      const logs = getEconomyAuditLogs(5);

      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "info",
            eyebrow: "Economia Admin",
            title: "Status da economia",
            fields: [
              {
                name: "Chat rewards",
                value: formatChatRewardSettings(settings.chatRewards)
              },
              {
                name: "Spam",
                value: formatSpamSettings(settings.chatRewards)
              },
              {
                name: "Inflacao",
                value: formatInflationSettings(settings.inflation)
              },
              {
                name: "Auditoria recente",
                value: formatAuditLines(logs)
              }
            ]
          },
          true
        )
      );
      return;
    }

    let patch = {};
    let reason = "";

    if (subcommand === "set-base-reward") {
      patch = {
        chatRewards: {
          pointsPerReward: interaction.options.getInteger("pontos", true)
        }
      };
      reason = interaction.options.getString("motivo") || "Atualizacao de pontos por ciclo";
    }

    if (subcommand === "set-messages-per-reward") {
      patch = {
        chatRewards: {
          messagesPerReward: interaction.options.getInteger("mensagens", true)
        }
      };
      reason = interaction.options.getString("motivo") || "Atualizacao de mensagens por ciclo";
    }

    if (subcommand === "set-inflation-range") {
      patch = {
        inflation: {
          minDailyPercent: interaction.options.getNumber("min_percent", true),
          maxDailyPercent: interaction.options.getNumber("max_percent", true)
        }
      };

      const chanceExtremo = interaction.options.getNumber("chance_extremo");
      const swingMin = interaction.options.getNumber("swing_min");
      const swingMax = interaction.options.getNumber("swing_max");

      if (chanceExtremo != null) {
        patch.inflation.extremeEventChancePercent = chanceExtremo;
      }

      if (swingMin != null) {
        patch.inflation.extremeSwingMinPercent = swingMin;
      }

      if (swingMax != null) {
        patch.inflation.extremeSwingMaxPercent = swingMax;
      }

      reason = interaction.options.getString("motivo") || "Atualizacao da faixa de inflacao";
    }

    if (subcommand === "set-spam-limits") {
      patch = {
        chatRewards: {
          spamWindowMs: interaction.options.getInteger("janela_ms", true),
          spamMessageLimit: interaction.options.getInteger("limite_mensagens", true),
          spamCooldownBaseMs: interaction.options.getInteger("cooldown_base_ms", true),
          spamCooldownMaxMs: interaction.options.getInteger("cooldown_max_ms", true)
        }
      };
      reason = interaction.options.getString("motivo") || "Atualizacao de antispam";
    }

    const updateResult = updateEconomySettings(patch, {
      actorId: interaction.user.id,
      actorTag: interaction.user.tag,
      guildId: interaction.guildId,
      action: subcommand,
      reason
    });

    if (!updateResult.changed) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "warning",
            eyebrow: "Economia Admin",
            title: "Nada foi alterado",
            description: "Os valores enviados ja estavam ativos."
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
          eyebrow: "Economia Admin",
          title: "Configuracao atualizada",
          description: `Acao: ${subcommand}`,
          fields: [
            {
              name: "Antes",
              value: [
                formatChatRewardSettings(updateResult.before.chatRewards),
                formatInflationSettings(updateResult.before.inflation)
              ].join("\n\n")
            },
            {
              name: "Depois",
              value: [
                formatChatRewardSettings(updateResult.after.chatRewards),
                formatInflationSettings(updateResult.after.inflation)
              ].join("\n\n")
            },
            {
              name: "Auditoria",
              value: updateResult.audit?.id
                ? `${updateResult.audit.id} | ${reason}`
                : reason
            }
          ]
        },
        true
      )
    );
  }
};
