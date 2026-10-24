'use client';
import { parseErrorDetails } from '@/app/lib/error-details';
import { Footer } from '@/components/Footer';
import { I18NSwitch } from '@/components/basic/i18n-switch';
import { ErrorStackTrace } from '@/components/error/ErrorStackTrace';
import { Button, Card, CardBody, CardFooter, CardHeader, Divider } from '@heroui/react';
import { AlertTriangle, Home, RotateCw, Server } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useTransition } from 'react';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const t = useTranslations('errorPage');
  const router = useRouter();
  const [isRetrying, startRetryTransition] = useTransition();

  useEffect(() => {
    console.error('[ErrorBoundary]', error, error?.digest ? `(digest: ${error.digest})` : '');
  }, [error]);

  const message = error?.message ?? 'Unknown error';
  const parsed = useMemo(() => parseErrorDetails(message), [message]);

  const resolvedTitle =
    parsed.kind === 'current_unavailable' ? t('currentUnavailableTitle') : t('title');

  const resolvedHttpStatus = useMemo(() => {
    if (parsed.statusCode !== undefined) {
      return `${parsed.statusCode} ${parsed.statusMessage ?? ''}`.trim();
    }
    if (parsed.statusMessage && parsed.statusMessage.length > 0) {
      return `${parsed.statusMessage}`.trim();
    }
    return t('httpStatusUnavailable');
  }, [parsed.statusCode, parsed.statusMessage, t]);

  const handleRetry = () => {
    startRetryTransition(() => {
      reset();
      router.refresh();
    });
  };

  const stack = error?.stack;
  const errorText = useMemo(
    () =>
      `Title: ${resolvedTitle}\nDiagnostics: ${parsed.diagnostics}\nStatus: ${resolvedHttpStatus}\n\nStack:\n${stack || 'N/A'}`,
    [resolvedTitle, parsed.diagnostics, resolvedHttpStatus, stack]
  );

  return (
    <div className="relative flex min-h-screen flex-col">
      <main
        role="alert"
        className="container mx-auto flex max-w-2xl grow items-center justify-center px-4 py-12 sm:px-6 sm:py-16"
      >
        <Card className="w-full border-danger/20 bg-danger/15 shadow-medium">
          <CardHeader className="flex items-start justify-between gap-3 px-6 pb-0 pt-6">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger">
                <AlertTriangle size={24} aria-hidden="true" />
              </div>
              <div className="flex min-w-0 flex-col">
                <h1 className="text-xl font-bold text-danger">{resolvedTitle}</h1>
                <p className="text-small text-default-500">{t('diagnostics')}</p>
              </div>
            </div>
            <I18NSwitch />
          </CardHeader>

          <CardBody className="px-6 py-4">
            <p className="wrap-break-word text-sm font-medium text-default-700">
              {parsed.diagnostics}
            </p>

            <div className="mt-4 flex items-center gap-3 rounded-lg border border-danger/10 bg-danger/5 p-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-danger/10 text-danger/80">
                <Server size={16} aria-hidden="true" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold uppercase tracking-wider text-default-500">
                  {t('httpStatus')}
                </span>
                <span className="font-mono text-sm font-medium text-default-700">
                  {resolvedHttpStatus}
                </span>
              </div>
            </div>

            {stack ? <ErrorStackTrace stack={stack} errorText={errorText} /> : null}
          </CardBody>

          <Divider className="my-1 bg-danger/15" />

          <CardFooter className="flex justify-end gap-3 px-6 py-4">
            <Button
              as={Link}
              href="/"
              variant="light"
              color="default"
              startContent={<Home size={18} aria-hidden="true" />}
            >
              {t('backHome')}
            </Button>
            <Button
              onPress={handleRetry}
              color="danger"
              variant="flat"
              startContent={isRetrying ? null : <RotateCw size={18} aria-hidden="true" />}
              className="font-medium"
              isLoading={isRetrying}
            >
              {isRetrying ? t('retrying') : t('retry')}
            </Button>
          </CardFooter>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
