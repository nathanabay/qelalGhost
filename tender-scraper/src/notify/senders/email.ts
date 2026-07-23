// SMTP email sender (nodemailer). A transport is built per call from current
// settings so an admin-page SMTP change takes effect immediately.
import nodemailer from "nodemailer";
import type { Config } from "../config";

export async function sendEmail(cfg: Config, to: string, subject: string, html: string, text: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: cfg.email.host,
    port: cfg.email.port,
    secure: cfg.email.secure,
    auth: cfg.email.user ? { user: cfg.email.user, pass: cfg.email.pass } : undefined,
  });
  await transport.sendMail({ from: cfg.email.from, to, subject, html, text });
}

export async function verifyEmail(cfg: Config): Promise<{ ok: boolean; error?: string }> {
  try {
    const transport = nodemailer.createTransport({
      host: cfg.email.host, port: cfg.email.port, secure: cfg.email.secure,
      auth: cfg.email.user ? { user: cfg.email.user, pass: cfg.email.pass } : undefined,
    });
    await transport.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e).slice(0, 160) };
  }
}
