import { createIntegerStringSchema } from './number-schema';

export interface HttpStatusDetails {
  statusCode: number;
  statusMessage?: string;
}

const httpStatusCodeSchema = createIntegerStringSchema({ min: 100, max: 599 });
const directHttpStatusDetailsPattern = /\b([1-5]\d\d)\s+([A-Za-z][A-Za-z\s-]{1,})\b/;
const httpStatusCodeTokenPattern = /\b([1-5]\d\d)\b/;

export function parseHttpStatusCode(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = httpStatusCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function extractHttpStatusCodeFromMessage(message: string): number | undefined {
  const match = message.match(httpStatusCodeTokenPattern);
  return parseHttpStatusCode(match?.[1]);
}

export function extractHttpStatusDetailsFromMessage(
  message: string
): HttpStatusDetails | undefined {
  const directMatch = message.match(directHttpStatusDetailsPattern);
  const statusCode = parseHttpStatusCode(directMatch?.[1]);

  if (statusCode === undefined) {
    return undefined;
  }

  const statusMessage = directMatch?.[2]?.trim();

  return {
    statusCode,
    statusMessage: statusMessage && statusMessage.length > 0 ? statusMessage : undefined,
  };
}
