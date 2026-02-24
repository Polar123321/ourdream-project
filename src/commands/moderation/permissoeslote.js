const {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
} = require("discord.js");

const { createCv2Edit, createCv2Reply } = require("../../utils/cv2-components");
const { sanitizeInlineText } = require("../../utils/sanitize");

const PERMISSION_CATALOG = [
  { key: "ViewChannel", label: "Ver canal" },
  { key: "ManageChannels", label: "Gerenciar canal" },
  { key: "ManageRoles", label: "Gerenciar permissoes" },
  { key: "ManageWebhooks", label: "Gerenciar webhooks" },
  { key: "CreateInstantInvite", label: "Criar convite" },
  { key: "SendMessages", label: "Enviar mensagens" },
  { key: "SendMessagesInThreads", label: "Enviar mensagens em topicos" },
  { key: "CreatePublicThreads", label: "Criar topicos publicos" },
  { key: "CreatePrivateThreads", label: "Criar topicos privados" },
  { key: "EmbedLinks", label: "Inserir links" },
  { key: "AttachFiles", label: "Anexar arquivos" },
  { key: "AddReactions", label: "Adicionar reacoes" },
  { key: "UseExternalEmojis", label: "Usar emojis externos" },
  { key: "UseExternalStickers", label: "Usar figurinhas externas" },
  { key: "MentionEveryone", label: "Mencionar @everyone/@here" },
  { key: "ReadMessageHistory", label: "Ver historico de mensagens" },
  { key: "ManageMessages", label: "Gerenciar mensagens" },
  { key: "ManageThreads", label: "Gerenciar topicos" },
  { key: "UseApplicationCommands", label: "Usar comandos de aplicativo" },
  { key: "UseEmbeddedActivities", label: "Usar atividades" },
  { key: "UseExternalApps", label: "Utilizar aplicativos externos" },
  { key: "SendTTSMessages", label: "Enviar mensagens TTS" },
  { key: "SendPolls", label: "Criar enquetes" },
  { key: "SendVoiceMessages", label: "Enviar mensagens de voz" },
  { key: "Connect", label: "Conectar em canais de voz" },
  { key: "Speak", label: "Falar em canais de voz" },
  { key: "Stream", label: "Transmitir video (Go Live)" },
  { key: "UseVAD", label: "Usar deteccao de voz" },
  { key: "PrioritySpeaker", label: "Orador prioritario" },
  { key: "MuteMembers", label: "Silenciar membros (voz)" },
  { key: "DeafenMembers", label: "Ensurdecer membros (voz)" },
  { key: "MoveMembers", label: "Mover membros (voz)" },
  { key: "RequestToSpeak", label: "Pedir para falar (palco)" },
  { key: "UseSoundboard", label: "Usar soundboard" },
  { key: "UseExternalSounds", label: "Usar sons externos" },
  { key: "ManageEvents", label: "Gerenciar eventos" }
];

const AVAILABLE_PERMISSION_ENTRIES = PERMISSION_CATALOG
  .filter((entry) => Object.prototype.hasOwnProperty.call(PermissionFlagsBits, entry.key))
  .map((entry) => ({
    key: entry.key,
    label: entry.label,
    normalizedLabel: entry.label.toLowerCase(),
    normalizedKey: entry.key.toLowerCase()
  }));

const PERMISSION_BIT_BY_KEY = new Map(
  AVAILABLE_PERMISSION_ENTRIES.map((entry) => [entry.key, PermissionFlagsBits[entry.key]])
);

const PERMISSION_OPTION_NAMES = [
  "permissao_1",
  "permissao_2",
  "permissao_3",
  "permissao_4"
];

const ROLE_OPTION_NAMES = [
  "cargo",
  "cargo_2",
  "cargo_3",
  "cargo_4"
];

const EXPLICIT_CHANNEL_OPTION_COUNT = 8;
const EXPLICIT_CHANNEL_OPTION_NAMES = Array.from(
  { length: EXPLICIT_CHANNEL_OPTION_COUNT },
  (_, index) => `canal_${index + 1}`
);

const APPLICABLE_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.GuildCategory
];

const AUTOCOMPLETE_RESULT_LIMIT = 25;

const ACTION_CHOICES = [
  { name: "Permitir", value: "allow" },
  { name: "Negar", value: "deny" },
  { name: "Herdar (limpar overwrite)", value: "clear" }
];

const SCOPE_CHOICES = [
  { name: "Todos os canais", value: "all" },
  { name: "Apenas canais de texto", value: "text" },
  { name: "Apenas canais de voz/palco", value: "voice" },
  { name: "Apenas categorias", value: "categories" },
  { name: "Apenas foruns/midia", value: "forum" },
  { name: "Apenas anuncios", value: "announcement" }
];

