import { RootProvider } from 'fumadocs-ui/provider';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Z8 Documentation',
  description: 'Documentation for the Z8 Team Management System',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
