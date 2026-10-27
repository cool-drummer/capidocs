import type { ReactNode } from 'react';

const PATHS = {
  chevron: ['m9 18 6-6-6-6'],
  plus: ['M5 12h14', 'M12 5v14'],
  home: ['M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8', 'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  globe: ['M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20', 'M2 12h20'],
  userCheck: ['m16 11 2 2 4-4', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'],
  lock: ['M7 11V7a5 5 0 0 1 10 0v4'],
  arrowUp: ['m5 12 7-7 7 7', 'M12 19V5'],
  trash: ['M3 6h18', 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6', 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2'],
  panel: ['M9 3v18'],
} as const;

const EXTRA: Partial<Record<keyof typeof PATHS, ReactNode>> = {
  users: <circle cx="9" cy="7" r="4" />,
  globe: <circle cx="12" cy="12" r="10" />,
  userCheck: <circle cx="9" cy="7" r="4" />,
  lock: <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />,
  panel: <rect x="3" y="3" width="18" height="18" rx="2" />,
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {EXTRA[name] ?? null}
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
