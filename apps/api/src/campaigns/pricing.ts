import { MessageCategory } from "@spokkio/shared";

// Meta's published per-conversation rate card for Italy (EUR), by category.
// NOTE: these figures must be kept in sync with Meta's official WhatsApp
// Business Platform pricing page — they change periodically and Meta bills
// per-conversation, not per-message. This is the single source of truth the
// cost simulator and the invoice line item both read from, so a price
// update here updates both consistently (never let them drift apart).
export const META_CONVERSATION_RATE_EUR_IT: Record<MessageCategory, number> = {
  MARKETING: 0.0728,
  UTILITY: 0.0388,
  AUTHENTICATION: 0.0388,
  SERVICE: 0, // service conversations (user-initiated, 24h window) are free
};

// Single declared markup applied uniformly per conversation, shown as its
// own breakdown line — never hidden inside a bundled "credit" price.
export const PLATFORM_MARKUP_EUR = Number(process.env.PLATFORM_MARKUP_PER_CONVERSATION_EUR ?? "0.01");
