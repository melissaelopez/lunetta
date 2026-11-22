import { clsx } from 'clsx';
import type { ReactNode } from 'react';

interface CardProps {
  title: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function Card({ title, children, className, action }: CardProps) {
  return (
    <div className={clsx('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-indigo-900/50 dark:bg-[#131636]', className)}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-indigo-200/75">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
