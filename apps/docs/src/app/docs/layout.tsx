import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { IconBook, IconCode } from '@tabler/icons-react';
import type { ReactNode } from 'react';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: 'Z8 Docs',
        url: '/docs',
      }}
      sidebar={{
        tabs: {
          transform(option, node) {
            // Add colored icons based on the root folder
            if (option.url?.startsWith('/docs/guide')) {
              return {
                ...option,
                icon: <IconBook className="size-5 text-blue-500" />,
              };
            }
            if (option.url?.startsWith('/docs/tech')) {
              return {
                ...option,
                icon: <IconCode className="size-5 text-red-400" />,
              };
            }
            return option;
          },
        },
      }}
    >
      {children}
    </DocsLayout>
  );
}
