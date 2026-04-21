# Docs Shell Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `apps/docs` so `/docs` has a real overview page, the shell exposes clear `Product`, `Desktop`, and `Technical` scopes through Fumadocs layout tabs, and the theme uses a restrained Z8 tech-blue visual system instead of the stock default.

**Architecture:** Keep the current content trees and Fumadocs primitives, but introduce a small shared docs-shell configuration module, a dedicated `/docs` route component, refreshed scope landing pages, and token-driven theme styling. Use a dedicated `/docs/page.tsx` route instead of special-casing the catch-all page so the overview page stays isolated from the normal MDX doc renderer.

**Tech Stack:** Next.js 16 App Router, Fumadocs UI 16, Fumadocs MDX, Tailwind CSS v4, TypeScript, pnpm

---

## File Structure

### Shell configuration

- Create: `apps/docs/src/lib/docs-shell.tsx`
  Purpose: Hold the shared scope metadata for `Product`, `Desktop`, and `Technical`, plus the layout tabs and branded nav title used by both the docs shell and the `/docs` overview page.
- Modify: `apps/docs/src/app/docs/layout.tsx`
  Purpose: Move from `sidebar.tabs` decoration to layout-level `tabs`, apply better nav config, and keep the sidebar scoped to the active root section.
- Modify: `apps/docs/src/app/docs/[[...slug]]/page.tsx`
  Purpose: Stop redirecting `/docs` inside the catch-all route and leave that page focused on normal MDX page rendering only.
- Modify: `apps/docs/src/lib/source.ts`
  Purpose: Add the missing desktop root icon mapping so the desktop scope has a valid icon.

### Route pages

- Create: `apps/docs/src/app/docs/page.tsx`
  Purpose: Render the new `/docs` overview page with three scope cards and quick-start links.
- Modify: `apps/docs/src/app/layout.tsx`
  Purpose: Keep `RootProvider`, but add body classes that let the new theme tokens show through consistently.

### Theme and content

- Modify: `apps/docs/src/app/globals.css`
  Purpose: Replace the stock `fumadocs-ui/style.css` import with the documented theme preset imports and define custom `--color-fd-*` tokens plus page-level shell styling.
- Modify: `apps/docs/content/docs/guide/meta.json`
  Purpose: Rename the displayed root title to `Product` and sharpen the description.
- Modify: `apps/docs/content/docs/desktop/meta.json`
  Purpose: Shorten the displayed root title to `Desktop` and align the description with the new shell wording.
- Modify: `apps/docs/content/docs/tech/meta.json`
  Purpose: Rename the displayed root title to `Technical` and sharpen the description.
- Modify: `apps/docs/content/docs/guide/index.mdx`
  Purpose: Turn the Product landing page into a clearer role-based entry point.
- Modify: `apps/docs/content/docs/desktop/index.mdx`
  Purpose: Keep the desktop landing page useful, but align the opening structure with the new scoped shell.
- Modify: `apps/docs/content/docs/tech/index.mdx`
  Purpose: Turn the Technical landing page into a clearer developer/operator entry point.

### Verification

- Verify: `apps/docs`
  Purpose: Ensure the docs app still builds and that the new routes and theme compile cleanly.

---

### Task 1: Add Shared Scope Metadata And Switch The Shell To Layout Tabs

**Files:**
- Create: `apps/docs/src/lib/docs-shell.tsx`
- Modify: `apps/docs/src/app/docs/layout.tsx`
- Modify: `apps/docs/src/app/docs/[[...slug]]/page.tsx`
- Modify: `apps/docs/src/lib/source.ts`
- Modify: `apps/docs/content/docs/guide/meta.json`
- Modify: `apps/docs/content/docs/desktop/meta.json`
- Modify: `apps/docs/content/docs/tech/meta.json`

- [ ] **Step 1: Create the shared docs shell config**

Create `apps/docs/src/lib/docs-shell.tsx` with this content:

