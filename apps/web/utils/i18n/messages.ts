import type enUS from '../../messages/en-US.json';
import type { Locale } from './config';

export type Messages = typeof enUS;

const messageLoaders: Record<Locale, () => Promise<{ default: Messages }>> = {
  'zh-CN': () => import('../../messages/zh-CN.json'),
  'zh-TW': () => import('../../messages/zh-TW.json'),
  'zh-HK': () => import('../../messages/zh-HK.json'),
  'en-US': () => import('../../messages/en-US.json'),
  'ja-JP': () => import('../../messages/ja-JP.json'),
  'ko-KR': () => import('../../messages/ko-KR.json'),
  'ru-RU': () => import('../../messages/ru-RU.json'),
  'fr-FR': () => import('../../messages/fr-FR.json'),
  'pt-BR': () => import('../../messages/pt-BR.json'),
};

export function hasMessages(locale: string): locale is Locale {
  return Object.hasOwn(messageLoaders, locale);
}

export async function loadMessages(locale: Locale): Promise<Messages> {
  const messagesModule = await messageLoaders[locale]();
  return messagesModule.default;
}
