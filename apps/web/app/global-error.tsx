'use client';

import { parseErrorDetails } from '@/app/lib/error-details';
import { Footer } from '@/components/Footer';
import { ErrorStackTrace } from '@/components/error/ErrorStackTrace';
import enUS from '@/messages/en-US.json';
import { defaultLocale, locales, type Locale } from '@/utils/i18n/config';
import { resolveLocaleFromCandidates } from '@/utils/i18n/resolve-locale';
import {
  Button,
  Dropdown as HeroUIDropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from '@heroui/react';
import {
  FlagBr,
  FlagCn,
  FlagFr,
  FlagHk,
  FlagJp,
  FlagKr,
  FlagRu,
  FlagTw,
  FlagUs,
} from '@sankyu/react-circle-flags';
import { AlertTriangle, Languages, RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';

const flagComponents: Record<string, React.ComponentType<{ width?: number; height?: number }>> = {
  BR: FlagBr,
  CN: FlagCn,
  TW: FlagTw,
  HK: FlagHk,
  US: FlagUs,
  JP: FlagJp,
  KR: FlagKr,
  RU: FlagRu,
  FR: FlagFr,
};

interface GlobalErrorLanguageSwitchProps {
  currentLocale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

const GlobalErrorLanguageSwitch = ({
  currentLocale,
  onLocaleChange,
}: GlobalErrorLanguageSwitchProps) => {
  const currentLocaleName = useMemo(
    () => locales.find(item => item.key === currentLocale)?.name ?? currentLocale,
    [currentLocale]
  );

  return (
    <HeroUIDropdown aria-label="Switch Language">
      <DropdownTrigger>
        <Button
          variant="light"
          isIconOnly
          className="text-default-500"
          aria-label={currentLocaleName}
        >
          <Languages size={22} />
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label="Switch Language" variant="faded">
        {locales.map(item => {
          const FlagComponent = flagComponents[item.alpha2Code];
          return (
            <DropdownItem
              key={item.key}
              onPress={() => onLocaleChange(item.key)}
              className="flex flex-row items-center gap-2 text-default-500"
              startContent={FlagComponent ? <FlagComponent width={24} height={24} /> : null}
            >
              {item.name}
            </DropdownItem>
          );
        })}
      </DropdownMenu>
    </HeroUIDropdown>
  );
};

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const [isRetrying, startRetryTransition] = useTransition();
  const [lang, setLang] = useState<Locale>(defaultLocale);
  const [messages, setMessages] = useState(enUS);

  useEffect(() => {
    console.error(error);
  }, [error]);

  const parsed = parseErrorDetails(error.message ?? 'Unknown error');
  const isDevDetailsMode =
    process.env.NEXT_PUBLIC_ERROR_PAGE_DEV_MODE === 'true' ||
    process.env.NODE_ENV === 'development';

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

  const errorText = useMemo(
    () =>
      `Title: ${resolvedTitle}\nDiagnostics: ${parsed.diagnostics}\nStatus: ${resolvedHttpStatus}\n\nStack:\n${error.stack || 'N/A'}`,
    [resolvedTitle, parsed.diagnostics, resolvedHttpStatus, error.stack]
  );

  return (
    <html lang={lang}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <div className="relative flex min-h-screen flex-col">
          <main className="container mx-auto flex max-w-2xl grow items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
            <div className="w-full rounded-2xl border border-danger/30 bg-danger/10 p-6 shadow-medium">
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
                    <AlertTriangle size={24} />
                  </div>
                  <div className="flex flex-col">
                    <h1 className="text-xl font-bold text-danger">{resolvedTitle}</h1>
                    <p className="mt-1 text-sm text-default-600">{t.globalMessage}</p>
                  </div>
                </div>
                <GlobalErrorLanguageSwitch currentLocale={lang} onLocaleChange={setLang} />
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
                  <ErrorStackTrace stack={error.stack} errorText={errorText} />
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
