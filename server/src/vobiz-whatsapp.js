import { config } from "./config.js";
import { fail } from "./validations.js";

export function toE164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0"))
    return `+91${digits.slice(1)}`;
  if (String(phone || "").startsWith("+") && digits.length >= 10)
    return `+${digits}`;
  return "";
}

export function vobizConfigured() {
  const { authId, authToken, channelId, wabaId } = config.vobiz;
  return Boolean(authId && authToken && channelId && wabaId);
}

export async function sendInvoiceWhatsApp({ to, name, shop, invoiceNumber, amount, token }) {
  if (!vobizConfigured())
    throw fail("WhatsApp is not configured on this server", 503);
  const response = await fetch("https://api.vobiz.ai/api/v1/messaging/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-ID": config.vobiz.authId,
      "X-Auth-Token": config.vobiz.authToken,
    },
    body: JSON.stringify({
      channel_id: config.vobiz.channelId,
      waba_id: config.vobiz.wabaId,
      to,
      type: "template",
      template: {
        name: config.vobiz.template,
        language: { code: config.vobiz.language },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: name },
              { type: "text", text: shop },
              { type: "text", text: invoiceNumber },
              { type: "text", text: amount },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: 0,
            parameters: [{ type: "text", text: token }],
          },
        ],
      },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw fail(
      data.message || data.error || "WhatsApp could not send this invoice",
      response.status >= 400 && response.status < 500 ? 400 : 502,
    );
  return data;
}
