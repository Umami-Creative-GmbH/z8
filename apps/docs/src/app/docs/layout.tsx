import { source } from '@/lib/source';
import { DocsNavTitle, docsTabs } from '@/lib/docs-shell';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      tabs={docsTabs}
      nav={{
        title: <DocsNavTitle />,
        url: '/docs',
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
