'use client';

import { parseErrorDetails, shouldShowErrorPageDevDetails } from '@/app/lib/error-details';
import { Footer } from '@/components/Footer';
import enUS from '@/messages/en-US.json';
import { defaultLocale, type Locale } from '@/utils/i18n/config';
import { resolveLocaleFromCandidates } from '@/utils/i18n/resolve-locale';
import { Button, Code } from '@heroui/react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const [isRetrying, startRetryTransition] = useTransition();
  const [lang, setLang] = useState<Locale>(defaultLocale);
  const [messages, setMessages] = useState(enUS);

  useEffect(() => {
    console.error(error);
  }, [error]);

  const parsed = parseErrorDetails(error.message ?? 'Unknown error');
  const isDevDetailsMode = shouldShowErrorPageDevDetails({
    publicDevMode: process.env.NEXT_PUBLIC_ERROR_PAGE_DEV_MODE,
    nodeEnv: process.env.NODE_ENV,
  });

  useEffect(() => {
    const candidates =
      typeof navigator !== 'undefined'
        ? navigator.languages && navigator.languages.length > 0
          ? navigator.languages
          : [navigator.language]
        : [];

    setLang(resolveLocaleFromCandidates(candidates));
  }, []);

  useEffect(() => {
    let isMounted = true;

    void import(`../messages/${lang}.json`)
      .then(module => {
        if (isMounted) {
          setMessages(module.default as typeof enUS);
        }
      })
      .catch(() => {
        if (isMounted) {
          setMessages(enUS);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [lang]);

  const t = useMemo(() => messages.errorPage, [messages]);
  const resolvedTitle = parsed.kind === 'all_unavailable' ? t.globalTitle : t.title;
  const resolvedHttpStatus =
    parsed.statusCode !== undefined
      ? `${parsed.statusCode} ${parsed.statusMessage ?? ''}`.trim()
      : parsed.statusMessage && parsed.statusMessage.length > 0
        ? `${t.httpStatusUnavailable} (${parsed.statusMessage})`
        : t.httpStatusUnavailable;

  const handleRetry = () => {
    startRetryTransition(() => {
      reset();
      router.refresh();
    });
  };

  return (
    <html lang={lang}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <div className="relative flex min-h-screen flex-col">
          <main className="container mx-auto flex max-w-lg grow items-center justify-center px-6 py-16">
            <div className="w-full rounded-2xl border border-danger/30 bg-danger/10 p-6 shadow-medium">
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
                  <AlertTriangle size={24} />
                </div>
                <div className="flex flex-col">
                  <h1 className="text-xl font-bold text-danger">{resolvedTitle}</h1>
                  <p className="mt-1 text-sm text-default-600">{t.globalMessage}</p>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div className="rounded-lg bg-background/50 p-3">
                  <p className="text-xs font-semibold uppercase text-default-500">
                    {t.diagnostics}
                  </p>
                  <p className="mt-1 text-sm text-default-700">{parsed.diagnostics}</p>
                </div>

                <div className="rounded-lg bg-background/50 p-3">
                  <p className="text-xs font-semibold uppercase text-default-500">{t.httpStatus}</p>
                  <p className="mt-1 text-sm font-mono text-default-700">{resolvedHttpStatus}</p>
                </div>

                {isDevDetailsMode && error.stack ? (
                  <Code className="block max-h-60 overflow-auto whitespace-pre-wrap bg-background/50 p-2 text-xs">
                    {error.stack}
                  </Code>
                ) : null}
              </div>

              <div className="mt-6 flex justify-end">
                <Button
                  onPress={handleRetry}
                  color="danger"
                  variant="flat"
                  startContent={<RotateCw size={18} />}
                  className="font-medium"
                  isLoading={isRetrying}
                >
                  {isRetrying ? t.retrying : t.retry}
                </Button>
              </div>
            </div>
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
