function now() {
  return new Date().toISOString();
}

function info(message) {
  console.log(`[${now()}] [INFO] ${message}`);
}

function warn(message) {
  console.warn(`[${now()}] [WARN] ${message}`);
}

function error(message, err) {
  if (err) {
    console.error(`[${now()}] [ERROR] ${message}`, err);
    return;
  }

  console.error(`[${now()}] [ERROR] ${message}`);
}

module.exports = {
  info,
  warn,
  error
};

