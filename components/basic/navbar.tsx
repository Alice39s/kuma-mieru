'use client';

import {
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Kbd,
  Link,
} from '@heroui/react';
import {
  Navbar as HeroUINavbar,
  NavbarBrand,
  NavbarContent,
  NavbarMenu,
  NavbarMenuToggle,
} from '@heroui/react';
import { link as linkStyles } from '@heroui/theme';
import clsx from 'clsx';
import Image from 'next/image';
import NextLink from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

import { GithubIcon, SearchIcon } from '@/components/basic/icons';
import { ThemeSwitch } from '@/components/basic/theme-switch';
import { NavbarSkeleton } from '@/components/ui/CommonSkeleton';
import { apiConfig } from '@/config/api';
import { siteConfig } from '@/config/site';
import { motion } from 'framer-motion';
import { ChevronDown, Globe, Menu, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useNodeSearch } from '../context/NodeSearchContext';
import { I18NSwitch } from './i18n-switch';

const isExternalUrl = (url: string) => {
  return url?.startsWith('http://') || url?.startsWith('https://');
};

export const Navbar = () => {
  const t = useTranslations();
  const { inputValue, setInputValue, clearSearch, isFiltering } = useNodeSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  // 获取当前页面ID和路由相关
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const currentPageId = (params?.pageId as string) || apiConfig.defaultPageId;

  // shortcut key (Command+K or Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!apiConfig) {
    return <NavbarSkeleton />;
  }

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setInputValue(e.target.value);
    },
    [setInputValue],
  );

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLInputElement>) => {
      setInputValue((e.target as HTMLInputElement).value);
    },
    [setInputValue],
  );

  const handleClearSearch = useCallback(() => {
    clearSearch();
    inputRef.current?.focus();
  }, [clearSearch]);

  // 处理页面切换
  const handlePageChange = (pageId: string) => {
    router.push(`/${pageId}`);
  };

  const searchInput = (
    <div className="relative">
      <Input
        aria-label={t('navbar.search')}
        classNames={{
          inputWrapper: 'bg-default-100',
          input: 'text-sm',
        }}
        endContent={
          !isFiltering && (
            <Kbd className="hidden lg:inline-block" keys={['command']}>
              K
            </Kbd>
          )
        }
        ref={inputRef}
        value={inputValue}
        onChange={handleSearchChange}
        onCompositionEnd={handleCompositionEnd}
        isClearable={isFiltering}
        onClear={handleClearSearch}
        labelPlacement="outside"
        placeholder={t('node.search')}
        startContent={
          <SearchIcon className="text-base text-default-400 pointer-events-none flex-shrink-0" />
        }
        type="search"
      />
    </div>
  );

  const starButton = (
    <Button
      isExternal
      as={Link}
      className="text-sm font-normal text-default-600 bg-default-100"
      href={siteConfig.links.github}
      startContent={<GithubIcon />}
      variant="flat"
    >
      Star on Github
    </Button>
  );

  const getIconUrl = () => {
    if (apiConfig.siteMeta.icon) {
      return isExternalUrl(apiConfig.siteMeta.icon)
        ? apiConfig.siteMeta.icon
        : new URL(apiConfig.siteMeta.icon, apiConfig.baseUrl).toString();
    }
    return '';
  };

  // 状态页切换下拉菜单
  const pageDropdown = apiConfig.pages.length > 1 && (
    <Dropdown>
      <DropdownTrigger>
        <Button
          variant="light"
          className="font-normal"
          endContent={<ChevronDown size={16} />}
          startContent={<Globe size={16} />}
        >
          {apiConfig.pages.find((p) => p.id === currentPageId)?.name || currentPageId}
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label={t('navbar.pageSelect') || '选择状态页'}>
        {apiConfig.pages.map((page) => (
          <DropdownItem
            key={page.id}
            onClick={() => handlePageChange(page.id)}
            textValue={page.name || page.id}
            className={clsx({ 'bg-primary-50 dark:bg-primary-900/20': page.id === currentPageId })}
          >
            {page.name || page.id}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );

  return (
    <HeroUINavbar maxWidth="xl" position="static">
      <NavbarContent className="basis-1/5 sm:basis-full" justify="start">
        <NavbarBrand className="gap-3 max-w-fit">
          <NextLink className="flex justify-start items-center gap-1" href="/">
            <Image
              src={getIconUrl() || '/icon.svg'}
              alt={`${apiConfig.siteMeta.title} logo`}
              width={34}
              height={34}
            />
            <p className="font-bold text-inherit">{apiConfig.siteMeta.title}</p>
          </NextLink>
        </NavbarBrand>
        <nav aria-label={t('navbar.main')}>
          <ul className="hidden lg:flex gap-4 justify-start ml-2">
            {siteConfig.navItems.map((item) => (
              <li key={item.href}>
                <NextLink
                  className={clsx(
                    linkStyles({ color: 'foreground' }),
                    'data-[active=true]:text-primary data-[active=true]:font-medium',
                  )}
                  color="foreground"
                  href={item.href}
                  target={item.external ? '_blank' : '_self'}
                >
                  {t(item.label)}
                </NextLink>
              </li>
            ))}
            {pageDropdown && <li>{pageDropdown}</li>}
          </ul>
        </nav>
      </NavbarContent>

      <NavbarContent className="hidden sm:flex basis-1/5 sm:basis-full" justify="end">
        <nav aria-label={t('navbar.toolbar')}>
          <ul className="flex items-center gap-4">
            <li>
              <ThemeSwitch />
            </li>
            <li>
              <I18NSwitch />
            </li>
            <li className="hidden lg:block">
              <div className="flex flex-col">{searchInput}</div>
            </li>
            <li className="hidden sm:block">{apiConfig.isShowStarButton && starButton}</li>
          </ul>
        </nav>
      </NavbarContent>

      {/* 移动端 */}
      <NavbarContent className="sm:hidden basis-1 pl-4" justify="end">
        <nav aria-label={t('navbar.toolbar')}>
          <ul className="flex items-center gap-2">
            <li>
              <ThemeSwitch />
            </li>
            <li>
              <I18NSwitch />
            </li>
            <li>
              <NavbarMenuToggle
                icon={(isOpen) => (
                  <motion.div
                    variants={{
                      closed: { rotate: 0, opacity: 1 },
                      open: { rotate: 90, opacity: 1 },
                    }}
                    animate={isOpen ? 'open' : 'closed'}
                    transition={{ duration: 0.3 }}
                    className="text-default-500"
                  >
                    {isOpen ? <X width={24} /> : <Menu size={24} />}
                  </motion.div>
                )}
              />
            </li>
          </ul>
        </nav>
      </NavbarContent>

      <NavbarMenu className="z-[60]">
        {apiConfig.isShowStarButton && starButton}
        <div className="flex flex-col gap-4">{searchInput}</div>
        <nav aria-label={t('navbar.mobileNav')}>
          <ul className="mx-4 mt-4 flex flex-col gap-2">
            {siteConfig.navItems.map((item, index) => (
              <li key={`${item}-${index}`}>
                <Link
                  color={
                    index === 2
                      ? 'primary'
                      : index === siteConfig.navItems.length - 1
                        ? 'danger'
                        : 'foreground'
                  }
                  href={item.href}
                  target={item.external ? '_blank' : '_self'}
                  size="lg"
                >
                  {t(item.label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* 移动端状态页切换 */}
        {apiConfig.pages.length > 1 && (
          <div className="mx-4 mt-6">
            <p className="text-sm font-medium mb-2">{t('navbar.pageSelect')}</p>
            <ul className="flex flex-col gap-2">
              {apiConfig.pages.map((page) => (
                <li key={page.id}>
                  <Button
                    variant={page.id === currentPageId ? 'solid' : 'light'}
                    color={page.id === currentPageId ? 'primary' : 'default'}
                    className="w-full justify-start"
                    onClick={() => handlePageChange(page.id)}
                    startContent={<Globe size={16} />}
                  >
                    {page.name || page.id}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </NavbarMenu>
    </HeroUINavbar>
  );
};
