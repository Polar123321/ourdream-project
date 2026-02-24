const { ComponentType, SlashCommandBuilder } = require("discord.js");

const logger = require("./logger");
const { ACTION_PRESETS } = require("../data/action-presets");
const { createCv2Reply } = require("./cv2-components");
const { assertAllowedUrl, fetchJson, HttpClientError } = require("./http-client");
const { sanitizeInlineText } = require("./sanitize");

const BEIJO_RETRIBUIR_PREFIX = "beijo_retribuir";
const BEIJO_RETRIBUIR_USAGE_TTL_MS = 6 * 60 * 60 * 1000;
const BEIJO_RETRIBUIR_USAGE_LIMIT = 2000;
const beijoRetribuirUsageByMessage = new Map();

function randomItem(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return null;
  }

  const index = Math.floor(Math.random() * list.length);
  return list[index];
}

function replaceMentionsByIds(template, authorId, targetId) {
  return String(template || "")
    .replaceAll("{author}", `<@${authorId}>`)
    .replaceAll("{target}", `<@${targetId}>`);
}

function replaceMentions(template, interaction, targetUser) {
  return replaceMentionsByIds(template, interaction.user.id, targetUser.id);
}

function extractMediaUrl(data, parser) {
  if (parser === "waifuPics") {
    return typeof data?.url === "string" ? data.url : null;
  }

  if (parser === "nekosBest") {
    return typeof data?.results?.[0]?.url === "string"
      ? data.results[0].url
      : null;
  }

  return null;
}

async function fetchActionMedia(preset, actionName) {
  const sources = Array.isArray(preset.apiSources) ? preset.apiSources : [];

  if (sources.length === 0) {
    throw new HttpClientError("Nenhuma fonte de midia configurada.", {
      code: "NO_MEDIA_SOURCE",
      retriable: false
    });
  }

  const errors = [];

  for (const source of sources) {
    try {
      const { data } = await fetchJson(source.url, {
        operation: `action:${actionName}:${source.name || "source"}`
      });
      const rawUrl = extractMediaUrl(data, source.parser);

      if (!rawUrl) {
        throw new HttpClientError("Fonte retornou resposta sem URL.", {
          code: "MEDIA_MISSING_URL",
          retriable: true
        });
      }

      return assertAllowedUrl(rawUrl, "media");
    } catch (error) {
      errors.push(
        sanitizeInlineText(
          `${source.name || "fonte"}: ${error?.code || "erro"}`,
          { maxLength: 120 }
        )
      );
    }
  }

  throw new HttpClientError(`Falha nas fontes de midia (${errors.join(", ")}).`, {
    code: "MEDIA_FETCH_FAILED",
    retriable: true
  });
}

function buildActionDescription(preset, interaction, targetUser) {
  const fallbackTemplate = "{author} fez uma acao em {target}.";
  const template = randomItem(preset.templates) || fallbackTemplate;
  return replaceMentions(template, interaction, targetUser);
}

function buildActionDescriptionByIds(preset, authorId, targetId) {
  const fallbackTemplate = "{author} fez uma acao em {target}.";
  const template = randomItem(preset.templates) || fallbackTemplate;
  return replaceMentionsByIds(template, authorId, targetId);
}

function createBeijoRetribuirCustomId(authorId, targetId) {
  return `${BEIJO_RETRIBUIR_PREFIX}:${authorId}:${targetId}`;
}

function parseBeijoRetribuirCustomId(customId) {
  if (typeof customId !== "string" || !customId.startsWith(`${BEIJO_RETRIBUIR_PREFIX}:`)) {
    return null;
  }

  const parts = customId.split(":");

  if (parts.length !== 3) {
    return null;
  }

  const authorId = parts[1];
  const targetId = parts[2];

  if (!/^\d{16,20}$/.test(authorId) || !/^\d{16,20}$/.test(targetId)) {
    return null;
  }

  return { authorId, targetId };
}