function safeReason(rawReason) {
  return sanitizeInlineText(rawReason || "Sem motivo informado", {
    maxLength: 220,
    fallback: "Sem motivo informado"
  });
}

function toScopeLabel(scope) {
  const found = SCOPE_CHOICES.find((entry) => entry.value === scope);
  return found?.name || "Todos os canais";
}

function toPermissionLabel(permissionKey) {
  const found = AVAILABLE_PERMISSION_ENTRIES.find((entry) => entry.key === permissionKey);
  return found?.label || permissionKey;
}

function permissionAutocompleteLabel(entry) {
  const base = `${entry.label} [${entry.key}]`;
  return base.length <= 100 ? base : `${base.slice(0, 97)}...`;
}

function desiredStateFromAction(action) {
  if (action === "allow") {
    return "allow";
  }

  if (action === "deny") {
    return "deny";
  }

  return "inherit";
}

function overwriteValueFromAction(action) {
  if (action === "allow") {
    return true;
  }

  if (action === "deny") {
    return false;
  }

  return null;
}

function actionLabel(action) {
  if (action === "allow") {
    return "Permitir";
  }

  if (action === "deny") {
    return "Negar";
  }

  return "Herdar";
}

function isThreadType(type) {
  return (
    type === ChannelType.AnnouncementThread ||
    type === ChannelType.PublicThread ||
    type === ChannelType.PrivateThread
  );
}

function matchesScope(channel, scope) {
  const type = channel.type;

  if (scope === "text") {
    return type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement;
  }

  if (scope === "voice") {
    return type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice;
  }

  if (scope === "categories") {
    return type === ChannelType.GuildCategory;
  }

  if (scope === "forum") {
    return type === ChannelType.GuildForum || type === ChannelType.GuildMedia;
  }

  if (scope === "announcement") {
    return type === ChannelType.GuildAnnouncement;
  }

  return !isThreadType(type);
}

function matchesCategoryFilter(channel, categoryId, scope) {
  if (!categoryId) {
    return true;
  }

  if (scope === "categories") {
    return channel.id === categoryId;
  }

  if (channel.type === ChannelType.GuildCategory) {
    return false;
  }

  return channel.parentId === categoryId;
}

function currentOverwriteState(channel, roleId, permissionBit) {
  const overwrite = channel.permissionOverwrites.cache.get(roleId);

  if (!overwrite) {
    return "inherit";
  }

  if (overwrite.allow.has(permissionBit)) {
    return "allow";
  }

  if (overwrite.deny.has(permissionBit)) {
    return "deny";
  }

  return "inherit";
}

function channelRef(channel) {
  return `<#${channel.id}>`;
}

function buildAuditReason(interaction, permissionKeys, action, userReason) {
  const permissionList = permissionKeys.join(",");
  const base = `Permissao em lote: [${permissionList}] = ${action} por ${interaction.user.tag} (${interaction.user.id})`;
  const reason = userReason && userReason !== "Sem motivo informado" ? `${base} | ${userReason}` : base;
  return reason.slice(0, 500);
}

function collectTargetRoles(interaction) {
  const byId = new Map();

  for (const optionName of ROLE_OPTION_NAMES) {
    const role = interaction.options.getRole(optionName);

    if (!role) {
      continue;
    }

    byId.set(role.id, role);
  }

  return [...byId.values()];
}

function collectPermissionKeys(interaction) {
  const selected = [];

  for (const optionName of PERMISSION_OPTION_NAMES) {
    const value = interaction.options.getString(optionName);

    if (!value) {
      continue;
    }

    const key = String(value).trim();

    if (!key || selected.includes(key)) {
      continue;
    }

    selected.push(key);
  }

  return selected;
}

function collectExplicitChannels(interaction) {
  const byId = new Map();

  for (const optionName of EXPLICIT_CHANNEL_OPTION_NAMES) {
    const channel = interaction.options.getChannel(optionName);

    if (!channel) {
      continue;
    }

    if (isThreadType(channel.type)) {
      continue;
    }

    byId.set(channel.id, channel);
  }

  return [...byId.values()];
}

function buildPermissionFieldValue(permissionKeys) {
  return permissionKeys.map((permissionKey) => `- ${toPermissionLabel(permissionKey)}`).join("\n");
}

function buildSelectedChannelsFieldValue(channels) {
  if (channels.length === 0) {
    return "-";
  }

  return channels.map((channel) => channelRef(channel)).join("\n");
}

function buildSelectedRolesFieldValue(roles) {
  if (roles.length === 0) {
    return "-";
  }

  return roles.map((role) => `<@&${role.id}>`).join("\n");
}

