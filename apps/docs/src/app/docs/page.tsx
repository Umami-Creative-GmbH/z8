import { docsScopes } from '@/lib/docs-shell';
import { IconArrowRight, IconChevronRight } from '@tabler/icons-react';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata = {
  title: 'Z8 Documentation',
  description: 'Browse Z8 product, desktop, and technical documentation by scope.',
} satisfies Metadata;

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
              className="group relative overflow-hidden rounded-2xl border border-fd-border bg-fd-card/95 p-5 shadow-sm transition-transform duration-200 hover:-translate-y-0.5 sm:p-6"
            >
              <div className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br ${accentClassName}`} />

              <div className="relative flex flex-col gap-5">
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="inline-flex rounded-full border border-fd-border bg-fd-background/80 px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-fd-muted-foreground backdrop-blur-sm">
                      {scope}
                    </span>

                    <span className={`inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-fd-border bg-fd-background/90 shadow-sm ${iconClassName}`}>
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                  </div>

                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold tracking-tight text-fd-foreground">{title}</h2>
                    <p className="text-sm font-medium leading-6 text-fd-foreground/80">{audience}</p>
                    <p className="text-sm leading-6 text-fd-muted-foreground">{description}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <Link
                    className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-xl border border-fd-border bg-fd-background px-3.5 py-2 text-sm font-semibold text-fd-foreground shadow-sm transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background sm:w-fit"
                    href={url}
                  >
                    Open {title}
                    <IconArrowRight aria-hidden="true" className="size-4" />
                  </Link>

                  <div className="space-y-1 border-t border-fd-border/80 pt-3 sm:space-y-2 sm:pt-4">
                    {quickLinks.map((link) => (
                      <Link
                        key={link.url}
                        className="flex min-h-11 touch-manipulation items-center justify-between gap-3 rounded-lg px-1 text-sm text-fd-muted-foreground transition-colors hover:bg-fd-accent/60 hover:text-fd-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:ring-offset-2 focus-visible:ring-offset-fd-background sm:min-h-0 sm:px-0 sm:hover:bg-transparent"
                        href={link.url}
                      >
                        <span>{link.label}</span>
                        <IconChevronRight aria-hidden="true" className="size-4 shrink-0 text-fd-muted-foreground/70" />
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
