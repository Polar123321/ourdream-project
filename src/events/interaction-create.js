const config = require("../config");
const logger = require("../utils/logger");
const cooldownManager = require("../utils/cooldown-manager");
const { handleBeijoRetribuirButton } = require("../utils/create-action-command");
const { trackDailyMissionProgress } = require("../utils/economy-store");
const {
  buildCommandErrorOptions,
  formatCooldown,
  sendCv2
} = require("../utils/interaction-response");

function resolveCooldownMs(command) {
  if (typeof command?.cooldownMs === "number") {
    return Math.max(0, command.cooldownMs);
  }

  return config.cooldown.defaultMs;
}

function formatMissionFollowupDescription(missionUpdate) {
  if (!missionUpdate?.awardedPoints || missionUpdate.awardedPoints <= 0) {
    return "";
  }

  const completed = (missionUpdate.completedRewards || [])
    .map((entry) => entry.label)
    .filter(Boolean);
  const completedText =
    completed.length > 0 ? `Concluidas: ${completed.join(" | ")}.` : "Missao concluida.";
  const bonusText = missionUpdate.bonusGranted
    ? ` Bonus diario +${missionUpdate.bonusRewardPoints}.`
    : "";

  return `Voce recebeu +${missionUpdate.awardedPoints} pontos. ${completedText}${bonusText}`;
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction, client) {
    if (interaction.isButton()) {
      try {
        await handleBeijoRetribuirButton(interaction);
      } catch (error) {
        logger.error("Erro ao processar botao de interacao.", error);
      }
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);

      if (!command || typeof command.autocomplete !== "function") {
        return;
      }

      try {
        await command.autocomplete(interaction, client);
      } catch (error) {
        logger.error(`Erro ao processar autocomplete de /${interaction.commandName}`, error);
      }

      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      await sendCv2(
        interaction,
        {
          tone: "error",
          title: "Comando nao encontrado",
          description: "Esse comando nao esta registrado neste bot."
        },
        true
      );
      return;
    }

    const cooldownMs = resolveCooldownMs(command);

    if (cooldownMs > 0) {
      const remainingMs = cooldownManager.hit(
        interaction.commandName,
        interaction.user.id,
        cooldownMs
      );

      if (remainingMs > 0) {
        await sendCv2(
          interaction,
          {
            tone: "warning",
            eyebrow: "Controle de uso",
            title: "Aguarde um instante",
            description: `Use /${interaction.commandName} novamente em ${formatCooldown(
              remainingMs
            )}.`
          },
          true
        );
        return;
      }
    }

    try {
      await command.execute(interaction, client);

      if (interaction.inGuild() && command.category === "actions") {
        const missionUpdate = trackDailyMissionProgress(
          interaction.user.id,
          interaction.guildId,
          "action_command",
          1
        );

        if (missionUpdate?.ok && missionUpdate.awardedPoints > 0) {
          await sendCv2(
            interaction,
            {
              tone: "success",
              eyebrow: "Missoes diarias",
              title: "Progresso atualizado",
              description: formatMissionFollowupDescription(missionUpdate)
            },
            true
          );
        }
      }
    } catch (error) {
      logger.error(`Erro ao executar /${interaction.commandName}`, error);
      await sendCv2(
        interaction,
        buildCommandErrorOptions(interaction.commandName, error),
        true
      );
    }
  }
};
