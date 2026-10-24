'use client';

import {
  Button,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Dropdown as HeroUIDropdown,
} from '@heroui/react';
import { motion } from 'framer-motion';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

const mode = {
  light: {
    icon: <Sun size={22} />,
    text: 'mode.light',
  },
  dark: {
    icon: <Moon size={22} />,
    text: 'mode.dark',
  },
  system: {
    icon: <Monitor size={22} />,
    text: 'mode.system',
  },
};

export const ThemeSwitch = ({
  radius,
}: {
  radius?: 'none' | 'full' | 'sm' | 'md' | 'lg' | undefined;
}) => {
  const t = useTranslations();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentTheme = (theme as keyof typeof mode) || 'system';
  const themeIcon = mode[currentTheme]?.icon || mode.system.icon;

  if (!mounted) {
    return (
      <Button isIconOnly variant="light" radius={radius} className="text-default-500">
        <Monitor size={22} />
      </Button>
    );
  }

  return (
    <HeroUIDropdown aria-label="Switch Theme">
      <DropdownTrigger>
        <Button isIconOnly variant="light" radius={radius} className="text-default-500">
          {currentTheme === 'system' ? (
            <div key={currentTheme}>{themeIcon}</div>
          ) : (
            <motion.div
              key={currentTheme}
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {themeIcon}
            </motion.div>
          )}
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label="Switch Theme" variant="faded">
        {Object.entries(mode).map(([key, value]) => (
          <DropdownItem
            key={key}
            startContent={<div className="w-6 h-6">{value.icon}</div>}
            onPress={() => setTheme(key)}
            className="flex flex-row items-center gap-2 text-default-500"
          >
            {t(value.text)}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </HeroUIDropdown>
  );
};
