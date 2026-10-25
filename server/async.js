export class TimeoutError extends Error {
  constructor(message = "The operation timed out.") {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Reject if `promise` does not settle within `timeoutMs`.
 * The timer is always cleared so no dangling handles keep the process alive.
 */
export function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
