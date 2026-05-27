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
  iconClassName: string;
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
    accentClassName: 'from-blue-500/16 via-sky-500/8 to-transparent dark:from-blue-400/20 dark:via-sky-400/10',
    iconClassName: 'text-blue-600 dark:text-blue-300',
    icon: IconBook,
    quickLinks: [
      { label: 'Getting Started', url: '/docs/guide/getting-started' },
      { label: 'User Guide', url: '/docs/guide/user-guide' },
      { label: 'Manager Guide', url: '/docs/guide/manager-guide' },
      { label: 'Admin Guide', url: '/docs/guide/admin-guide' },
    ],
  },
  {
    scope: 'desktop',
    title: 'Desktop',
    description:
      'Desktop app installation, tray workflows, offline behavior, and troubleshooting',
    url: '/docs/desktop',
    audience: 'Teams using the Z8 desktop timer on Windows, macOS, and Linux',
    accentClassName: 'from-violet-500/16 via-indigo-500/8 to-transparent dark:from-violet-400/20 dark:via-indigo-400/10',
    iconClassName: 'text-violet-600 dark:text-violet-300',
    icon: IconMonitor,
    quickLinks: [
      { label: 'Getting Started', url: '/docs/desktop/getting-started' },
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
    accentClassName: 'from-cyan-500/16 via-emerald-500/8 to-transparent dark:from-cyan-400/20 dark:via-emerald-400/10',
    iconClassName: 'text-cyan-600 dark:text-cyan-300',
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
  icon: <Icon aria-hidden="true" className="size-4" />,
}));
