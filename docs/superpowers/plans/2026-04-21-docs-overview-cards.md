# Docs Overview Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the `/docs` overview cards so the three top-level scopes feel more polished and product-like while preserving the current docs shell and keeping all links wired to the shared scope metadata.

**Architecture:** Keep the change isolated to the overview page and the shared `docsScopes` metadata. Use one small metadata cleanup in `docs-shell.tsx` to support richer card accents, then rebuild the `/docs` page around a stronger card hierarchy with restrained CTA treatment and clearer quick-link styling.

**Tech Stack:** Next.js 16 App Router, Fumadocs UI 16, TypeScript, Tailwind CSS v4, pnpm

---

## File Structure

### Shared scope metadata

- Modify: `apps/docs/src/lib/docs-shell.tsx`
  Purpose: Keep the shared scope model as the single source of truth for `Product`, `Desktop`, and `Technical`, while adding only the minimal visual metadata needed for the improved overview cards.

### Overview page

- Modify: `apps/docs/src/app/docs/page.tsx`
  Purpose: Replace the current plain cards with more structured, product-like scope entry cards and preserve direct navigation through shared metadata.

### Verification

- Verify: `apps/docs`
  Purpose: Confirm the redesigned overview still builds, renders, and links correctly.

---

### Task 1: Normalize Shared Overview Scope Metadata

**Files:**
- Modify: `apps/docs/src/lib/docs-shell.tsx`

- [ ] **Step 1: Update the shared scope metadata shape for richer card styling**

Replace `apps/docs/src/lib/docs-shell.tsx` with:

```tsx
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
```

- [ ] **Step 2: Run the docs build to confirm metadata changes stay compatible with the shell**

Run: `pnpm build`

Workdir: `apps/docs`

Expected: the docs app builds successfully, and the layout tab system still resolves from `docsTabs` without TypeScript or route errors.

- [ ] **Step 3: Commit the shared metadata cleanup**

Run:

```bash
git add apps/docs/src/lib/docs-shell.tsx
git commit -m "refactor: normalize docs overview scope metadata"
```

Expected: a commit containing only the shared scope metadata cleanup.

### Task 2: Redesign The `/docs` Overview Cards

**Files:**
- Modify: `apps/docs/src/app/docs/page.tsx`

- [ ] **Step 1: Replace the current plain cards with structured product-console cards**

Replace `apps/docs/src/app/docs/page.tsx` with:

```tsx
import { docsScopes } from '@/lib/docs-shell';
import { IconArrowRight, IconChevronRight } from '@tabler/icons-react';
import Link from 'next/link';

export default function DocsOverviewPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-3">
        <p className="text-sm font-medium text-blue-600 dark:text-blue-300">Documentation</p>
        <h1 className="text-3xl font-semibold tracking-tight text-fd-foreground sm:text-4xl">
          Browse Z8 guides by scope
        </h1>
        <p className="max-w-3xl text-base text-fd-muted-foreground">
          Start with the area that matches your role or task, then jump into the most common guides from there.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {docsScopes.map(
          ({ scope, title, description, url, audience, accentClassName, iconClassName, icon: Icon, quickLinks }) => (
            <section
              key={scope}
              className="group relative overflow-hidden rounded-2xl border border-fd-border bg-fd-card/95 p-6 shadow-sm transition-transform duration-200 hover:-translate-y-0.5"
            >
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br ${accentClassName}`} />

              <div className="relative flex h-full flex-col gap-5">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="inline-flex rounded-full border border-fd-border bg-fd-background/80 px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-fd-muted-foreground backdrop-blur-sm">
                      {title}
                    </span>

                    <span className={`inline-flex size-11 items-center justify-center rounded-xl border border-fd-border bg-fd-background/90 shadow-sm ${iconClassName}`}>
                      <Icon className="size-5" />
                    </span>
                  </div>

                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold tracking-tight text-fd-foreground">{title}</h2>
                    <p className="text-sm font-medium text-fd-foreground/80">{audience}</p>
                    <p className="text-sm leading-6 text-fd-muted-foreground">{description}</p>
                  </div>
                </div>

                <div className="mt-auto space-y-4">
                  <Link
                    className="inline-flex w-fit items-center gap-2 rounded-xl border border-fd-border bg-fd-background px-3.5 py-2 text-sm font-semibold text-fd-foreground shadow-sm transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
                    href={url}
                  >
                    Open {title}
                    <IconArrowRight className="size-4" />
                  </Link>

                  <div className="space-y-2 border-t border-fd-border/80 pt-4">
                    {quickLinks.map((link) => (
                      <Link
                        key={link.url}
                        className="flex items-center justify-between gap-3 text-sm text-fd-muted-foreground transition-colors hover:text-fd-foreground"
                        href={link.url}
                      >
                        <span>{link.label}</span>
                        <IconChevronRight className="size-4 text-fd-muted-foreground/70" />
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ),
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run the docs build to verify the redesigned overview page**

Run: `pnpm build`

Workdir: `apps/docs`

Expected: the build succeeds, `/docs` is generated, and the updated overview page compiles without MDX or TypeScript issues.

- [ ] **Step 3: Confirm the primary scope links and quick links still resolve**

Run:

```bash
curl -I http://127.0.0.1:3002/docs && curl -I http://127.0.0.1:3002/docs/guide && curl -I http://127.0.0.1:3002/docs/desktop && curl -I http://127.0.0.1:3002/docs/tech
```

Workdir: `apps/docs`

Expected: each URL returns `200 OK` when the local docs dev server is running.

- [ ] **Step 4: Commit the overview-card redesign**

Run:

```bash
git add apps/docs/src/app/docs/page.tsx
git commit -m "feat: polish docs overview cards"
```

Expected: a commit containing only the overview page redesign.

### Task 3: Final Verification

**Files:**
- Verify only: `apps/docs`

- [ ] **Step 1: Run the final docs build**

Run: `pnpm build`

Workdir: `apps/docs`

Expected: a clean docs production build with `/docs`, `/docs/guide`, `/docs/desktop`, and `/docs/tech` still present.

- [ ] **Step 2: Confirm the worktree state after the final commit**

Run: `git status --short`

Workdir: repository root

Expected: no uncommitted changes related to the overview-card task.
