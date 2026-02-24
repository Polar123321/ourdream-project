# Bot de Discord (Node.js + discord.js + Components V2)

Bot modular com foco em seguranca, resiliencia e visual premium em Components V2.

## Stack

- Node.js 20+
- CommonJS
- discord.js 14.24.2

## Comandos disponiveis

- `/ping`
- `/help`
- `/avatar`
- `/server`
- `/clear`
- `/kick`
- `/permissoeslote`
- `/beijo`, `/beijar`, `/abraco`, `/tapa`, `/empurrar`, `/soco`, `/morder`, `/cafune`

## O que mudou na refatoracao

- Cliente HTTP central (`src/utils/http-client.js`) com:
  - timeout
  - retry com backoff
  - tratamento de erro consistente
  - validacao de URL final apos redirects
- Allowlist de dominios para API e midia (`src/config.js`).
- Sanitizacao reutilizavel de texto/URL (`src/utils/sanitize.js`).
- Cooldown por usuario/comando (`src/utils/cooldown-manager.js` + `src/events/interaction-create.js`).
- `/help` dinamico por categoria via metadata de comando (sem lista hardcoded por nome).
- Unificacao de comandos de acao: `/beijar` agora usa o mesmo fluxo de `/beijo` e demais.
- Moderacao reforcada:
  - `/kick` com validacao de hierarquia (moderador e bot), bloqueios explicitos e erros amigaveis.
  - `/clear` com validacao de permissao/canal e respostas robustas.
- Sistema visual Components V2 redesenhado (`src/utils/cv2-components.js`):
  - temas por tom (`info`, `success`, `error`, `warning/alert`)
  - hierarquia tipografica consistente
  - separadores padronizados
  - botoes com rotulos curtos
  - fallback visual quando nao houver midia valida
  - rodape discreto
- Registro/serializacao de comandos centralizado em `src/utils/command-registry.js`.

## Variaveis de ambiente

Crie `.env`:

```env
DISCORD_TOKEN=seu_token
CLIENT_ID=seu_client_id
GUILD_ID=seu_guild_id_opcional

# Rede
HTTP_TIMEOUT_MS=9000
HTTP_MAX_RETRIES=2
HTTP_RETRY_BASE_MS=350

# Cooldown global padrao (ms)
DEFAULT_COMMAND_COOLDOWN_MS=2500

# Economia (chat)
ECONOMY_SPAM_WINDOW_MS=10000
ECONOMY_SPAM_MESSAGE_LIMIT=10
ECONOMY_SPAM_COOLDOWN_BASE_MS=10000
ECONOMY_SPAM_COOLDOWN_MAX_MS=60000
ECONOMY_SPAM_STRIKE_RESET_MS=60000
ECONOMY_SPAM_BACKLOG_DELETE_LIMIT=8
ECONOMY_SPAM_WARN_COOLDOWN_MS=2500
ECONOMY_SPAM_AUTOMUTE_THRESHOLD_MS=30000
ECONOMY_SPAM_AUTOMUTE_DURATION_MS=600000
ECONOMY_REWARD_NOTICE_DELETE_SECONDS=15

# Allowlist (csv)
ALLOWED_API_DOMAINS=api.waifu.pics,waifu.pics,nekos.best
ALLOWED_MEDIA_DOMAINS=waifu.pics,i.waifu.pics,nekos.best,cdn.discordapp.com,media.discordapp.net,images-ext-1.discordapp.net,images-ext-2.discordapp.net
```

## Executar

Instalar dependencias:

```bash
npm install
```

Deploy dos slash commands:

```bash
npm run deploy
```

Iniciar bot:

```bash
npm run start
```

Modo desenvolvimento:

```bash
npm run dev
```

## Validacao local recomendada

Checagem de sintaxe:

```bash
powershell -Command "Get-ChildItem -Path src -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }"
```

Checagem de serializacao de comandos:

```bash
node -e "const { discoverCommandModules } = require('./src/utils/command-registry'); const { discovered, errors } = discoverCommandModules(); if (errors.length) { console.error(errors); process.exit(1); } for (const item of discovered) item.command.data.toJSON(); console.log('OK', discovered.length, 'comandos serializados');"
```

## Estrutura principal

```text
src/
  commands/
    actions/
    general/
    moderation/
  data/
  events/
  handlers/
  utils/
  config.js
  deploy-commands.js
  index.js
```
