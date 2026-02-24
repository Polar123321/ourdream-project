function actionPreset(config) {
  return {
    cooldownMs: 4500,
    mediaFallbackText: "Visual temporariamente indisponivel.",
    ...config
  };
}

const KISS_TEMPLATES = [
  "{author} deu um beijo carinhoso em {target}.",
  "{author} puxou {target} para um beijo surpresa.",
  "{author} mandou um beijo cheio de amor para {target}.",
  "{author} e {target} acabaram em um beijo cinematografico."
];

const ACTION_PRESETS = {
  beijo: actionPreset({
    title: "Beijo",
    description: "Da um beijo em alguem.",
    selfMessage: "Auto-beijo nao vale. Marca alguem para beijar.",
    templates: KISS_TEMPLATES,
    apiSources: [
      {
        name: "waifu.pics",
        url: "https://api.waifu.pics/sfw/kiss",
        parser: "waifuPics"
      }
    ]
  }),
  beijar: actionPreset({
    title: "Beijar",
    description: "Beija alguem com um GIF.",
    selfMessage: "Nao vale se beijar sozinho. Marca outra pessoa.",
    templates: KISS_TEMPLATES,
    apiSources: [
      {
        name: "waifu.pics",
        url: "https://api.waifu.pics/sfw/kiss",
        parser: "waifuPics"
      }
    ]
  }),
  abraco: actionPreset({
    title: "Abraco",
    description: "Da um abraco em alguem.",
    selfMessage: "Nao tem como se abracar sozinho. Marca alguem.",
    templates: [
      "{author} abracou {target} bem forte.",
      "{author} deu um abraco quentinho em {target}.",
      "{author} abriu os bracos e puxou {target} para perto.",
      "{author} entregou um abraco de paz para {target}."
    ],
    apiSources: [
      {
        name: "waifu.pics",
        url: "https://api.waifu.pics/sfw/hug",
        parser: "waifuPics"
      }
    ]
  }),
  tapa: actionPreset({
    title: "Tapa",
    description: "Da um tapa em alguem.",
    selfMessage: "Dar tapa em si mesmo so gera arrependimento.",
    templates: [
      "{author} deu um tapa rapido em {target}.",
      "{author} acertou um tapao em {target}.",
      "{author} puxou o braco e mandou um tapa em {target}.",
      "{author} perdeu a paciencia e tapou {target}."
    ],
    apiSources: [
      {
        name: "waifu.pics",
        url: "https://api.waifu.pics/sfw/slap",
        parser: "waifuPics"
      }
    ]
  }),
  empurrar: actionPreset({
    title: "Empurrao",
    description: "Empurra alguem para longe.",
    selfMessage: "Nao da para se empurrar sozinho desse jeito.",
    templates: [
      "{author} empurrou {target} para o canto.",
      "{author} deu um empurrao em {target}.",
      "{author} afastou {target} com um empurrao.",
      "{author} mandou {target} para tras com um empurrao."
    ],
    apiSources: [
      {
        name: "waifu.pics",
        url: "https://api.waifu.pics/sfw/poke",
        parser: "waifuPics"
      },
      {
        name: "waifu.pics",
        url: "https://api.waifu.pics/sfw/kick",
        parser: "waifuPics"
      }
    ]
  }),
  soco: actionPreset({
    title: "Soco",
    description: "Da um soco em alguem.",
    selfMessage: "Auto-soco e proibido por motivos obvios.",
    templates: [
      "{author} acertou um soco em {target}.",
      "{author} partiu para cima e socou {target}.",
      "{author} encaixou um direto em {target}.",
      "{author} soltou um soco cinematografico em {target}."
    ],
    apiSources: [
      {
        name: "nekos.best",
        url: "https://nekos.best/api/v2/punch",
        parser: "nekosBest"
      }
    ]
  }),
  morder: actionPreset({
    title: "Mordida",
    description: "Morde alguem de brincadeira.",
    selfMessage: "Morder a si mesmo nao parece uma boa ideia.",
    templates: [
      "{author} mordeu {target} de leve.",
      "{author} deu uma mordida em {target}.",
      "{author} cravou os dentes em {target} (de zoeira).",
      "{author} deu uma mordidinha carinhosa em {target}."
    ],
    apiSources: [
      {
        name: "waifu.pics",
        url: "https://api.waifu.pics/sfw/bite",
        parser: "waifuPics"
      }
    ]
  }),
  cafune: actionPreset({
    title: "Cafune",
    description: "Faz cafune em alguem.",
    selfMessage: "Se quiser cafune, marque alguem para receber.",
    templates: [
      "{author} fez cafune em {target}.",
      "{author} acariciou o cabelo de {target}.",
      "{author} deu um cafune bem tranquilo em {target}.",
      "{author} deixou {target} relaxado com um cafune."
    ],
    apiSources: [
      {
        name: "waifu.pics",
        url: "https://api.waifu.pics/sfw/pat",
        parser: "waifuPics"
      }
    ]
  })
};

module.exports = {
  ACTION_PRESETS
};
