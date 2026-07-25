import { createTransport } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool/index.js';
import type { EmailDeliveryTransport } from './transport.js';

export interface SmtpTransportConfig {
  host: string;
  port: number;
  tls: 'implicit' | 'starttls';
  username?: string;
  password?: string;
  from: { address: string; name?: string };
  replyTo?: string;
}

export const createSmtpTransport = (config: SmtpTransportConfig): EmailDeliveryTransport => {
  const secure = config.tls === 'implicit';
  const options: SMTPPool.Options = {
    host: config.host,
    port: config.port,
    secure,
    requireTLS: config.tls === 'starttls',
    pool: true,
    maxConnections: 2,
    maxMessages: 100,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    auth:
      config.username && config.password
        ? { user: config.username, pass: config.password }
        : undefined,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  };
  const transporter = createTransport(options);
  return {
    verify: async () => {
      await transporter.verify();
    },
    send: async message => {
      const result = await transporter.sendMail({
        ...message,
        from: config.from.name
          ? { address: config.from.address, name: config.from.name }
          : config.from.address,
        replyTo: config.replyTo,
      });
      return { messageId: result.messageId };
    },
    close: () => transporter.close(),
  };
};
