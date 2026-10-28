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
  // Media id restituito da uploadMedia, per i template con header immagine.
  headerImageMediaId?: string;
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

  // Sottomette davvero il template a Meta per la review, invece di lasciarlo
  // solo come record locale in attesa. L'approvazione/rifiuto arriva comunque
  // in modo asincrono via webhook (webhook-ingest.service.ts) — questa
  // chiamata dice solo se la sottomissione è stata accettata per la coda di
  // revisione di Meta.
  async submitTemplate(params: {
    wabaId: string;
    accessToken: string;
    name: string;
    category: MessageCategory;
    language: string;
    bodyText: string;
    // Handle dell'immagine di esempio (da uploadTemplateExampleImage): Meta
    // lo richiede per valutare un template con header immagine.
    headerImageHandle?: string;
    // Template rifiutato già esistente su Meta: viene modificato e rimandato
    // in revisione con lo stesso id (Meta non permette di cambiarne il nome).
    existingMetaTemplateId?: string;
  }): Promise<{ metaTemplateId: string } | { error: string }> {
    const variableCount = new Set(
      Array.from(params.bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => Number(m[1])),
    ).size;

    const bodyComponent: Record<string, unknown> = { type: "BODY", text: params.bodyText };
    if (variableCount > 0) {
      // Meta richiede un esempio per ogni variabile per poter valutare il
      // template in revisione — senza, la sottomissione viene rifiutata.
      bodyComponent.example = { body_text: [Array.from({ length: variableCount }, (_, i) => `esempio${i + 1}`)] };
    }

    try {
      const components = params.headerImageHandle
        ? [{ type: "HEADER", format: "IMAGE", example: { header_handle: [params.headerImageHandle] } }, bodyComponent]
        : [bodyComponent];
      const editing = Boolean(params.existingMetaTemplateId);
      const response = await fetch(
        editing ? `${GRAPH_BASE_URL}/${params.existingMetaTemplateId}` : `${GRAPH_BASE_URL}/${params.wabaId}/message_templates`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${params.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(
            editing
              ? { category: params.category, components }
              : { name: params.name, category: params.category, language: params.language, components },
          ),
        },
      );

      const json = (await response.json()) as { id?: string; success?: boolean; error?: MetaError };
      if (!response.ok || json.error) return { error: describeMetaError(json.error, response.status) };
      if (editing && json.success) return { metaTemplateId: params.existingMetaTemplateId! };
      if (!json.id) return { error: `Risposta inattesa da Meta (HTTP ${response.status})` };
      return { metaTemplateId: json.id };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "errore di rete" };
    }
  }

  // Carica un'immagine sul numero WhatsApp e restituisce il media id da usare
  // nell'header dei messaggi: evita di dover esporre l'immagine su un URL
  // pubblico (Spokkio gira in locale). L'id resta valido circa 30 giorni.
  async uploadMedia(params: {
    phoneNumberId: string;
    accessToken: string;
    data: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", params.mimeType);
    form.append("file", new Blob([params.data], { type: params.mimeType }), params.filename);

    const response = await fetch(`${GRAPH_BASE_URL}/${params.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${params.accessToken}` },
      body: form,
    });
    const json = (await response.json()) as { id?: string; error?: { message: string } };
    if (!response.ok || json.error || !json.id) {
      throw new Error(json.error?.message ?? `Upload immagine fallito (HTTP ${response.status})`);
    }
    return json.id;
  }

  // L'immagine di esempio di un template va caricata con la Resumable Upload
  // API, che è legata all'app Meta (non al numero): l'id dell'app si ricava
  // dal token stesso, così non serve chiederlo all'utente.
  async uploadTemplateExampleImage(params: {
    accessToken: string;
    data: Buffer;
    mimeType: string;
  }): Promise<{ handle: string } | { error: string }> {
    try {
      const token = encodeURIComponent(params.accessToken);
      const debug = await fetch(`${GRAPH_BASE_URL}/debug_token?input_token=${token}&access_token=${token}`);
      const debugJson = (await debug.json()) as { data?: { app_id?: string }; error?: { message: string } };
      const appId = debugJson.data?.app_id;
      if (!appId) return { error: debugJson.error?.message ?? "Impossibile ricavare l'app Meta dal token" };

      const session = await fetch(
        `${GRAPH_BASE_URL}/${appId}/uploads?file_length=${params.data.length}&file_type=${encodeURIComponent(params.mimeType)}&access_token=${token}`,
        { method: "POST" },
      );
      const sessionJson = (await session.json()) as { id?: string; error?: { message: string } };
      if (!sessionJson.id) return { error: sessionJson.error?.message ?? "Apertura upload fallita" };

      const upload = await fetch(`${GRAPH_BASE_URL}/${sessionJson.id}`, {
        method: "POST",
        headers: { Authorization: `OAuth ${params.accessToken}`, file_offset: "0" },
        body: params.data,
      });
      const uploadJson = (await upload.json()) as { h?: string; error?: { message: string } };
      if (!uploadJson.h) return { error: uploadJson.error?.message ?? "Upload immagine di esempio fallito" };
      return { handle: uploadJson.h };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "errore di rete" };
    }
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

  // Iscrive il WABA all'app del token: senza questo passo
  // Meta non manda al webhook stati e risposte del numero reale.
  async ensureWebhookSubscription(params: {
    wabaId: string;
    accessToken: string;
  }): Promise<{ subscribed: boolean | null; error?: string }> {
    const url = `${GRAPH_BASE_URL}/${params.wabaId}/subscribed_apps`;
    const headers = { Authorization: `Bearer ${params.accessToken}` };
    try {
      // POST è idempotente: rifarlo su un WABA già iscritto risponde success.
      const created = (await (await fetch(url, { method: "POST", headers })).json()) as {
        success?: boolean;
        error?: { message: string };
      };
      if (created.success) return { subscribed: true };
      return { subscribed: false, error: created.error?.message ?? "Iscrizione al webhook non riuscita" };
    } catch (err) {
      return { subscribed: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Elimina un template anche su Meta, così non resta in WhatsApp Manager.
  // Best effort: un errore qui non blocca l'eliminazione in Spokkio.
  async deleteTemplate(params: { wabaId: string; accessToken: string; name: string; metaTemplateId: string }) {
    try {
      const url = `${GRAPH_BASE_URL}/${params.wabaId}/message_templates?hsm_id=${params.metaTemplateId}&name=${encodeURIComponent(params.name)}`;
      const response = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${params.accessToken}` } });
      const json = (await response.json()) as { success?: boolean; error?: MetaError };
      return json.success ? { ok: true as const } : { error: describeMetaError(json.error, response.status) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "errore di rete" };
    }
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
        components: buildSendComponents(params),
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

  // Verifica che le credenziali salvate funzionino davvero, interrogando il
  // numero su Meta. Serve soprattutto per i token temporanei da 24 ore, che
  // scadono in silenzio: senza questo controllo l'utente scoprirebbe il
  // problema solo quando una campagna fallisce.
  async getTemplateStatus(params: {
    metaTemplateId: string;
    accessToken: string;
  }): Promise<{ status: string; rejectedReason: string | null } | { error: string }> {
    try {
      const response = await fetch(`${GRAPH_BASE_URL}/${params.metaTemplateId}?fields=status,rejected_reason`, {
        headers: { Authorization: `Bearer ${params.accessToken}` },
      });
      const json = (await response.json()) as {
        status?: string;
        rejected_reason?: string;
        error?: { message: string };
      };
      if (!response.ok || json.error || !json.status) return { error: json.error?.message ?? `HTTP ${response.status}` };
      const reason = json.rejected_reason && json.rejected_reason !== "NONE" ? json.rejected_reason : null;
      return { status: json.status, rejectedReason: reason };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "errore di rete" };
    }
  }

  async verifyCredentials(params: {
    phoneNumberId: string;
    accessToken: string;
  }): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await fetch(`${GRAPH_BASE_URL}/${params.phoneNumberId}`, {
        headers: { Authorization: `Bearer ${params.accessToken}` },
      });
      const json = (await response.json()) as { error?: { message: string } };
      if (!response.ok || json.error) {
        return { valid: false, error: json.error?.message ?? `HTTP ${response.status}` };
      }
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "errore di rete" };
    }
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

interface MetaError {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
}

// Il campo "message" di Meta è spesso generico ("Invalid parameter"): la
// spiegazione vera sta in error_user_title / error_user_msg.
function describeMetaError(error: MetaError | undefined, status: number): string {
  if (!error) return `HTTP ${status}`;
  const parts = [error.error_user_title, error.error_user_msg].filter(Boolean);
  const detail = parts.length ? parts.join(": ") : error.message ?? `HTTP ${status}`;
  const code = error.error_subcode ?? error.code;
  return code ? `${detail} (codice Meta ${code})` : detail;
}

function buildSendComponents(params: SendTemplateMessageParams) {
  const components: Record<string, unknown>[] = [];
  if (params.headerImageMediaId) {
    components.push({ type: "header", parameters: [{ type: "image", image: { id: params.headerImageMediaId } }] });
  }
  if (params.variables.length > 0) {
    components.push({ type: "body", parameters: params.variables.map((v) => ({ type: "text", text: v })) });
  }
  return components.length > 0 ? components : undefined;
}

export type WebhookEvent =
  | { type: "status"; waMessageId: string; status: string; failedReason?: string }
  | { type: "inbound_message"; fromE164: string; text: string; waMessageId: string }
  | { type: "template_status"; templateName: string; status: string; rejectionReason?: string };
