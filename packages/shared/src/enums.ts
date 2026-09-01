// Plain string-literal unions (not TS `enum`) so these types line up
// structurally with Prisma Client's generated enum types without casts —
// both sides are just the same set of string literals.

// WhatsApp Cloud API message categories — Meta bills per-conversation by category.
// Keeping these explicit (rather than a generic "message type") is what lets the
// billing layer show a single transparent line per category instead of an opaque total.
export const MessageCategoryValues = ["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE"] as const;
export type MessageCategory = (typeof MessageCategoryValues)[number];

export const TemplateStatusValues = ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED"] as const;
export type TemplateStatus = (typeof TemplateStatusValues)[number];

export const CampaignStatusValues = ["DRAFT", "SCHEDULED", "SENDING", "SENT", "FAILED"] as const;
export type CampaignStatus = (typeof CampaignStatusValues)[number];

export const MessageDeliveryStatusValues = ["QUEUED", "SENT", "DELIVERED", "READ", "FAILED"] as const;
export type MessageDeliveryStatus = (typeof MessageDeliveryStatusValues)[number];

export const ConversationChannelValues = ["WHATSAPP"] as const;
export type ConversationChannel = (typeof ConversationChannelValues)[number];

export const AutomationTriggerTypeValues = [
  "APPOINTMENT_REMINDER",
  "POST_VISIT_FOLLOWUP",
  "INACTIVE_CUSTOMER_WINBACK",
] as const;
export type AutomationTriggerType = (typeof AutomationTriggerTypeValues)[number];

// Single, transparent plan for MVP — see product constraint: no multi-wallet pricing.
export const PlanTierValues = ["STANDARD"] as const;
export type PlanTier = (typeof PlanTierValues)[number];