function pruneBeijoRetribuirUsage() {
  const now = Date.now();

  for (const [messageId, usedAt] of beijoRetribuirUsageByMessage.entries()) {
    if (now - usedAt > BEIJO_RETRIBUIR_USAGE_TTL_MS) {
      beijoRetribuirUsageByMessage.delete(messageId);
    }
  }

  if (beijoRetribuirUsageByMessage.size <= BEIJO_RETRIBUIR_USAGE_LIMIT) {
    return;
  }

  const overflow = beijoRetribuirUsageByMessage.size - BEIJO_RETRIBUIR_USAGE_LIMIT;
  let removed = 0;

  for (const messageId of beijoRetribuirUsageByMessage.keys()) {
    beijoRetribuirUsageByMessage.delete(messageId);
    removed += 1;

    if (removed >= overflow) {
      break;
    }
  }
}

function claimBeijoRetribuirUsage(messageId) {
  pruneBeijoRetribuirUsage();

  if (beijoRetribuirUsageByMessage.has(messageId)) {
    return false;
  }

  beijoRetribuirUsageByMessage.set(messageId, Date.now());
  return true;
}

function toRawMessageComponents(components = []) {
  return components.map((component) =>
    typeof component?.toJSON === "function" ? component.toJSON() : component
  );
}

function disableButtonInComponents(components = [], customId) {
  let changed = false;

  const walk = (items) =>
    items.map((item) => {
      const next = { ...item };

      if (Array.isArray(item?.components)) {
        next.components = walk(item.components);
      }

      const itemCustomId = next.custom_id || next.customId;

      if (next.type === ComponentType.Button && itemCustomId === customId) {
        next.disabled = true;
        changed = true;
      }

      return next;
    });

  return {
    components: walk(components),
    changed
  };
}

async function handleBeijoRetribuirButton(interaction) {
  const context = parseBeijoRetribuirCustomId(interaction?.customId);

  if (!context) {
    return false;
  }

  if (interaction.user.id !== context.targetId) {
    await interaction
      .reply(
        createCv2Reply(
          interaction,
          {
            tone: "warning",
            eyebrow: "Acoes",
            title: "Retribuir bloqueado",
            description: "Somente quem recebeu o beijo pode usar o botao de retribuir."
          },
          true
        )
      )
      .catch(() => null);
    return true;
  }

  const messageId = interaction.message?.id;

  if (!messageId) {
    await interaction
      .reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Acoes",
            title: "Nao consegui retribuir",
            description: "A mensagem original nao foi encontrada."
          },
          true
        )
      )
      .catch(() => null);
    return true;
  }

  if (!claimBeijoRetribuirUsage(messageId)) {
    await interaction
      .reply(
        createCv2Reply(
          interaction,
          {
            tone: "warning",
            eyebrow: "Acoes",
            title: "Retribuir ja usado",
            description: "Esse beijo ja foi retribuido. O botao so pode ser usado uma vez."
          },
          true
        )
      )
      .catch(() => null);
    return true;
  }

  let acknowledged = false;

  try {
    await interaction.deferUpdate();
    acknowledged = true;
  } catch (error) {
    beijoRetribuirUsageByMessage.delete(messageId);
    logger.warn(
      `Falha ao confirmar clique do botao de retribuir: ${
        error?.code || sanitizeInlineText(error?.message || "erro", { maxLength: 100 })
      }`
    );
  }

  if (!acknowledged) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction
        .reply(
          createCv2Reply(
            interaction,
            {
              tone: "error",
              eyebrow: "Acoes",
              title: "Nao consegui retribuir",
              description: "Nao consegui confirmar o clique agora. Tente novamente em alguns segundos."
            },
            true
          )
        )
        .catch(() => null);
    }

    return true;
  }

  try {
    const rawComponents = toRawMessageComponents(interaction.message?.components || []);
    const { components, changed } = disableButtonInComponents(rawComponents, interaction.customId);

    if (changed) {
      await interaction.message.edit({ components }).catch((error) => {
        logger.warn(
          `Nao consegui desabilitar o botao de retribuir: ${
            error?.code || sanitizeInlineText(error?.message || "erro", { maxLength: 100 })
          }`
        );
      });
    }

    const preset = ACTION_PRESETS.beijo;

    if (!preset) {
      throw new Error("Preset /beijo nao configurado.");
    }

    const description = buildActionDescriptionByIds(
      preset,
      interaction.user.id,
      context.authorId
    );
    let mediaUrl = null;
    let mediaUnavailable = false;

    try {
      mediaUrl = await fetchActionMedia(preset, "beijo");
    } catch (error) {
      mediaUnavailable = true;
      logger.warn(
        `Midia indisponivel para retribuicao /beijo: ${
          error?.code || sanitizeInlineText(error?.message || "erro", { maxLength: 100 })
        }`
      );
    }

    const fields = [
      { name: "Quem retribuiu", value: `<@${interaction.user.id}>` },
      { name: "Quem recebeu", value: `<@${context.authorId}>` }
    ];

    if (mediaUnavailable) {
      fields.push({
        name: "Status da midia",
        value: "Nao consegui carregar um GIF agora, mas a retribuicao foi enviada."
      });
    }

    const payload = {
      tone: mediaUnavailable ? "warning" : "success",
      eyebrow: "Acoes",
      title: "Beijo Retribuido",
      description,
      fields,
      mediaFallbackText: preset.mediaFallbackText
    };

    if (mediaUrl) {
      payload.image = mediaUrl;
      payload.imageAlt = `beijo-retribuido-${context.authorId}`;
      payload.actions = [{ label: "Abrir GIF", url: mediaUrl }];
    }

    await interaction.followUp(createCv2Reply(interaction, payload)).catch((error) => {
      logger.warn(
        `Nao consegui enviar a mensagem de retribuicao /beijo: ${
          error?.code || sanitizeInlineText(error?.message || "erro", { maxLength: 100 })
        }`
      );
    });
  } catch (error) {
    logger.error("Erro ao processar o botao de retribuir /beijo.", error);
    await interaction
      .followUp(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Acoes",
            title: "Erro ao retribuir",
            description: "Aconteceu um erro ao processar a retribuicao. Tente novamente depois."
          },
          true
        )
      )
      .catch(() => null);
  }

  return true;
}

