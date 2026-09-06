import nodemailer from 'nodemailer';

export function createSmtpTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 465);
  const secure =
    process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === 'true'
      : port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM;

  if (!host || !port || !user || !pass || !from) {
    // 本地开发未配置邮件服务时返回 null，由调用方降级为“跳过发送”，
    // 避免注册/找回密码等流程因缺少 SMTP 配置而直接崩溃。
    return null;
  }

  return {
    transporter: nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    }),
    from,
  };
}

export async function sendViaSmtp(
  email: string,
  subject: string,
  content: string,
) {
  const built = createSmtpTransporter();

  if (!built) {
    console.warn('[smtp] 未配置邮件服务，已跳过邮件发送', {
      to: email,
      subject,
    });
    return;
  }

  const { transporter, from } = built;
  const html = content
    .split('\n')
    .map((line) => line.trim())
    .join('<br />');

  await transporter.sendMail({
    from,
    to: email,
    subject,
    text: content,
    html,
  });
}
