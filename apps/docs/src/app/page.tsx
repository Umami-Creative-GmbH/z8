import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Z8 Docs',
  description: 'Documentation for Z8 time tracking, desktop workflows, and technical operations.',
};

export default function HomePage() {
  redirect('/docs');
}
