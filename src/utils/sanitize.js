const MAX_TEXT_LENGTH = 1900;

const CONTROL_CHARS_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const MULTI_SPACE_REGEX = /[ \t]{2,}/g;

function sanitizeText(input, options = {}) {
  const maxLength =
    typeof options.maxLength === "number" && options.maxLength > 0
      ? Math.floor(options.maxLength)
      : MAX_TEXT_LENGTH;

  const fallback =
    typeof options.fallback === "string" && options.fallback.length > 0
      ? options.fallback
      : "-";

  if (input == null) {
    return fallback;
  }

  const normalized = String(input)
    .replace(/\r\n/g, "\n")
    .replace(CONTROL_CHARS_REGEX, "")
    .replace(MULTI_SPACE_REGEX, " ")
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(1, maxLength - 1)).trim()}…`;
}

function sanitizeInlineText(input, options = {}) {
  return sanitizeText(input, { ...options, maxLength: options.maxLength || 160 })
    .replace(/\n+/g, " ")
    .trim();
}

function domainAllowed(hostname, allowedDomains = []) {
  const host = String(hostname || "").toLowerCase();

  if (!host) {
    return false;
  }

  return allowedDomains.some((rawDomain) => {
    const domain = String(rawDomain || "")
      .trim()
      .toLowerCase();

    if (!domain) {
      return false;
    }

    return host === domain || host.endsWith(`.${domain}`);
  });
}

function sanitizeUrl(input, options = {}) {
  const protocols = Array.isArray(options.protocols) && options.protocols.length > 0
    ? options.protocols
    : ["https:"];
  const allowedDomains = Array.isArray(options.allowedDomains)
    ? options.allowedDomains
    : [];

  if (typeof input !== "string" || !input.trim()) {
    return null;
  }

  let parsed;

  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  if (!protocols.includes(parsed.protocol)) {
    return null;
  }

  if (parsed.username || parsed.password) {
    return null;
  }

  if (allowedDomains.length > 0 && !domainAllowed(parsed.hostname, allowedDomains)) {
    return null;
  }

  parsed.hash = "";

  return parsed.toString();
}

module.exports = {
  sanitizeText,
  sanitizeInlineText,
  sanitizeUrl,
  domainAllowed
};
