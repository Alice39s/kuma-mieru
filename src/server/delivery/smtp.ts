import nodemailer from 'nodemailer';
import type { EmailDeliveryTransport } from './transport.js';

export interface SmtpTransportConfig {
  host: string;
  port: number;
  secure?: boolean;
  username?: string;
  password?: string;
  from: string;
  replyTo?: string;
}

export const createSmtpTransport = (config: SmtpTransportConfig): EmailDeliveryTransport => {
  const secure = config.secure ?? config.port === 465;
  const transporter = nodemailer.createTransport(
    {
      host: config.host,
      port: config.port,
      secure,
      requireTLS: !secure,
      auth:
        config.username && config.password
          ? { user: config.username, pass: config.password }
          : undefined,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    },
    { from: config.from, replyTo: config.replyTo }
  );
  return {
    verify: async () => {
      await transporter.verify();
    },
    send: async message => {
      const result = await transporter.sendMail(message);
      return { messageId: result.messageId };
    },
    close: () => transporter.close(),
  };
};
