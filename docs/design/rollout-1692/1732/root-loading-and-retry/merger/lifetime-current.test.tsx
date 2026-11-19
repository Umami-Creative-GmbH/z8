// @vitest-environment jsdom
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { PayslipBatchStart } from "../../payslip-batch-start";
import { PayslipBatchesScope } from "../../payslip-batches-scope";

const boundary = vi.hoisted(() => ({
	start: vi.fn(),
	push: vi.fn(),
	toastError: vi.fn(),
	scope: {
		userId: "actor",
		activeOrganizationId: "org-a",
		isLoading: false,
		error: null as string | null,
	},
}));
vi.mock("sonner", () => ({ toast: { error: boundary.toastError } }));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => boundary.scope,
}));
vi.mock("@/app/[locale]/(app)/personnel-files/payslip-batches/actions", () => ({
	startPayslipBatchAction: boundary.start,
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ push: boundary.push }) }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
const scope = { userId: "actor", organizationId: "org-a" };
const props = {
	defaultPayPeriod: { year: 2026, month: 11 },
	expectedScope: scope,
};

beforeEach(() => {
	vi.clearAllMocks();
	boundary.scope = {
		userId: "actor",
		activeOrganizationId: "org-a",
		isLoading: false,
		error: null,
	};
});


it.each(['loading','error'])('MERGE1732 retires validation-queued work when %s hides current scope',async(change)=>{
 boundary.start.mockResolvedValue({success:true,data:{id:'stale'}});
 const page=()=> <PayslipBatchesScope {...scope}><PayslipBatchStart {...props}/></PayslipBatchesScope>;
 const view=render(page());
 fireEvent.click(screen.getByRole('button',{name:'Start batch'}));
 boundary.scope={...boundary.scope,...(change==='loading'?{isLoading:true}:{error:'unavailable'})};
 view.rerender(page());
 boundary.scope={userId:'actor',activeOrganizationId:'org-a',isLoading:false,error:null};
 view.rerender(page());
 await act(async()=>{await new Promise(done=>setTimeout(done,30));});
 expect(boundary.start).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Start batch'}));
 await waitFor(()=>expect(boundary.start).toHaveBeenCalledTimes(1));
});
it('MERGE1732 suppresses rejected late scope response and allows the remounted form',async()=>{
 let reject!: (error:unknown)=>void;
 boundary.start.mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
 const page=()=> <PayslipBatchesScope {...scope}><PayslipBatchStart {...props}/></PayslipBatchesScope>;
 const view=render(page());
 fireEvent.click(screen.getByRole('button',{name:'Start batch'}));
 await waitFor(()=>expect(boundary.start).toHaveBeenCalledTimes(1));
 boundary.scope={...boundary.scope,activeOrganizationId:'org-b'};view.rerender(page());
 boundary.scope={...boundary.scope,activeOrganizationId:'org-a'};view.rerender(page());
 await act(async()=>reject(new Error('late offline')));
 expect(screen.queryByRole('alert')).toBeNull();expect(boundary.push).not.toHaveBeenCalled();expect(boundary.toastError).not.toHaveBeenCalled();
 expect(screen.getByRole('button',{name:'Start batch'}).hasAttribute('disabled')).toBe(false);
});
it('MERGE1732 retires a pending Activity session before a fresh start while retaining draft',async()=>{
 let finish!:(value:unknown)=>void;
 boundary.start.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const page=(mode:'visible'|'hidden')=><Activity mode={mode}><PayslipBatchStart {...props}/></Activity>;
 const view=render(page('visible'));
 fireEvent.change(screen.getByRole('textbox',{name:/Pay period year/}),{target:{value:'2025'}});
 fireEvent.click(screen.getByRole('button',{name:'Start batch'}));
 await waitFor(()=>expect(boundary.start).toHaveBeenCalledTimes(1));
 view.rerender(page('hidden'));view.rerender(page('visible'));
 const current=screen.getByRole('button',{name:'Start batch'});
 const observation={disabled:current.hasAttribute('disabled'),retained:(screen.getByRole('textbox',{name:/Pay period year/}) as HTMLInputElement).value};
 console.log('MERGE1732 pending-session observation',JSON.stringify(observation));
 try {expect(observation.disabled).toBe(false);} finally {await act(async()=>finish({success:false,error:'Old result'}));}
 expect(screen.queryByRole('alert')).toBeNull();expect(boundary.toastError).not.toHaveBeenCalled();expect(observation.retained).toBe('2025');
});
