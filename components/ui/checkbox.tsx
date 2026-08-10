'use client';

import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CheckboxProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
    ({ className, checked, onCheckedChange, ...props }, ref) => {
        return (
            <button
                ref={ref}
                type="button"
                role="checkbox"
                aria-checked={checked}
                data-state={checked ? 'checked' : 'unchecked'}
                onClick={(e) => {
                    e.stopPropagation();
                    onCheckedChange?.(!checked);
                }}
                className={cn(
                    'peer h-4 w-4 shrink-0 rounded-sm border border-zinc-300 dark:border-zinc-700',
                    'ring-offset-background focus-visible:outline-none focus-visible:ring-2',
                    'focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
                    'data-[state=checked]:bg-zinc-900 data-[state=checked]:text-zinc-50',
                    'dark:data-[state=checked]:bg-zinc-100 dark:data-[state=checked]:text-zinc-900',
                    'flex items-center justify-center transition-colors',
                    className
                )}
                {...props}
            >
                {checked && <Check className="h-3 w-3" />}
            </button>
        );
    }
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