```tsx
import { IconBook, IconCode, IconDeviceDesktop, IconLifebuoy } from '@tabler/icons-react';

export type DocsScope = {
  key: 'product' | 'desktop' | 'technical';
  title: string;
  description: string;
  url: string;
  audience: string;
  accentClassName: string;
  icon: typeof IconBook;
  quickLinks: Array<{
    label: string;
    href: string;
  }>;
};

export const docsScopes: DocsScope[] = [
  {
    key: 'product',
    title: 'Product',
    description: 'User, manager, and admin workflows for day-to-day Z8 operations.',
    url: '/docs/guide',
    audience: 'Employees, managers, and workspace admins',
    accentClassName: 'from-sky-500/15 via-blue-500/8 to-transparent dark:from-sky-400/18 dark:via-blue-400/10',
    icon: IconBook,
    quickLinks: [
      { label: 'Getting Started', href: '/docs/guide/getting-started' },
      { label: 'User Guide', href: '/docs/guide/user-guide' },
      { label: 'Manager Guide', href: '/docs/guide/manager-guide' },
      { label: 'Admin Guide', href: '/docs/guide/admin-guide' },
    ],
  },
  {
    key: 'desktop',
    title: 'Desktop',
    description: 'Installation, tray workflows, offline behavior, and troubleshooting for z8 Timer.',
    url: '/docs/desktop',
    audience: 'Desktop users and internal IT support',
    accentClassName: 'from-indigo-500/15 via-slate-500/8 to-transparent dark:from-indigo-400/18 dark:via-slate-400/10',
    icon: IconDeviceDesktop,
    quickLinks: [
      { label: 'Installation', href: '/docs/desktop/getting-started/installation' },
      { label: 'Authentication', href: '/docs/desktop/getting-started/authentication' },
      { label: 'Time Tracking', href: '/docs/desktop/features/time-tracking' },
      { label: 'Troubleshooting', href: '/docs/desktop/troubleshooting' },
    ],
  },
  {
    key: 'technical',
    title: 'Technical',
    description: 'Architecture, integrations, deployment, and operational behavior for Z8.',
    url: '/docs/tech',
    audience: 'Developers, operators, and implementers',
    accentClassName: 'from-cyan-500/14 via-slate-600/10 to-transparent dark:from-cyan-400/16 dark:via-slate-500/12',
    icon: IconCode,
    quickLinks: [
      { label: 'Architecture', href: '/docs/tech/technical' },
      { label: 'Authentication', href: '/docs/tech/technical/authentication' },
      { label: 'Deployment', href: '/docs/tech/deployment' },
      { label: 'Services', href: '/docs/tech/technical/services' },
    ],
  },
];

export const docsTabs = docsScopes.map((scope) => ({
  title: scope.title,
  description: scope.description,
  url: scope.url,
  icon: <scope.icon className="size-4" />,
}));

export function DocsNavTitle() {
  return (
    <div className="flex items-center gap-3 text-sm font-medium text-fd-foreground">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-fd-primary text-fd-primary-foreground shadow-sm">
        <IconLifebuoy className="size-4" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-fd-muted-foreground">
          Z8
        </span>
        <span className="text-sm font-semibold">Docs</span>
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Move `DocsLayout` to layout-level tabs**

Replace `apps/docs/src/app/docs/layout.tsx` with this implementation:

```tsx
import { source } from '@/lib/source';
import { DocsNavTitle, docsTabs } from '@/lib/docs-shell';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      tabs={docsTabs}
      tabMode="top"
      nav={{
        title: <DocsNavTitle />,
        url: '/docs',
        transparentMode: 'top',
      }}
      sidebar={{
        defaultOpenLevel: 1,
        collapsible: true,
      }}
    >
      {children}
    </DocsLayout>
  );
}
```

- [ ] **Step 3: Keep the catch-all route focused on MDX pages only**

Update `apps/docs/src/app/docs/[[...slug]]/page.tsx` so it no longer redirects `/docs` and instead expects only real slugs:

```tsx
import { source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/page';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ComponentType } from 'react';
import { mdxComponents } from '@/mdx-components';

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function Page({ params }: PageProps) {
  const { slug = [] } = await params;

  if (slug.length === 0) notFound();

  const page = source.getPage(slug);

  if (!page) notFound();

  const data = page.data as any;
  const MDX = data.body as ComponentType<{ components?: Record<string, ComponentType> }>;

  return (
    <DocsPage toc={data.toc} full={data.full}>
      <DocsTitle>{data.title}</DocsTitle>
      <DocsDescription>{data.description}</DocsDescription>
      <DocsBody>
        <MDX components={mdxComponents as any} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug = [] } = await params;

  if (slug.length === 0) notFound();

  const page = source.getPage(slug);

  if (!page) notFound();

  const data = page.data as any;

  return {
    title: `${data.title} | Z8 Docs`,
    description: data.description,
    openGraph: {
      title: data.title,
      description: data.description,
    },
  };
}
```

- [ ] **Step 4: Fix the root metadata labels and desktop icon mapping**

Update `apps/docs/src/lib/source.ts` imports and icon map entries like this:

```tsx
import {
  IconRocket,
  IconUser,
  IconUsers,
  IconShieldLock,
  IconCode,
  IconServer,
  IconUserPlus,
  IconUserCog,
  IconUsersGroup,
  IconMapPin,
  IconLock,
  IconCalendarTime,
  IconScale,
  IconBeach,
  IconChartBar,
  IconSettings,
  IconBug,
  IconPlayerPlay,
  IconDatabase,
  IconKey,
  IconCloud,
  IconTestPipe,
  IconClock,
  IconCalendar,
  IconBell,
  IconUmbrella,
  IconHelp,
  IconBriefcase,
  IconPercentage,
  IconBook,
  IconMonitor,
} from '@tabler/icons-react';
import { createElement, type ComponentType } from 'react';

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  Rocket: IconRocket,
  User: IconUser,
  Users: IconUsers,
  ShieldLock: IconShieldLock,
  Code: IconCode,
  Server: IconServer,
  Book: IconBook,
  Monitor: IconMonitor,
  UserPlus: IconUserPlus,
  UserCog: IconUserCog,
  UsersGroup: IconUsersGroup,
  MapPin: IconMapPin,
  Lock: IconLock,
  CalendarTime: IconCalendarTime,
  Scale: IconScale,
  Beach: IconBeach,
  ChartBar: IconChartBar,
  Settings: IconSettings,
  Bug: IconBug,
  Briefcase: IconBriefcase,
  Percent: IconPercentage,
  PlayerPlay: IconPlayerPlay,
  Database: IconDatabase,
  Key: IconKey,
  Cloud: IconCloud,
  TestPipe: IconTestPipe,
  Clock: IconClock,
  Calendar: IconCalendar,
  Bell: IconBell,
  Umbrella: IconUmbrella,
  Help: IconHelp,
};
```

Replace `apps/docs/content/docs/guide/meta.json` with:

```json
{
  "root": true,
  "title": "Product",
  "description": "Role-based product guides for employees, managers, and workspace administrators",
  "icon": "Book",
  "pages": [
    "getting-started",
    "user-guide",
    "manager-guide",
    "admin-guide"
  ]
}
```

Replace `apps/docs/content/docs/desktop/meta.json` with:

```json
{
  "root": true,
  "title": "Desktop",
  "description": "Desktop app installation, tray workflows, offline behavior, and troubleshooting",
  "icon": "Monitor",
  "pages": [
    "getting-started",
    "features",
    "troubleshooting"
  ]
}
```

Replace `apps/docs/content/docs/tech/meta.json` with:

```json
{
  "root": true,
  "title": "Technical",
  "description": "Architecture, integrations, deployment, and operational guides",
  "icon": "Code",
  "pages": [
    "technical",
    "deployment"
  ]
}
```

- [ ] **Step 5: Run the docs build to verify the shell changes compile**

Run: `pnpm build`

Workdir: `apps/docs`

Expected: Next.js finishes a production build without TypeScript errors, and the build output includes the `/docs`, `/docs/guide`, `/docs/desktop`, and `/docs/tech` routes.

- [ ] **Step 6: Commit the shell-structure changes**

Run:

```bash
git add apps/docs/src/lib/docs-shell.tsx apps/docs/src/app/docs/layout.tsx apps/docs/src/app/docs/[[...slug]]/page.tsx apps/docs/src/lib/source.ts apps/docs/content/docs/guide/meta.json apps/docs/content/docs/desktop/meta.json apps/docs/content/docs/tech/meta.json
git commit -m "feat: add scoped docs shell navigation"
```

Expected: a commit containing only the shared docs shell config, layout tab wiring, icon mapping, and root metadata updates.

### Task 2: Add A Real `/docs` Overview Page

**Files:**
- Create: `apps/docs/src/app/docs/page.tsx`

- [ ] **Step 1: Create the dedicated `/docs` overview route**

Create `apps/docs/src/app/docs/page.tsx` with this content:

```tsx
import { docsScopes } from '@/lib/docs-shell';
import { IconArrowRight } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Z8 Docs',
  description: 'Choose the right Z8 documentation area for product workflows, desktop usage, or technical implementation.',
};

