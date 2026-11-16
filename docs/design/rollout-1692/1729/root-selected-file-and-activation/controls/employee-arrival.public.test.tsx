// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { EmployeeFileWorkspace } from '@/components/personnel-file/employee-file-workspace';
import { PersonnelFilesWorkspace } from '@/components/personnel-file/personnel-files-workspace';

const boundary = vi.hoisted(() => ({
 scope: { userId: 'officer', activeOrganizationId: 'org-a' },
 session: { data: { user: { id: 'officer' }, session: { activeOrganizationId: 'org-a' } }, isPending: false },
 listeners: new Set<(value: any) => void>(),
}));
vi.mock('@/components/providers/organization-context-provider', () => ({ useOrganization: () => boundary.scope }));
vi.mock('@/lib/auth-client', () => ({ useSession: () => boundary.session, authClient: { $store: { atoms: { session: { subscribe: (listener: (value: any) => void) => { boundary.listeners.add(listener); return () => boundary.listeners.delete(listener); } } } } } }));
vi.mock('@tolgee/react', () => ({ useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/navigation', () => ({ Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
const employee = { id: 'target-a', name: 'Previously admitted employee A', employeeNumber: 'P-17', isActive: true };
const selected = () => <EmployeeFileWorkspace userId="officer" organizationId="org-a" employee={employee}><button type="button">Previously admitted document task</button></EmployeeFileWorkspace>;
const directoryProps = { readId: 'completed-server-read-a', userId: 'officer', organizationId: 'org-a', employees: [{...employee, name: 'Directory completed read A'}], capability: { payslipBatches: false, documentRequests: true, sickLeave: false, officerSettings: false }, attention: <p>Directory completed attention A</p> };
beforeEach(() => { boundary.scope = { userId: 'officer', activeOrganizationId: 'org-a' }; boundary.session = { data: { user: { id: 'officer' }, session: { activeOrganizationId: 'org-a' } }, isPending: false }; boundary.listeners.clear(); });

it('control: selected route hides admitted identity and task during a visible organization mismatch', () => {
 const view = render(selected());
 boundary.scope.activeOrganizationId = 'org-b'; view.rerender(selected());
 expect(screen.queryByText(employee.name)).toBeNull();
 expect(screen.queryByRole('button', { name: 'Previously admitted document task' })).toBeNull();
 expect(screen.getByRole('heading', { level: 1, name: 'Personnel file' })).toBeTruthy();
});
it('control: preserved #1728 directory refuses its retired server read after organization return', () => {
 const view = render(<PersonnelFilesWorkspace {...directoryProps}/>);
 boundary.scope.activeOrganizationId = 'org-b'; view.rerender(<PersonnelFilesWorkspace {...directoryProps}/>);
 boundary.scope.activeOrganizationId = 'org-a'; view.rerender(<PersonnelFilesWorkspace {...directoryProps}/>);
 expect(screen.queryByText('Directory completed read A')).toBeNull();
 expect(screen.queryByText('Directory completed attention A')).toBeNull();
});
it.each(['organization', 'account'])('selected route must not revive the same completed %s read and tasks after scope return', change => {
 const view = render(selected());
 if (change === 'organization') boundary.scope.activeOrganizationId = 'org-b'; else boundary.scope.userId = 'other-account';
 view.rerender(selected());
 expect(screen.queryByText(employee.name)).toBeNull();
 boundary.scope = { userId: 'officer', activeOrganizationId: 'org-a' }; view.rerender(selected());
 expect(screen.queryByText(employee.name)).toBeNull();
 expect(screen.queryByRole('button', { name: 'Previously admitted document task' })).toBeNull();
});
it('selected route must hide previously displayed identity and tasks while session proof becomes pending', () => {
 const view = render(selected());
 boundary.session.isPending = true; view.rerender(selected());
 expect(screen.queryByText(employee.name)).toBeNull();
 expect(screen.queryByRole('button', { name: 'Previously admitted document task' })).toBeNull();
});
