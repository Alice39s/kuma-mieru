'use client';

import { Menu } from '@base-ui/react/menu';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { iconButton } from './icon-button';
import type { Locale } from '@/lib/i18n';
import { siteText } from '@/lib/layout.shared';

const subscribe = () => () => {};

/** Light, dark or system, as a single-choice menu; the trigger shows the current choice. */
export function ThemeMenu({ locale }: { locale: Locale }) {
  const text = siteText[locale];
  const { theme, setTheme } = useTheme();
  const isMounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const options = [
    { value: 'light', label: text.themeLight, icon: Sun },
    { value: 'dark', label: text.themeDark, icon: Moon },
    { value: 'system', label: text.themeSystem, icon: Monitor },
  ] as const;
  const selected = options.find(option => isMounted && option.value === theme) ?? options[2];
  const label = text.themeCurrent.replace('{theme}', selected.label);

  return (
    <Menu.Root>
      <Menu.Trigger className={iconButton} aria-label={label} title={label}>
        <selected.icon aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="isolate z-50 outline-none" align="end" sideOffset={6}>
          <Menu.Popup className="min-w-36 origin-(--transform-origin) rounded-(--radius-card) border bg-fd-popover p-1 text-fd-popover-foreground shadow-(--shadow-overlay) outline-none data-open:animate-fd-popover-in data-closed:animate-fd-popover-out">
            <Menu.RadioGroup
              value={selected.value}
              onValueChange={setTheme}
              aria-label={text.theme}
            >
              {options.map(option => (
                <Menu.RadioItem
                  key={option.value}
                  value={option.value}
                  className="relative flex cursor-default items-center gap-2 rounded-(--radius) py-1.5 pr-8 pl-2 text-sm outline-none select-none data-highlighted:bg-fd-accent data-highlighted:text-fd-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0"
                >
                  <option.icon aria-hidden="true" />
                  {option.label}
                  <span className="pointer-events-none absolute right-2 flex items-center">
                    <Menu.RadioItemIndicator>
                      <Check aria-hidden="true" />
                    </Menu.RadioItemIndicator>
                  </span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
