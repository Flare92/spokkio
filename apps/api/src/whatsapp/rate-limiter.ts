// Minimal per-phone-number-id rate limiter + retry queue for the Meta Cloud
// API. Meta enforces messaging-tier limits and returns HTTP 429 / error code
// 130429 ("rate limit hit") when exceeded — we must never let that surface
// as a silent lost message, so every send goes through this queue with
// bounded exponential backoff instead of firing directly.
export interface QueuedSend<T> {
  run: () => Promise<T>;
}

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 1000;

export class RateLimitedQueue {
  private queues = new Map<string, Promise<unknown>>();

  async enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const run = previous.then(() => this.withRetry(task));
    // Swallow rejection on the chain tracker so one failed send doesn't
    // block the next queued send for the same phone number id.
    this.queues.set(
      key,
      run.catch(() => undefined),
    );
    return run;
  }

  private async withRetry<T>(task: () => Promise<T>, attempt = 0): Promise<T> {
    try {
      return await task();
    } catch (err) {
      const isRateLimited = err instanceof RateLimitError;
      if (isRateLimited && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.withRetry(task, attempt + 1);
      }
      throw err;
    }
  }
}

export class RateLimitError extends Error {
  constructor(message = "WhatsApp Cloud API rate limit hit") {
    super(message);
    this.name = "RateLimitError";
  }
}
