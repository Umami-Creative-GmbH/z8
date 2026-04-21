import {
  IconBook,
  IconCode,
  IconDeviceDesktop as IconMonitor,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';

export type DocsScope = 'product' | 'desktop' | 'technical';

interface DocsQuickLink {
  label: string;
  url: string;
}

export interface DocsScopeConfig {
  scope: DocsScope;
  title: string;
  description: string;
  url: string;
  audience: string;
  accentClassName: string;
  icon: ComponentType<{ className?: string }>;
  quickLinks: DocsQuickLink[];
}

export const docsScopes: DocsScopeConfig[] = [
  {
    scope: 'product',
    title: 'Product',
    description:
      'Role-based product guides for employees, managers, and workspace administrators',
    url: '/docs/guide',
    audience: 'Employees, managers, and workspace administrators',
    accentClassName: 'text-blue-500 dark:text-blue-400',
    icon: IconBook,
    quickLinks: [
      { label: 'Getting started', url: '/docs/guide/getting-started' },
      { label: 'User guide', url: '/docs/guide/user-guide' },
      { label: 'Manager guide', url: '/docs/guide/manager-guide' },
    ],
  },
  {
    scope: 'desktop',
    title: 'Desktop',
    description:
      'Desktop app installation, tray workflows, offline behavior, and troubleshooting',
    url: '/docs/desktop',
    audience: 'Teams using the Z8 desktop timer on Windows, macOS, and Linux',
    accentClassName: 'text-violet-500 dark:text-violet-400',
    icon: IconMonitor,
    quickLinks: [
      { label: 'Getting started', url: '/docs/desktop/getting-started' },
      { label: 'Features', url: '/docs/desktop/features' },
      { label: 'Troubleshooting', url: '/docs/desktop/troubleshooting' },
    ],
  },
  {
    scope: 'technical',
    title: 'Technical',
    description: 'Architecture, integrations, deployment, and operational guides',
    url: '/docs/tech',
    audience: 'Developers, operators, and implementation partners',
    accentClassName: 'text-emerald-500 dark:text-emerald-400',
    icon: IconCode,
    quickLinks: [
      { label: 'Architecture', url: '/docs/tech/technical' },
      { label: 'Deployment', url: '/docs/tech/deployment' },
    ],
  },
];

export const docsTabs = docsScopes.map(({ title, description, url, icon: Icon }) => ({
  title,
  description,
  url,
  icon: <Icon className="size-4" />,
}));

export function DocsNavTitle() {
  return (
    <span className="inline-flex items-center gap-2 font-medium">
      <span className="flex size-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-300">
        <span className="text-xs font-semibold">Z8</span>
      </span>
      <span className="text-sm">Z8 Docs</span>
    </span>
  );
}
