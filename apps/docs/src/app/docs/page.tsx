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
