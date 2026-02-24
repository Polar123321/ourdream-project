const config = require("../config");
const logger = require("./logger");
const { sanitizeInlineText, sanitizeUrl } = require("./sanitize");

class HttpClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "HttpClientError";
    this.code = options.code || "HTTP_CLIENT_ERROR";
    this.status = options.status || null;
    this.retriable = Boolean(options.retriable);
    this.context = options.context || null;
    this.cause = options.cause || null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toHttpError(error, context) {
  if (error instanceof HttpClientError) {
    return error;
  }

  if (error?.name === "AbortError") {
    return new HttpClientError("Tempo limite da requisicao excedido.", {
      code: "HTTP_TIMEOUT",
      retriable: true,
      context,
      cause: error
    });
  }

  return new HttpClientError(
    sanitizeInlineText(error?.message || "Falha de rede.", { maxLength: 180 }),
    {
      code: "HTTP_NETWORK_ERROR",
      retriable: true,
      context,
      cause: error
    }
  );
}

function isRetriableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function toBackoffDelay(attempt) {
  const base = config.http.retryBaseMs;
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(3000, base * 2 ** Math.max(0, attempt - 1) + jitter);
}

function resolveAllowlist(kind) {
  return kind === "media"
    ? config.security.allowedMediaDomains
    : config.security.allowedApiDomains;
}

function assertAllowedUrl(url, kind = "api") {
  const normalized = sanitizeUrl(url, {
    allowedDomains: resolveAllowlist(kind)
  });

  if (!normalized) {
    throw new HttpClientError("URL bloqueada pela allowlist de seguranca.", {
      code: "URL_NOT_ALLOWED",
      retriable: false,
      context: { url, kind }
    });
  }

  return normalized;
}

async function fetchJson(url, options = {}) {
  const context = {
    operation: options.operation || "fetch-json"
  };

  const normalizedUrl = assertAllowedUrl(url, "api");
  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : config.http.timeoutMs;
  const maxRetries =
    typeof options.maxRetries === "number" && options.maxRetries >= 0
      ? Math.floor(options.maxRetries)
      : config.http.maxRetries;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(normalizedUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "OurDreamBot/1.0 (+discord.js)"
        }
      });

      const finalUrl = assertAllowedUrl(response.url || normalizedUrl, "api");

      if (!response.ok) {
        throw new HttpClientError(
          `HTTP ${response.status} em ${sanitizeInlineText(finalUrl, {
            maxLength: 80
          })}.`,
          {
            code: "HTTP_BAD_STATUS",
            status: response.status,
            retriable: isRetriableStatus(response.status),
            context: { ...context, finalUrl }
          }
        );
      }

      let data;

      try {
        data = await response.json();
      } catch (error) {
        throw new HttpClientError("Resposta JSON invalida.", {
          code: "HTTP_INVALID_JSON",
          retriable: false,
          context: { ...context, finalUrl },
          cause: error
        });
      }

      return {
        data,
        finalUrl,
        status: response.status
      };
    } catch (error) {
      const normalizedError = toHttpError(error, context);
      lastError = normalizedError;

      if (!normalizedError.retriable || attempt >= maxRetries) {
        break;
      }

      await sleep(toBackoffDelay(attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  logger.warn(
    `Requisicao falhou apos tentativas: ${
      lastError?.code || "HTTP_CLIENT_ERROR"
    } (${sanitizeInlineText(lastError?.message || "erro desconhecido", {
      maxLength: 220
    })})`
  );

  throw lastError ||
    new HttpClientError("Falha de rede sem detalhes.", {
      code: "HTTP_UNKNOWN",
      retriable: false,
      context
    });
}

module.exports = {
  fetchJson,
  assertAllowedUrl,
  HttpClientError
};
