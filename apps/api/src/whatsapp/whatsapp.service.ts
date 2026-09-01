import { Injectable, Logger } from "@nestjs/common";
import { MessageCategory } from "@spokkio/shared";
import { RateLimitedQueue, RateLimitError } from "./rate-limiter";

const GRAPH_API_VERSION = "v20.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface SendTemplateMessageParams {
  phoneNumberId: string;
  accessToken: string;
  toE164: string;
  templateName: string;
  language: string;
  variables: string[];
  category: MessageCategory;
}

export interface SendTemplateMessageResult {
  waMessageId: string;
}

// Thin, explicit wrapper around the WhatsApp Cloud API (direct Meta
// integration, no BSP). Every call goes through the rate-limited queue and
// every failure is mapped to a typed, actionable reason instead of a raw
// HTTP error, per the "explicit rate limit / rejected template / delivery
// fallback handling" requirement.
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly queue = new RateLimitedQueue();

  async sendTemplateMessage(params: SendTemplateMessageParams): Promise<SendTemplateMessageResult> {
    return this.queue.enqueue(params.phoneNumberId, () => this.sendOnce(params));
  }

  // Free-form session reply — only deliverable inside Meta's 24h
  // customer-service window opened by an inbound message. Distinct from
  // sendTemplateMessage because it hits a different message `type` and
  // carries no template/category billing.
  async sendTextMessage(params: {
    phoneNumberId: string;
    accessToken: string;
    toE164: string;
    text: string;
  }): Promise<SendTemplateMessageResult> {
    return this.queue.enqueue(params.phoneNumberId, () => this.sendTextOnce(params));
  }

  private async sendTextOnce(params: {
    phoneNumberId: string;
    accessToken: string;
    toE164: string;
    text: string;
  }): Promise<SendTemplateMessageResult> {
    const url = `${GRAPH_BASE_URL}/${params.phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: params.toE164.replace("+", ""),
        type: "text",
        text: { body: params.text },
      }),
    });

    if (response.status === 429) throw new RateLimitError();

    const json = (await response.json()) as {
      messages?: { id: string }[];
      error?: { code: number; message: string };
    };

    if (!response.ok || json.error) {
      if (json.error?.code === 130429 || json.error?.code === 4) throw new RateLimitError(json.error.message);
      this.logger.warn(`WhatsApp text send failed: ${json.error?.message ?? response.statusText}`);
      throw new Error(json.error?.message ?? `WhatsApp send failed with status ${response.status}`);
    }

    const waMessageId = json.messages?.[0]?.id;
    if (!waMessageId) throw new Error("WhatsApp API returned no message id");
    return { waMessageId };
  }

  private async sendOnce(params: SendTemplateMessageParams): Promise<SendTemplateMessageResult> {
    const url = `${GRAPH_BASE_URL}/${params.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: params.toE164.replace("+", ""),
      type: "template",
      template: {
        name: params.templateName,
        language: { code: params.language },
        components:
          params.variables.length > 0
            ? [
                {
                  type: "body",
                  parameters: params.variables.map((v) => ({ type: "text", text: v })),
                },
              ]
            : undefined,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      throw new RateLimitError();
    }

    const json = (await response.json()) as {
      messages?: { id: string }[];
      error?: { code: number; error_subcode?: number; message: string };
    };

    if (!response.ok || json.error) {
      // Meta's rate-limit error surfaces as a 4xx with code 130429 too.
      if (json.error?.code === 130429 || json.error?.code === 4) {
        throw new RateLimitError(json.error.message);
      }
      this.logger.warn(`WhatsApp send failed: ${json.error?.message ?? response.statusText}`);
      throw new Error(json.error?.message ?? `WhatsApp send failed with status ${response.status}`);
    }

    const waMessageId = json.messages?.[0]?.id;
    if (!waMessageId) throw new Error("WhatsApp API returned no message id");
    return { waMessageId };
  }

  // Parses Meta's status-callback webhook payload into a normalized shape.
  // Handles the "message delivery" statuses; template category rejections
  // arrive on a separate `message_template_status_update` field.
  parseStatusWebhook(payload: unknown): WebhookEvent[] {
    const events: WebhookEvent[] = [];
    const entries = (payload as any)?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        for (const status of value.statuses ?? []) {
          events.push({
            type: "status",
            waMessageId: status.id,
            status: status.status, // sent | delivered | read | failed
            failedReason: status.errors?.[0]?.title,
          });
        }
        for (const message of value.messages ?? []) {
          events.push({
            type: "inbound_message",
            fromE164: `+${message.from}`,
            text: message.text?.body ?? "",
            waMessageId: message.id,
          });
        }
        if (change.field === "message_template_status_update") {
          events.push({
            type: "template_status",
            templateName: value.message_template_name,
            status: value.event, // APPROVED | REJECTED | ...
            rejectionReason: value.reason,
          });
        }
      }
    }
    return events;
  }
}

export type WebhookEvent =
  | { type: "status"; waMessageId: string; status: string; failedReason?: string }
  | { type: "inbound_message"; fromE164: string; text: string; waMessageId: string }
  | { type: "template_status"; templateName: string; status: string; rejectionReason?: string };
