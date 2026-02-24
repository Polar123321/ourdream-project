const { createCv2Edit, createCv2Reply } = require("./cv2-components");
const { sanitizeInlineText } = require("./sanitize");

function formatCooldown(remainingMs) {
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return seconds === 1 ? "1 segundo" : `${seconds} segundos`;
}

function buildCommandErrorOptions(commandName, error) {
  const safeName = sanitizeInlineText(commandName || "comando", { maxLength: 40 });
  const code = error?.code || "";

  if (code === "HTTP_TIMEOUT") {
    return {
      tone: "warning",
      title: "Servico temporariamente lento",
      description: `A fonte de midia de /${safeName} demorou demais para responder. Tente de novo em instantes.`
    };
  }

  if (code === "URL_NOT_ALLOWED") {
    return {
      tone: "error",
      title: "Conteudo bloqueado por seguranca",
      description:
        "Recebi uma URL fora da allowlist configurada. A resposta foi bloqueada para manter o bot seguro."
    };
  }

  return {
    tone: "error",
    title: `Nao consegui concluir /${safeName}`,
    description:
      "Aconteceu um erro inesperado ao processar o comando. Tente novamente daqui a pouco."
  };
}

async function sendCv2(interaction, options, ephemeral = false) {
  if (interaction.deferred && !interaction.replied) {
    return interaction.editReply(createCv2Edit(interaction, options)).catch(() => null);
  }

  if (interaction.replied) {
    return interaction
      .followUp(createCv2Reply(interaction, options, ephemeral))
      .catch(() => null);
  }

  return interaction
    .reply(createCv2Reply(interaction, options, ephemeral))
    .catch(() => null);
}

module.exports = {
  sendCv2,
  formatCooldown,
  buildCommandErrorOptions
};
