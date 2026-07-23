// WhatsApp sender — STUB. Wire Meta WhatsApp Cloud API (or Twilio) here later.
// Requires an approved message template; the delivery registry already iterates
// this channel so only send() + the channel setting need finishing.
import type { Config } from "../config";

export async function sendWhatsapp(_cfg: Config, _to: string, _text: string): Promise<void> {
  throw new Error("WhatsApp channel not configured yet");
}
