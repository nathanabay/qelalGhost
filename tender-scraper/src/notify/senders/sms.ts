// SMS sender — STUB. Wire an Ethiopian gateway (e.g. AfroMessage) here later.
// The delivery registry already iterates this channel; implementing send() +
// enabling the channel setting is all that's needed to go live.
import type { Config } from "../config";

export async function sendSms(_cfg: Config, _to: string, _text: string): Promise<void> {
  throw new Error("SMS channel not configured yet");
}
