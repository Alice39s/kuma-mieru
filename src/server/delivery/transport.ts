export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  messageId: string;
  headers?: Record<string, string>;
}

export interface EmailDeliveryTransport {
  verify(): Promise<void>;
  send(message: EmailMessage): Promise<{ messageId: string }>;
  close(): void;
}
