'use client';

import Script from 'next/script';
import { maxLength, pipe, regex, safeParse, string, trim } from 'valibot';

const analyticsIdSchema = pipe(
  string(),
  trim(),
  maxLength(32),
  regex(/^(G-[A-Z0-9]+|UA-\d+-\d+|AW-\d+|DC-\d+)$/i, 'Invalid Google Analytics ID format')
);

interface AnalyticsProps {
  id: string;
}

export default function Analytics({ id }: AnalyticsProps) {
  if (!id) return null;
  const parsedId = safeParse(analyticsIdSchema, id);

  if (!parsedId.success) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Skip Google Analytics injection due to invalid ID format');
    }
    return null;
  }

  const safeId = parsedId.output;

  return (
    <>
      <Script
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(safeId)}`}
      />
      <Script
        id="google-analytics"
        strategy="afterInteractive"
        // oxlint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', ${JSON.stringify(safeId)});
          `,
        }}
      />
    </>
  );
}
