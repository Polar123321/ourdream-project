const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder
} = require("discord.js");

const config = require("../config");
const { sanitizeInlineText, sanitizeText, sanitizeUrl } = require("./sanitize");

const CV2_COLOR = 0x2f6fff;
const CV2_SUCCESS_COLOR = 0x2fbf71;
const CV2_ERROR_COLOR = 0xd94848;
const CV2_WARNING_COLOR = 0xe09b2d;

const THEME_BY_TONE = {
  info: {
    accent: CV2_COLOR,
    eyebrow: "INFORMACAO"
  },
  success: {
    accent: CV2_SUCCESS_COLOR,
    eyebrow: "CONFIRMACAO"
  },
  error: {
    accent: CV2_ERROR_COLOR,
    eyebrow: "ATENCAO"
  },
  alert: {
    accent: CV2_WARNING_COLOR,
    eyebrow: "AVISO"
  }
};

function toTextDisplay(content) {
  return new TextDisplayBuilder().setContent(content);
}

function normalizeTone(rawTone) {
  if (rawTone === "warning") {
    return "alert";
  }

  if (THEME_BY_TONE[rawTone]) {
    return rawTone;
  }

  return "info";
}

function resolveTheme(options = {}) {
  const tone = normalizeTone(options.tone);
  const base = THEME_BY_TONE[tone];

  if (typeof options.color === "number") {
    return {
      ...base,
      accent: options.color
    };
  }

  return base;
}

function safeMediaUrl(input) {
  return sanitizeUrl(input, {
    allowedDomains: config.security.allowedMediaDomains
  });
}

function safeCustomId(input) {
  const customId = sanitizeInlineText(input, {
    maxLength: 100,
    fallback: ""
  });

  return customId || null;
}

function resolveActionButtonStyle(rawStyle) {
  if (typeof rawStyle === "number") {
    return rawStyle;
  }

  const normalized = String(rawStyle || "")
    .trim()
    .toLowerCase();

  if (normalized === "primary") {
    return ButtonStyle.Primary;
  }

  if (normalized === "success") {
    return ButtonStyle.Success;
  }

  if (normalized === "danger") {
    return ButtonStyle.Danger;
  }

  return ButtonStyle.Secondary;
}

function buildHeaderLines(options, theme) {
  const lines = [];
  const eyebrow = sanitizeInlineText(options.eyebrow || theme.eyebrow, {
    maxLength: 64,
    fallback: theme.eyebrow
  });

  lines.push(`-# ${eyebrow}`);

  if (options.title) {
    lines.push(
      `## ${sanitizeInlineText(options.title, {
        maxLength: 120,
        fallback: "Mensagem"
      })}`
    );
  }

  if (options.description) {
    lines.push(
      sanitizeText(options.description, {
        maxLength: 1400
      })
    );
  }

  return lines;
}

function addHeader(container, options, theme) {
  const lines = buildHeaderLines(options, theme);
  const thumbnail = safeMediaUrl(options.thumbnail);

  if (lines.length === 0) {
    return false;
  }

  if (thumbnail) {
    const section = new SectionBuilder();
    const sectionLines = lines.slice(0, 3);

    for (const line of sectionLines) {
      section.addTextDisplayComponents(toTextDisplay(line));
    }

    section.setThumbnailAccessory(
      new ThumbnailBuilder().setURL(thumbnail).setDescription("preview")
    );
    container.addSectionComponents(section);

    for (const line of lines.slice(3)) {
      container.addTextDisplayComponents(toTextDisplay(line));
    }

    return true;
  }

  for (const line of lines) {
    container.addTextDisplayComponents(toTextDisplay(line));
  }

  return true;
}

function addFields(container, options = {}) {
  if (!Array.isArray(options.fields) || options.fields.length === 0) {
    return false;
  }

  const blocks = options.fields
    .map((field) => {
      const name = sanitizeInlineText(field?.name, {
        maxLength: 70,
        fallback: "Info"
      });
      const value = sanitizeText(field?.value, {
        maxLength: 600,
        fallback: "-"
      });

      return `**${name}**\n${value}`;
    })
    .join("\n\n");

  container.addTextDisplayComponents(toTextDisplay(`### Detalhes\n${blocks}`));
  return true;
}

