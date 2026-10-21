import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { db } from "./db";
import { SITE } from "./config";
import { logger } from "./logger";

export type DeliveryStatus = "sent" | "skipped_unconfigured" | "failed";

function smtpConfigured() {
  return !!process.env.SMTP_HOST && !!process.env.SMTP_USER;
}

function telegramConfigured() {
  return !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
}

let warnedUnconfigured = false;

function warnUnconfiguredOnce() {
  if (warnedUnconfigured) return;
  warnedUnconfigured = true;
  logger.warn("notify_channels_unconfigured", {
    smtp: smtpConfigured(),
    telegram: telegramConfigured(),
    hint: "Set SMTP_* and TELEGRAM_* env vars — otherwise users never receive emails/admin alerts",
  });
}

let transporter: Transporter | null = null;

function getTransporter() {
  if (!smtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<DeliveryStatus> {
  const t = getTransporter();
  if (!t) {
    warnUnconfiguredOnce();
    logger.warn("email_skipped_unconfigured", { subject });
    return "skipped_unconfigured";
  }
  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || `"${SITE.name}" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    logger.info("email_sent", { subject });
    return "sent";
  } catch (e) {
    // Never claim delivery on failure — surface it operationally.
    logger.error("email_failed", { subject, error: (e as Error).message });
    return "failed";
  }
}

export async function sendTelegram(text: string): Promise<DeliveryStatus> {
  if (!telegramConfigured()) {
    warnUnconfiguredOnce();
    logger.warn("telegram_skipped_unconfigured", {});
    return "skipped_unconfigured";
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: "HTML",
        }),
      }
    );
    if (!res.ok) {
      logger.error("telegram_failed", { status: res.status });
      return "failed";
    }
    return "sent";
  } catch (e) {
    logger.error("telegram_failed", { error: (e as Error).message });
    return "failed";
  }
}

function emailLayout(title: string, body: string, ctaText?: string, ctaUrl?: string) {
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:12px">
    <h1 style="color:#34d399;font-size:20px;margin:0 0 16px">${SITE.name}</h1>
    <h2 style="font-size:18px;margin:0 0 12px;color:#fff">${title}</h2>
    <p style="line-height:1.6;color:#cbd5e1">${body}</p>
    ${ctaUrl ? `<p style="margin:24px 0"><a href="${ctaUrl}" style="background:#10b981;color:#020617;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${ctaText || "Open Dashboard"}</a></p>` : ""}
    <p style="margin-top:32px;font-size:12px;color:#64748b">${SITE.supportEmail} • Telegram ${SITE.telegram}</p>
  </div>`;
}

export type NotifyOpts = {
  userId?: string;
  type?: "INFO" | "BREACH" | "PAYOUT" | "PAYMENT" | "SYSTEM";
  title?: string;
  body?: string;
  emailSubject?: string;
  emailBody?: string;
  adminAlert?: string;
};

export async function notify(opts: NotifyOpts) {
  const jobs: Promise<unknown>[] = [];

  if (opts.userId && opts.title && opts.body) {
    jobs.push(
      db.notification.create({
        data: {
          userId: opts.userId,
          type: opts.type || "INFO",
          title: opts.title,
          body: opts.body,
        },
      })
    );

    if (opts.emailSubject) {
      const user = await db.user.findUnique({
        where: { id: opts.userId },
        select: { email: true },
      });
      if (user) {
        jobs.push(
          sendEmail(
            user.email,
            opts.emailSubject,
            emailLayout(
              opts.emailSubject,
              opts.emailBody || opts.body,
              "Open Dashboard",
              `${process.env.SITE_URL || ""}/dashboard`
            )
          )
        );
      }
    }
  }

  if (opts.adminAlert) {
    jobs.push(sendTelegram(opts.adminAlert));
  }

  await Promise.allSettled(jobs);
}
