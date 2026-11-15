/* @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('@tolgee/react',()=>({useTranslate:()=>({t:(_key:string,fallback:string)=>fallback})}));
vi.mock('@/lib/auth-client',()=>({useSession:()=>({data:null,isPending:true})}));
vi.mock('@/hooks/use-push-notifications',()=>({usePushNotifications:vi.fn()}));
vi.mock('@/navigation',()=>({useRouter:()=>({push:vi.fn()}),Link:({children}:{children:import('react').ReactNode})=><a href="/sign-in">{children}</a>}));
vi.mock('@/components/onboarding/progress-indicator',()=>({ProgressIndicator:()=>null}));
vi.mock('@/app/[locale]/onboarding/notifications/actions',()=>({configureNotificationsOnboarding:vi.fn(),skipNotificationsSetup:vi.fn()}));
import NotificationsPage from '@/app/[locale]/onboarding/notifications/page-client';
it('keeps one safe task heading while the authenticated account is loading',()=>{
 render(<NotificationsPage/>);
 expect(screen.getByRole('status')).toBeTruthy();
 expect(screen.queryAllByRole('switch')).toHaveLength(0);
 expect(screen.queryAllByRole('heading',{level:1})).toHaveLength(1);
});
