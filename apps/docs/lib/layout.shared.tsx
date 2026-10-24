import { zhCN } from '@fumadocs/language/zh-cn';
import { uiTranslations } from 'fumadocs-ui/i18n';
import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { i18n, type Locale } from './i18n';

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .preset('zh', zhCN())
  .add({ zh: { displayName: '简体中文' }, en: { displayName: 'English' } });

/** Words the site chrome needs beyond Fumadocs' own translations. */
export const siteText = {
  zh: {
    byline: '文档',
    home: 'Kuma Mieru 文档首页',
    repository: 'GitHub 仓库：Alice39s/kuma-mieru',
    star: '在 GitHub 上 Star',
    switchLanguage: 'Switch to English',
    theme: '主题',
    themeCurrent: '切换主题，当前：{theme}',
    themeLight: '浅色',
    themeDark: '深色',
    themeSystem: '跟随系统',
    pages: '目录',
    notFoundTitle: '页面不存在',
    notFoundBody: '链接可能已经失效，或者这一页换了位置。',
    backToDocs: '返回文档首页',
    chooseLanguage: '选择文档语言',
  },
  en: {
    byline: 'Docs',
    home: 'Kuma Mieru docs home',
    repository: 'GitHub repository: Alice39s/kuma-mieru',
    star: 'Star on GitHub',
    switchLanguage: '切换到中文',
    theme: 'Theme',
    themeCurrent: 'Change theme, current: {theme}',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    pages: 'Pages',
    notFoundTitle: 'Page not found',
    notFoundBody: 'The link may be outdated, or the page has moved.',
    backToDocs: 'Back to the docs',
    chooseLanguage: 'Choose a language',
  },
} satisfies Record<Locale, Record<string, string>>;

/**
 * The site header carries the brand, the language and theme controls and the repository link, so the sidebar keeps
 * only search and the page tree.
 */
export const layoutOptions: BaseLayoutProps = {
  nav: { enabled: false },
  i18n: false,
  themeSwitch: { enabled: false },
};
