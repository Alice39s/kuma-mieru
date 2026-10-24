'use client';

import { Footer } from '@/components/Footer';
import { I18NSwitch } from '@/components/basic/i18n-switch';
import { Button, Card, CardBody, CardFooter, CardHeader } from '@heroui/react';
import { FileQuestion, Home } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function NotFound() {
  const t = useTranslations('errorPage');

  return (
    <div className="relative flex min-h-screen flex-col">
      <main className="container mx-auto flex max-w-2xl grow items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
        <Card className="w-full shadow-medium">
          <CardHeader className="flex items-start justify-between gap-3 px-6 pb-0 pt-6">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10 text-warning">
                <FileQuestion size={24} />
              </div>
              <div className="flex flex-col">
                <h1 className="text-xl font-bold">{t('notFoundTitle')}</h1>
              </div>
            </div>
            <I18NSwitch />
          </CardHeader>
          <CardBody className="px-6 py-4">
            <p className="text-sm text-default-600">{t('notFoundMessage')}</p>
          </CardBody>
          <CardFooter className="px-6 pb-6 pt-2">
            <Button
              as={Link}
              href="/"
              color="primary"
              variant="flat"
              startContent={<Home size={18} />}
              className="w-full font-medium"
            >
              {t('backHome')}
            </Button>
          </CardFooter>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
