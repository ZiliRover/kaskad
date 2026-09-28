import nodemailer from "nodemailer";
import { BRAND } from "@/config/brand";

/** Real mail needs SMTP_URL (smtps://user:pass@host:465). Without it, dev prints codes to the console. */
export const mailConfigured = () => !!process.env.SMTP_URL?.trim();

const g = globalThis as unknown as { __mail?: nodemailer.Transporter };

function transport() {
  g.__mail ??= nodemailer.createTransport(process.env.SMTP_URL!.trim());
  return g.__mail;
}

export async function sendLoginCode(email: string, code: string) {
  const subject = `${code} — код входа в ${BRAND.name}`;
  const text = `Код для входа в ${BRAND.name}: ${code}\n\nОн действует 10 минут. Если вы не запрашивали код, просто проигнорируйте письмо.`;
  if (!mailConfigured()) {
    console.log(`[mail] ${email}: ${subject}`);
    return;
  }
  await transport().sendMail({
    from: process.env.MAIL_FROM?.trim() || `${BRAND.name} <no-reply@localhost>`,
    to: email,
    subject,
    text,
  });
}
