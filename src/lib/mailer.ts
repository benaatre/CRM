import "server-only";

import nodemailer from "nodemailer";

/** ينشئ ناقل SMTP من متغيّرات البيئة — يرجّع null لو الإعدادات ناقصة. */
function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // SSL على 465، STARTTLS غير ذلك
    auth: { user, pass },
  });
}

/** يرسل إيميل HTML — يرجّع خطأً واضحًا لو SMTP غير مضبوط أو فشل الإرسال. */
export async function sendMail(
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  const transport = getTransport();
  if (!transport) {
    return { ok: false, error: "إعدادات SMTP غير مضبوطة (SMTP_HOST / SMTP_USER / SMTP_PASS)" };
  }
  try {
    const from = process.env.SMTP_FROM || process.env.SMTP_USER!;
    await transport.sendMail({ from, to, subject, html });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