function createActionCommand(actionName) {
  const preset = ACTION_PRESETS[actionName];

  if (!preset) {
    throw new Error(`Preset de acao nao encontrado: ${actionName}`);
  }

  return {
    category: "actions",
    cooldownMs:
      typeof preset.cooldownMs === "number" ? Math.max(0, preset.cooldownMs) : 4500,
    data: new SlashCommandBuilder()
      .setName(actionName)
      .setDescription(preset.description)
      .addUserOption((option) =>
        option
          .setName("usuario")
          .setDescription("Usuario alvo da acao")
          .setRequired(true)
      ),
    async execute(interaction) {
      const targetUser = interaction.options.getUser("usuario", true);

      if (targetUser.id === interaction.user.id) {
        await interaction.reply(
          createCv2Reply(
            interaction,
            {
              tone: "warning",
              eyebrow: "Acoes",
              title: preset.title,
              description: preset.selfMessage
            },
            true
          )
        );
        return;
      }

      const description = buildActionDescription(preset, interaction, targetUser);
      let mediaUrl = null;
      let mediaUnavailable = false;

      try {
        mediaUrl = await fetchActionMedia(preset, actionName);
      } catch (error) {
        mediaUnavailable = true;
        logger.warn(
          `Midia indisponivel para /${actionName}: ${
            error?.code || sanitizeInlineText(error?.message || "erro", { maxLength: 100 })
          }`
        );
      }

      const fields = [
        { name: "Quem enviou", value: `<@${interaction.user.id}>` },
        { name: "Quem recebeu", value: `<@${targetUser.id}>` }
      ];

      if (mediaUnavailable) {
        fields.push({
          name: "Status da midia",
          value: "Nao consegui carregar um GIF agora, mas a acao foi enviada."
        });
      }

      const payload = {
        tone: mediaUnavailable ? "warning" : "info",
        eyebrow: "Acoes",
        title: preset.title,
        description,
        fields,
        mediaFallbackText: preset.mediaFallbackText
      };

      const actions = [];

      if (mediaUrl) {
        payload.image = mediaUrl;
        payload.imageAlt = `${actionName}-${targetUser.id}`;
        actions.push({ label: "Abrir GIF", url: mediaUrl });
      }

      if (actionName === "beijo") {
        actions.push({
          label: "Retribuir",
          customId: createBeijoRetribuirCustomId(interaction.user.id, targetUser.id),
          style: "primary"
        });
      }

      if (actions.length > 0) {
        payload.actions = actions;
      }

      await interaction.reply(createCv2Reply(interaction, payload));
    }
  };
}

module.exports = {
  createActionCommand,
  handleBeijoRetribuirButton
};
