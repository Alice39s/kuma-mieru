'use client';

import { Button } from '@heroui/react';
import clsx from 'clsx';
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { useState } from 'react';

interface ErrorStackTraceProps {
  stack: string;
  errorText: string;
}

export function ErrorStackTrace({ stack, errorText }: ErrorStackTraceProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(errorText).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    });
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="light"
          size="sm"
          className="text-default-500"
          endContent={
            isExpanded ? (
              <ChevronUp size={16} aria-hidden="true" />
            ) : (
              <ChevronDown size={16} aria-hidden="true" />
            )
          }
          onPress={() => setIsExpanded(prev => !prev)}
        >
          {isExpanded ? 'Hide details' : 'Show details'}
        </Button>
        <Button
          variant="light"
          size="sm"
          className="text-default-500"
          startContent={isCopied ? <Check size={16} /> : <Copy size={16} />}
          onPress={handleCopy}
        >
          {isCopied ? 'Copied' : 'Copy error'}
        </Button>
      </div>

      <div
        className={clsx(
          'grid overflow-hidden transition-[grid-template-rows] duration-300 ease-in-out',
          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="min-h-0">
          <div className="mt-2 max-h-64 w-full overflow-auto rounded-lg border border-danger/10 bg-danger/5 p-4">
            <pre className="whitespace-pre-wrap break-all font-mono text-xs text-default-700">
              {stack}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
