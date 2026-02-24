const { SlashCommandBuilder } = require("discord.js");

const { createCv2Reply } = require("../../utils/cv2-components");

function formatUptime(totalSeconds) {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }

  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || hours > 0 || days > 0) {
    parts.push(`${minutes}m`);
  }

  parts.push(`${seconds}s`);

  return parts.join(" ");
}

module.exports = {
  category: "general",
  cooldownMs: 1200,
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Responde com latencia do bot."),
  async execute(interaction) {
    const latency = Date.now() - interaction.createdTimestamp;
    const gatewayPing = Math.max(0, Math.round(interaction.client.ws.ping));
    const uptime = formatUptime(Math.floor(process.uptime()));

    await interaction.reply(
      createCv2Reply(interaction, {
        tone: "info",
        eyebrow: "Diagnostico",
        title: "Conexao em tempo real",
        description: "Estado atual da instancia para monitoramento rapido.",
        fields: [
          { name: "Latencia da interacao", value: `${latency}ms` },
          { name: "Latencia do gateway", value: `${gatewayPing}ms` },
          { name: "Uptime", value: uptime }
        ]
      })
    );
  }
};
