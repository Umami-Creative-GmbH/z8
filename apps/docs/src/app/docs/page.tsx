import { docsScopes } from '@/lib/docs-shell';
import Link from 'next/link';

export default function DocsOverviewPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-3">
        <p className="text-sm font-medium text-blue-600 dark:text-blue-300">Documentation</p>
        <h1 className="text-3xl font-semibold tracking-tight text-fd-foreground sm:text-4xl">
          Browse Z8 guides by scope
        </h1>
        <p className="max-w-3xl text-base text-fd-muted-foreground">
          Start with the area that matches your role or task, then jump into the most common guides from there.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {docsScopes.map(({ scope, title, description, url, audience, accentClassName, icon: Icon, quickLinks }) => (
          <section key={scope} className="rounded-xl border border-fd-border bg-fd-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span
                className={`flex size-10 items-center justify-center rounded-lg bg-fd-muted ${accentClassName}`}
              >
                <Icon className="size-5" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-fd-foreground">{title}</h2>
                <p className="text-sm text-fd-muted-foreground">{audience}</p>
              </div>
            </div>

            <p className="mt-4 text-sm leading-6 text-fd-muted-foreground">{description}</p>

            <div className="mt-5 flex flex-col gap-2">
              <Link className="text-sm font-medium text-fd-foreground hover:underline" href={url}>
                Open {title}
              </Link>
              {quickLinks.map((link) => (
                <Link
                  key={link.url}
                  className="text-sm text-fd-muted-foreground hover:text-fd-foreground hover:underline"
                  href={link.url}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
