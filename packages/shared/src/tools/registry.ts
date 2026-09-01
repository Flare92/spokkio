import { CONTACTS_TOOLS } from "./contacts";
import { CAMPAIGNS_TOOLS } from "./campaigns";
import { TEMPLATES_TOOLS } from "./templates";
import { INBOX_TOOLS } from "./inbox";
import { AUTOMATIONS_TOOLS } from "./automations";
import { ANALYTICS_TOOLS } from "./analytics";
import { BILLING_TOOLS } from "./billing";

// Single registry of every business action in the platform, each with a
// zod input/output schema. The REST API binds to these tool definitions
// today; an MCP server can bind to the exact same registry later without
// any refactor (see project constraint: MCP-native from day one).
export const TOOL_REGISTRY = {
  ...CONTACTS_TOOLS,
  ...CAMPAIGNS_TOOLS,
  ...TEMPLATES_TOOLS,
  ...INBOX_TOOLS,
  ...AUTOMATIONS_TOOLS,
  ...ANALYTICS_TOOLS,
  ...BILLING_TOOLS,
} as const;

export type ToolName = keyof typeof TOOL_REGISTRY;