export default function DocsOverviewPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 md:px-6 lg:gap-12 lg:py-14">
      <section className="overflow-hidden rounded-3xl border border-fd-border bg-fd-card/80 p-6 shadow-sm backdrop-blur md:p-8">
        <div className="flex flex-col gap-4 lg:max-w-3xl">
          <span className="inline-flex w-fit rounded-full border border-fd-border bg-fd-accent px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-fd-muted-foreground">
            Z8 Documentation
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-fd-foreground md:text-5xl">
            Find the right documentation area before you dive into the details.
          </h1>
          <p className="text-base leading-7 text-fd-muted-foreground md:text-lg">
            Product guides help teams use Z8 day to day, Desktop covers the tray app and offline workflows, and Technical explains architecture, integrations, and deployment.
          </p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {docsScopes.map((scope) => {
          const ScopeIcon = scope.icon;

          return (
            <article
              key={scope.key}
              className="group relative overflow-hidden rounded-3xl border border-fd-border bg-fd-card/80 p-6 shadow-sm transition-transform duration-200 hover:-translate-y-0.5"
            >
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-br ${scope.accentClassName}`} />
              <div className="relative flex h-full flex-col gap-5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-fd-border bg-fd-background/90 text-fd-foreground shadow-sm">
                    <ScopeIcon className="size-5" />
                  </span>
                  <span className="text-xs font-medium uppercase tracking-[0.18em] text-fd-muted-foreground">
                    {scope.title}
                  </span>
                </div>

                <div className="space-y-3">
                  <h2 className="text-2xl font-semibold tracking-tight text-fd-foreground">{scope.title}</h2>
                  <p className="text-sm leading-6 text-fd-muted-foreground">{scope.description}</p>
                  <p className="text-sm font-medium text-fd-foreground">{scope.audience}</p>
                </div>

                <ul className="space-y-2 text-sm text-fd-muted-foreground">
                  {scope.quickLinks.map((link) => (
                    <li key={link.href}>
                      <Link className="transition-colors hover:text-fd-foreground" href={link.href}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>

                <Link
                  href={scope.url}
                  className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-fd-primary transition-colors hover:text-fd-primary/80"
                >
                  Open {scope.title}
                  <IconArrowRight className="size-4" />
                </Link>
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-4 rounded-3xl border border-fd-border bg-fd-card/60 p-6 md:grid-cols-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-fd-muted-foreground">
            Start Here
          </h2>
        </div>
        <div className="space-y-2 text-sm leading-6 text-fd-muted-foreground">
          <p>
            Choose <strong className="text-fd-foreground">Product</strong> when you need role-based guidance for employees, managers, or admins.
          </p>
          <p>
            Choose <strong className="text-fd-foreground">Desktop</strong> when you are setting up or troubleshooting the z8 Timer app.
          </p>
        </div>
        <div className="space-y-2 text-sm leading-6 text-fd-muted-foreground">
          <p>
            Choose <strong className="text-fd-foreground">Technical</strong> when you need architecture details, deployment guidance, or implementation notes.
          </p>
          <p>
            Use the scope switcher in the docs shell any time you need to move between these areas.
          </p>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify the new `/docs` route builds and wins over the catch-all route**

Run: `pnpm build`

Workdir: `apps/docs`

Expected: The build succeeds, and `/docs` is emitted from `src/app/docs/page.tsx` while slugged docs pages continue using `src/app/docs/[[...slug]]/page.tsx`.

- [ ] **Step 3: Commit the overview route**

Run:

```bash
git add apps/docs/src/app/docs/page.tsx
git commit -m "feat: add docs overview page"
```

Expected: a commit containing only the new `/docs` overview page route.

### Task 3: Apply The Z8 Tech-Blue Theme Tokens

**Files:**
- Modify: `apps/docs/src/app/globals.css`
- Modify: `apps/docs/src/app/layout.tsx`

- [ ] **Step 1: Replace the stock stylesheet import with the documented theme preset and custom tokens**

Replace `apps/docs/src/app/globals.css` with this content:

```css
@import 'tailwindcss';
@import 'fumadocs-ui/css/neutral.css';
@import 'fumadocs-ui/css/preset.css';

:root {
  --radius: 0.75rem;
  --fd-layout-width: 92rem;
}

@theme {
  --color-fd-background: hsl(210 40% 98%);
  --color-fd-foreground: hsl(222 47% 11%);
  --color-fd-muted: hsl(210 32% 96%);
  --color-fd-muted-foreground: hsl(215 16% 40%);
  --color-fd-popover: hsl(0 0% 100%);
  --color-fd-popover-foreground: hsl(222 47% 11%);
  --color-fd-card: hsl(210 33% 98%);
  --color-fd-card-foreground: hsl(222 47% 11%);
  --color-fd-border: hsla(214 32% 58% / 0.24);
  --color-fd-primary: hsl(211 100% 46%);
  --color-fd-primary-foreground: hsl(0 0% 100%);
  --color-fd-secondary: hsl(210 28% 94%);
  --color-fd-secondary-foreground: hsl(222 47% 16%);
  --color-fd-accent: hsla(211 100% 46% / 0.12);
  --color-fd-accent-foreground: hsl(216 59% 20%);
  --color-fd-ring: hsl(211 100% 46%);
}

.dark {
  --color-fd-background: hsl(222 47% 8%);
  --color-fd-foreground: hsl(210 40% 96%);
  --color-fd-muted: hsl(222 26% 12%);
  --color-fd-muted-foreground: hsl(215 20% 72%);
  --color-fd-popover: hsl(222 34% 10%);
  --color-fd-popover-foreground: hsl(210 40% 96%);
  --color-fd-card: hsl(222 34% 11%);
  --color-fd-card-foreground: hsl(210 40% 96%);
  --color-fd-border: hsla(214 30% 62% / 0.18);
  --color-fd-primary: hsl(204 100% 64%);
  --color-fd-primary-foreground: hsl(222 47% 11%);
  --color-fd-secondary: hsl(222 22% 14%);
  --color-fd-secondary-foreground: hsl(210 40% 96%);
  --color-fd-accent: hsla(204 100% 64% / 0.14);
  --color-fd-accent-foreground: hsl(204 100% 88%);
  --color-fd-ring: hsl(204 100% 64%);
}

html {
  scroll-behavior: smooth;
}

body {
  min-height: 100vh;
  background:
    radial-gradient(circle at top, hsla(211 100% 46% / 0.12), transparent 28%),
    var(--color-fd-background);
  color: var(--color-fd-foreground);
}

::selection {
  background: hsla(211 100% 46% / 0.22);
}
```

- [ ] **Step 2: Add body classes so the shell picks up the tokenized background and text colors reliably**

Update `apps/docs/src/app/layout.tsx` to:

```tsx
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Z8 Documentation',
  description: 'Documentation for the Z8 Team Management System',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-fd-background text-fd-foreground antialiased">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Run the docs build after the theme change**

Run: `pnpm build`

Workdir: `apps/docs`

Expected: the build succeeds with no CSS import errors, and the generated docs app uses the new theme token set instead of the stock `style.css` bundle.

- [ ] **Step 4: Commit the theme changes**

Run:

```bash
git add apps/docs/src/app/globals.css apps/docs/src/app/layout.tsx
git commit -m "style: theme docs shell with z8 blue tokens"
```

Expected: a commit containing only the theme import migration, token definitions, and body styling update.

### Task 4: Refresh The Scope Landing Pages

**Files:**
- Modify: `apps/docs/content/docs/guide/index.mdx`
- Modify: `apps/docs/content/docs/desktop/index.mdx`
- Modify: `apps/docs/content/docs/tech/index.mdx`

- [ ] **Step 1: Rewrite the Product landing page around role-based entry points**

Replace `apps/docs/content/docs/guide/index.mdx` with:

```mdx
---
title: Product Documentation
description: Role-based guides for employees, managers, and administrators using Z8 every day
---

import { Callout } from 'fumadocs-ui/components/callout';
import { Card, Cards } from 'fumadocs-ui/components/card';

Use the Product docs when you need help completing everyday work in Z8. Start with the guide that matches your role, then move into the detailed workflows for that area.

<Callout title="Choose the right guide">
Employees should start with the User Guide. Managers should start with the Manager Guide. Workspace admins should start with the Admin Guide.
</Callout>

<Cards>
  <Card
    title="Getting Started"
    description="Account setup, first login, and the core concepts new teams should understand first"
    href="/docs/guide/getting-started"
  />
  <Card
    title="User Guide"
    description="Daily time tracking, calendar workflows, notifications, and personal settings"
    href="/docs/guide/user-guide"
  />
  <Card
    title="Manager Guide"
    description="Approvals, team visibility, scheduling oversight, and manager-specific actions"
    href="/docs/guide/manager-guide"
  />
  <Card
    title="Admin Guide"
    description="Organization setup, access control, payroll export, integrations, and platform operations"
    href="/docs/guide/admin-guide"
  />
</Cards>
```

- [ ] **Step 2: Tighten the Desktop landing page around setup and daily use**

Replace `apps/docs/content/docs/desktop/index.mdx` with:

```mdx
---
title: Desktop Documentation
description: Setup, tray workflows, offline usage, and troubleshooting for the z8 Timer desktop app
icon: Monitor
---

import { Card, Cards } from 'fumadocs-ui/components/card';

The **z8 Timer** desktop app gives employees a faster way to clock in, switch organizations, and keep tracking time even when the browser is closed or the connection is unstable.

## Start Here

<Cards>
  <Card
    title="Install the App"
    description="Download the right installer for Windows, macOS, or Linux and complete the first launch setup"
    href="/docs/desktop/getting-started/installation"
  />
  <Card
    title="Authenticate"
    description="Connect the desktop app to your Z8 account with the browser-based sign-in flow"
    href="/docs/desktop/getting-started/authentication"
  />
  <Card
    title="Track Time"
    description="Use the tray menu for one-click time tracking, breaks, and organization switching"
    href="/docs/desktop/features/time-tracking"
  />
  <Card
    title="Offline Mode"
    description="Understand local queueing, background sync, and what happens when the network returns"
    href="/docs/desktop/features/offline-mode"
  />
  <Card
    title="Settings"
    description="Choose appearance, startup behavior, and app preferences without leaving the desktop shell"
    href="/docs/desktop/features/settings"
  />
  <Card
    title="Troubleshooting"
    description="Fix authentication, sync, platform-specific, and tray-behavior problems"
    href="/docs/desktop/troubleshooting"
  />
</Cards>

## Platform Support

| Platform | Installer | Requirements |
| --- | --- | --- |
| Windows | `.msi`, `.exe` | Windows 10 or newer with WebView2 |
| macOS | `.dmg` | macOS 10.15 or newer |
| Linux | `.deb`, `.AppImage` | WebKitGTK 4.1 or newer |
```

- [ ] **Step 3: Rewrite the Technical landing page around developer and operator entry points**

Replace `apps/docs/content/docs/tech/index.mdx` with:

```mdx
---
title: Technical Documentation
description: Architecture, integrations, deployment, and operations guidance for Z8
icon: Code
---

import { Card, Cards } from 'fumadocs-ui/components/card';

Use the Technical docs when you need to understand how Z8 is built, how its services fit together, or how to deploy and operate it safely.

<Cards>
  <Card
    title="Architecture"
    description="Core system concepts, services, data boundaries, and implementation structure"
    href="/docs/tech/technical"
  />
  <Card
    title="Authentication"
    description="Better Auth setup, access control, invitations, and enterprise auth behavior"
    href="/docs/tech/technical/authentication"
  />
  <Card
    title="Database"
    description="Schema organization, canonical time concepts, and persistent data relationships"
    href="/docs/tech/technical/database"
  />
  <Card
    title="Services"
    description="Background jobs, notification flows, exports, and system responsibilities"
    href="/docs/tech/technical/services"
  />
  <Card
    title="Deployment"
    description="Runtime setup, production responsibilities, and operator-facing deployment guidance"
    href="/docs/tech/deployment"
  />
</Cards>
```

- [ ] **Step 4: Run the docs build after the landing page rewrites**

Run: `pnpm build`

Workdir: `apps/docs`

Expected: the build succeeds, all three landing pages render as valid MDX, and no imports or frontmatter fields fail the page generation step.

- [ ] **Step 5: Commit the landing page refresh**

Run:

```bash
git add apps/docs/content/docs/guide/index.mdx apps/docs/content/docs/desktop/index.mdx apps/docs/content/docs/tech/index.mdx
git commit -m "docs: refresh scoped landing pages"
```

Expected: a commit containing only the Product, Desktop, and Technical landing page rewrites.

### Task 5: Final Verification And Handoff Check

**Files:**
- Verify only: `apps/docs`

- [ ] **Step 1: Run the final production build**

Run: `pnpm build`

Workdir: `apps/docs`

Expected: a clean production build with no TypeScript, MDX, or CSS errors.

- [ ] **Step 2: Run the dev server for a manual shell pass**

Run: `pnpm dev`

Workdir: `apps/docs`

Expected: the app starts on port `3002` and serves the docs locally.

- [ ] **Step 3: Manually verify the shell behavior in the browser**

Check these URLs and interactions:

```text
http://localhost:3002/docs
http://localhost:3002/docs/guide
http://localhost:3002/docs/desktop
http://localhost:3002/docs/tech
```

Expected:

- `/docs` shows the overview page instead of redirecting.
- The scope switcher shows `Product`, `Desktop`, and `Technical`.
- Switching scopes changes the visible sidebar tree.
- The desktop scope shows a valid icon instead of a missing icon mapping.
- The header and cards use the blue-led theme in both light and dark mode.

- [ ] **Step 4: Confirm the worktree is clean after the final commit**

Run: `git status --short`

Workdir: repository root

Expected: no unstaged or uncommitted changes related to the docs-shell task.