function addMedia(container, options = {}) {
  const galleryItems = [];
  const image = safeMediaUrl(options.image);

  if (image) {
    galleryItems.push(
      new MediaGalleryItemBuilder()
        .setURL(image)
        .setDescription(
          sanitizeInlineText(options.imageAlt || "imagem", {
            maxLength: 120,
            fallback: "imagem"
          })
        )
    );
  }

  if (Array.isArray(options.images)) {
    for (const imageOption of options.images) {
      const url = safeMediaUrl(imageOption?.url);

      if (!url) {
        continue;
      }

      galleryItems.push(
        new MediaGalleryItemBuilder()
          .setURL(url)
          .setDescription(
            sanitizeInlineText(imageOption?.alt || "imagem", {
              maxLength: 120,
              fallback: "imagem"
            })
          )
      );
    }
  }

  if (galleryItems.length > 0) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(...galleryItems.slice(0, 10))
    );
    return true;
  }

  const expectsMedia =
    Boolean(options.image) ||
    (Array.isArray(options.images) && options.images.length > 0) ||
    Boolean(options.mediaFallbackText);

  if (!expectsMedia) {
    return false;
  }

  container.addTextDisplayComponents(
    toTextDisplay(
      `> ${sanitizeText(options.mediaFallbackText || "Midia indisponivel no momento.", {
        maxLength: 220
      })}`
    )
  );

  return true;
}

function addActions(container, options = {}) {
  if (!Array.isArray(options.actions) || options.actions.length === 0) {
    return false;
  }

  const row = new ActionRowBuilder();
  const seenActions = new Set();

  for (const action of options.actions) {
    const label = sanitizeInlineText(action?.label, {
      maxLength: 22,
      fallback: ""
    });
    const url = safeMediaUrl(action?.url);
    const customId = safeCustomId(action?.customId);
    let key = null;
    let button = null;

    if (!label) {
      continue;
    }

    if (url) {
      key = `url:${url}`;
      button = new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(label)
        .setURL(url);
    } else if (customId) {
      key = `custom:${customId}`;
      button = new ButtonBuilder()
        .setStyle(resolveActionButtonStyle(action?.style))
        .setLabel(label)
        .setCustomId(customId);

      if (action?.disabled === true) {
        button.setDisabled(true);
      }
    } else {
      continue;
    }

    if (seenActions.has(key)) {
      continue;
    }

    seenActions.add(key);

    if (action?.emoji) {
      button.setEmoji(action.emoji);
    }

    row.addComponents(button);

    if (row.components.length >= 5) {
      break;
    }
  }

  if (row.components.length === 0) {
    return false;
  }

  container.addActionRowComponents(row);
  return true;
}

function addFooter(container, interaction, options, hasAnySection) {
  if (!hasAnySection) {
    return false;
  }

  const footerParts = [];

  if (options.footer) {
    footerParts.push(
      sanitizeInlineText(options.footer, {
        maxLength: 110
      })
    );
  } else if (interaction?.user?.tag) {
    footerParts.push(
      sanitizeInlineText(`Solicitado por ${interaction.user.tag}`, {
        maxLength: 110
      })
    );
  }

  if (options.timestamp !== false) {
    footerParts.push(`<t:${Math.floor(Date.now() / 1000)}:R>`);
  }

  if (footerParts.length === 0) {
    return false;
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(toTextDisplay(`-# ${footerParts.join(" | ")}`));
  return true;
}

function createCv2Container(interaction, options = {}) {
  const theme = resolveTheme(options);
  const container = new ContainerBuilder().setAccentColor(theme.accent);

  const hasHeader = addHeader(container, options, theme);

  if (hasHeader) {
    container.addSeparatorComponents(new SeparatorBuilder());
  }

  const hasFields = addFields(container, options);

  if (hasFields) {
    container.addSeparatorComponents(new SeparatorBuilder());
  }

  const hasMedia = addMedia(container, options);

  if (hasMedia && Array.isArray(options.actions) && options.actions.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
  }

  const hasActions = addActions(container, options);

  addFooter(container, interaction, options, hasHeader || hasFields || hasMedia || hasActions);

  return container;
}

function cv2Flags(ephemeral = false) {
  return ephemeral
    ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    : MessageFlags.IsComponentsV2;
}

function createCv2Reply(interaction, options = {}, ephemeral = false) {
  return {
    flags: cv2Flags(ephemeral),
    components: [createCv2Container(interaction, options)]
  };
}

function createCv2Edit(interaction, options = {}) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [createCv2Container(interaction, options)]
  };
}

module.exports = {
  createCv2Reply,
  createCv2Edit,
  CV2_COLOR,
  CV2_SUCCESS_COLOR,
  CV2_ERROR_COLOR,
  CV2_WARNING_COLOR
};
