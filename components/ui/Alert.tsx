import { Alert as HeroUIAlert } from '@heroui/react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { extractPlainText, useMarkdown } from '../utils/markdown';

interface AlertProps {
  title: string;
  description?: string;
  color?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  variant?: 'solid' | 'bordered' | 'flat' | 'faded';
  className?: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  markdownDescription?: boolean;
}

export const Alert = ({
  title,
  description,
  color = 'default',
  variant = 'flat',
  className,
  children,
  icon,
  markdownDescription = false,
}: AlertProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const renderedDescription = useMarkdown(markdownDescription && description ? description : '');
  const plainTextDescription = markdownDescription
    ? extractPlainText(description || '', 150)
    : description;

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="cursor-pointer w-full text-left"
    >
      <HeroUIAlert
        className={className}
        color={color}
        variant={variant}
        icon={!isExpanded ? icon : undefined}
      >
        <div className="flex items-start justify-between w-full">
          <div className="flex-1 mr-2">
            {!isExpanded && <h5 className="text-sm font-medium">{title}</h5>}
            {!isExpanded &&
              description &&
              (markdownDescription ? (
                <div className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                  {plainTextDescription}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1">
                  {description}
                </p>
              ))}
            <div
              className={clsx(
                'grid transition-all duration-200 ease-in-out w-full',
                isExpanded ? 'grid-rows-[1fr] opacity-100 mt-0' : 'grid-rows-[0fr] opacity-0',
              )}
            >
              <div className="overflow-hidden">{children}</div>
            </div>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 flex-shrink-0 text-gray-500" />
          ) : (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-500" />
          )}
        </div>
      </HeroUIAlert>
    </button>
  );
};