function createCommandData() {
  const builder = new SlashCommandBuilder()
    .setName("permissoeslote")
    .setDescription("Aplica permissoes de canal em lote para um ou mais cargos.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addRoleOption((option) =>
      option
        .setName("cargo")
        .setDescription("Cargo principal para aplicar as permissoes")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("permissao_1")
        .setDescription("Primeira permissao")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((option) => {
      option
        .setName("acao")
        .setDescription("Como aplicar as permissoes para o cargo")
        .setRequired(true);

      for (const actionChoice of ACTION_CHOICES) {
        option.addChoices(actionChoice);
      }

      return option;
    })
    .addRoleOption((option) =>
      option
        .setName("cargo_2")
        .setDescription("Segundo cargo (opcional)")
        .setRequired(false)
    )
    .addRoleOption((option) =>
      option
        .setName("cargo_3")
        .setDescription("Terceiro cargo (opcional)")
        .setRequired(false)
    )
    .addRoleOption((option) =>
      option
        .setName("cargo_4")
        .setDescription("Quarto cargo (opcional)")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("permissao_2")
        .setDescription("Segunda permissao (opcional)")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("permissao_3")
        .setDescription("Terceira permissao (opcional)")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption((option) =>
      option
        .setName("permissao_4")
        .setDescription("Quarta permissao (opcional)")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption((option) => {
      option
        .setName("escopo")
        .setDescription("Quais canais devem ser alterados")
        .setRequired(false);

      for (const scopeChoice of SCOPE_CHOICES) {
        option.addChoices(scopeChoice);
      }

      return option;
    })
    .addChannelOption((option) =>
      option
        .setName("categoria")
        .setDescription("Limita a aplicacao para uma categoria especifica")
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildCategory)
    );

  for (let index = 0; index < EXPLICIT_CHANNEL_OPTION_COUNT; index += 1) {
    const optionName = `canal_${index + 1}`;

    builder.addChannelOption((option) =>
      option
        .setName(optionName)
        .setDescription(`Canal especifico ${index + 1} (opcional)`)
        .setRequired(false)
        .addChannelTypes(...APPLICABLE_CHANNEL_TYPES)
    );
  }

  builder.addStringOption((option) =>
    option
      .setName("motivo")
      .setDescription("Motivo para registrar no log de auditoria")
      .setRequired(false)
  );

  return builder;
}

module.exports = {
  category: "moderation",
  cooldownMs: 4500,
  data: createCommandData(),
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (!focused || !PERMISSION_OPTION_NAMES.includes(focused.name)) {
      await interaction.respond([]);
      return;
    }

    const selectedKeys = new Set();

    for (const optionName of PERMISSION_OPTION_NAMES) {
      if (optionName === focused.name) {
        continue;
      }

      const selectedValue = interaction.options.getString(optionName);

      if (selectedValue) {
        selectedKeys.add(String(selectedValue).trim());
      }
    }

    const query = String(focused.value || "").trim().toLowerCase();

    const results = AVAILABLE_PERMISSION_ENTRIES
      .filter((entry) => !selectedKeys.has(entry.key))
      .filter((entry) =>
        !query ||
        entry.normalizedLabel.includes(query) ||
        entry.normalizedKey.includes(query)
      )
      .slice(0, AUTOCOMPLETE_RESULT_LIMIT)
      .map((entry) => ({
        name: permissionAutocompleteLabel(entry),
        value: entry.key
      }));

    await interaction.respond(results);
  },
  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            title: "Este comando so funciona em servidor",
            description: "Abra um canal do servidor e rode /permissoeslote novamente."
          },
          true
        )
      );
      return;
    }

    const targetRoles = collectTargetRoles(interaction);
    const action = interaction.options.getString("acao", true);
    const scope = interaction.options.getString("escopo") || "all";
    const targetCategory = interaction.options.getChannel("categoria");
    const userReason = safeReason(interaction.options.getString("motivo"));
    const permissionKeys = collectPermissionKeys(interaction);

    if (targetRoles.length === 0) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Moderacao",
            title: "Cargo invalido",
            description: "Selecione pelo menos um cargo para aplicar as permissoes."
          },
          true
        )
      );
      return;
    }

    if (permissionKeys.length === 0) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Moderacao",
            title: "Permissao invalida",
            description: "Selecione pelo menos uma permissao para aplicar."
          },
          true
        )
      );
      return;
    }

    const invalidPermission = permissionKeys.find((permissionKey) =>
      !PERMISSION_BIT_BY_KEY.has(permissionKey)
    );

    if (invalidPermission) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Moderacao",
            title: "Permissao invalida",
            description:
              `A permissao \`${invalidPermission}\` nao e suportada nesta versao do bot.`
          },
          true
        )
      );
      return;
    }

    const me =
      interaction.guild.members.me ||
      (await interaction.guild.members.fetchMe().catch(() => null));

    if (!me) {
      await interaction.reply(
        createCv2Reply(
          interaction,
          {
            tone: "error",
            eyebrow: "Moderacao",
            title: "Nao consegui carregar o membro do bot",
            description: "Tente novamente em instantes."
          },
          true
        )
      );
      return;
    }

    await interaction.deferReply({
      flags: MessageFlags.Ephemeral
    });

    const explicitChannels = collectExplicitChannels(interaction);
    const useExplicitChannels = explicitChannels.length > 0;
    let channels = [];

    if (useExplicitChannels) {
      channels = explicitChannels;
    } else {
      const channelsCollection = await interaction.guild.channels.fetch();

      for (const channel of channelsCollection.values()) {
        if (!channel) {
          continue;
        }

        if (!matchesScope(channel, scope)) {
          continue;
        }

        if (!matchesCategoryFilter(channel, targetCategory?.id || "", scope)) {
          continue;
        }

        channels.push(channel);
      }
    }

    if (channels.length === 0) {
      await interaction.editReply(
        createCv2Edit(interaction, {
          tone: "warning",
          eyebrow: "Moderacao",
          title: "Nenhum canal encontrado",
          description:
            "Nao encontrei canais com esse escopo/filtro para aplicar a alteracao."
        })
      );
      return;
    }

    const desiredState = desiredStateFromAction(action);
    const overwriteValue = overwriteValueFromAction(action);
    const auditReason = buildAuditReason(interaction, permissionKeys, action, userReason);

    let updatedTargetCount = 0;
    let unchangedTargetCount = 0;
    let skippedNoPermissionCount = 0;
    let failedTargetCount = 0;
    let changedPermissionAssignments = 0;
    const failedChannels = [];

    for (const channel of channels) {
      const botPermissions = me.permissionsIn(channel);

      if (!botPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        skippedNoPermissionCount += 1;
        continue;
      }

      for (const targetRole of targetRoles) {
        const patch = {};
        let changedInThisTarget = 0;

        for (const permissionKey of permissionKeys) {
          const permissionBit = PERMISSION_BIT_BY_KEY.get(permissionKey);
          const currentState = currentOverwriteState(channel, targetRole.id, permissionBit);

          if (currentState === desiredState) {
            continue;
          }

          patch[permissionKey] = overwriteValue;
          changedInThisTarget += 1;
        }

        if (changedInThisTarget === 0) {
          unchangedTargetCount += 1;
          continue;
        }

        try {
          await channel.permissionOverwrites.edit(targetRole.id, patch, { reason: auditReason });
          updatedTargetCount += 1;
          changedPermissionAssignments += changedInThisTarget;
        } catch (error) {
          failedTargetCount += 1;

          if (failedChannels.length < 6) {
            const errCode = error?.code || error?.message || "erro";
            failedChannels.push(`${channelRef(channel)} | <@&${targetRole.id}> - ${errCode}`);
          }
        }
      }
    }

    const tone =
      failedTargetCount > 0 && updatedTargetCount === 0
        ? "error"
        : failedTargetCount > 0
          ? "warning"
          : "success";

    const fields = [
      { name: "Cargos alvo", value: buildSelectedRolesFieldValue(targetRoles) },
      { name: "Permissoes", value: buildPermissionFieldValue(permissionKeys) },
      { name: "Acao", value: actionLabel(action) },
      {
        name: "Selecao de canais",
        value: useExplicitChannels ? "Canais especificos selecionados" : toScopeLabel(scope)
      },
      {
        name: "Resumo",
        value: [
          `Alvos atualizados (canal + cargo): ${updatedTargetCount}`,
          `Aplicacoes de permissao: ${changedPermissionAssignments}`,
          `Ja estavam assim: ${unchangedTargetCount}`,
          `Sem permissao no canal: ${skippedNoPermissionCount}`,
          `Falhas: ${failedTargetCount}`
        ].join("\n")
      }
    ];

    if (useExplicitChannels) {
      fields.push({
        name: "Canais selecionados",
        value: buildSelectedChannelsFieldValue(channels)
      });
    } else if (targetCategory) {
      fields.push({
        name: "Categoria filtro",
        value: `${targetCategory.name} (${targetCategory.id})`
      });
    }

    if (failedChannels.length > 0) {
      fields.push({
        name: "Falhas (amostra)",
        value: failedChannels.join("\n")
      });
    }

    await interaction.editReply(
      createCv2Edit(interaction, {
        tone,
        eyebrow: "Moderacao",
        title: "Permissoes aplicadas em lote",
        description:
          "Processo concluido. Confira o resumo para validar canais atualizados e eventuais falhas.",
        fields
      })
    );
  }
};
