class CooldownManager {
  constructor() {
    this.cache = new Map();
    this.nextSweepAt = Date.now() + 30_000;
  }

  sweep(now = Date.now()) {
    if (now < this.nextSweepAt) {
      return;
    }

    for (const [commandName, userMap] of this.cache.entries()) {
      for (const [userId, expiresAt] of userMap.entries()) {
        if (expiresAt <= now) {
          userMap.delete(userId);
        }
      }

      if (userMap.size === 0) {
        this.cache.delete(commandName);
      }
    }

    this.nextSweepAt = now + 30_000;
  }

  hit(commandName, userId, cooldownMs, now = Date.now()) {
    this.sweep(now);

    if (!cooldownMs || cooldownMs <= 0) {
      return 0;
    }

    const commandKey = String(commandName);
    const userKey = String(userId);
    const userMap = this.cache.get(commandKey) || new Map();
    const expiresAt = userMap.get(userKey) || 0;

    if (expiresAt > now) {
      return expiresAt - now;
    }

    userMap.set(userKey, now + cooldownMs);
    this.cache.set(commandKey, userMap);

    return 0;
  }
}

module.exports = new CooldownManager();
