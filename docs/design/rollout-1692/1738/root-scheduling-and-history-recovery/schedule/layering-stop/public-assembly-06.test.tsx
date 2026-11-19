/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TolgeeProvider } from "@tolgee/react";
import { Activity } from "react";
import { act as preactAct } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider";
import { ShiftScheduler } from "@/components/scheduling/scheduler/shift-scheduler";
import { ThemeProvider } from "@/components/theme-provider";
import { createTestTolgee } from "@/test/render-with-translations";

// Explicit action transport and authenticated caller-context boundary. No internal hook,
// query state, component or scheduler/calendar implementation is replaced or preloaded.
const transport = vi.hoisted(() => ({
	coverage: vi.fn(),
	shifts: vi.fn(),
	templates: vi.fn(),
	compliance: vi.fn(),
	publish: vi.fn(),
	upsert: vi.fn(),
	remove: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/scheduling/actions", () => ({
	getShifts: transport.shifts,
	getShiftTemplates: transport.templates,
	getScheduleComplianceSummary: transport.compliance,
	getPendingShiftRequests: async () => ({ success: true, data: [] }),
	getLocationsWithSubareas: async () => ({ success: true, data: [] }),
	suggestStaffingForShift: async () => ({ success: true, data: [] }),
	publishShifts: transport.publish,
	upsertShift: transport.upsert,
	deleteShift: transport.remove,
	approveShiftRequest: vi.fn(),
	rejectShiftRequest: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/coverage-rules/actions", () => ({
	getTargetHeatmapData: transport.coverage,
}));
vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	listEmployeesForSelect: async () => ({ success: true, data: { employees: [] } }),
}));
vi.mock("@/app/[locale]/(app)/settings/skills/actions", () => ({
	validateEmployeeForShift: vi.fn(),
}));

const clients: QueryClient[] = [];
const draft = {
	id: "synthetic-shift-a",
	organizationId: "synthetic-org-a",
	employeeId: null,
	status: "draft",
	date: new Date("2026-11-15T23:00:00Z"),
	startTime: "09:00",
	endTime: "17:00",
	templateId: null,
	subareaId: "synthetic-reception",
	recurrenceId: null,
	publishedAt: null,
	publishedBy: null,
	notes: null,
	color: null,
	createdAt: new Date("2026-11-01T00:00:00Z"),
	updatedAt: new Date("2026-11-01T00:00:00Z"),
	createdBy: "synthetic-planner",
	subarea: {
		id: "synthetic-reception",
		name: "Reception",
		location: { id: "synthetic-office", name: "Office" },
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	transport.shifts.mockResolvedValue({ success: true, data: [draft] });
	transport.templates.mockResolvedValue({ success: true, data: [] });
	transport.compliance.mockResolvedValue({
		success: true,
		data: { summary: { totalFindings: 0 } },
	});
});

afterEach(async () => {
	preactAct(() => cleanup());
	for (const client of clients.splice(0)) client.clear();
	await new Promise((resolve) => setTimeout(resolve, 50));
	vi.unstubAllGlobals();
});

function mountPlanner() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
	clients.push(client);
	const draw = (employeeId = "synthetic-planner-a", organizationId = "synthetic-org-a", isManager = true, mode: "visible" | "hidden" = "visible") => (
		<TolgeeProvider tolgee={createTestTolgee()}>
			<ThemeProvider defaultTheme="light" enableSystem={false}>
				<UserPreferencesProvider timezone="Europe/Berlin" weekStartDay="monday">
					<QueryClientProvider client={client}>
						<Activity mode={mode}><ShiftScheduler
							organizationId={organizationId}
							organizationTimezone="Europe/Berlin"
							employeeId={employeeId}
							isManager={isManager}
							focusEmployeeId={null}
							focusDate="2026-11-16"
						/>
					</Activity></QueryClientProvider>
				</UserPreferencesProvider>
			</ThemeProvider>
		</TolgeeProvider>
	);
	const view = render(draw());
	return { client, view, draw };
}

async function observe() {
	const mounted = mountPlanner();
	const { client } = mounted;
	const publish = await screen.findByRole("button", { name: "Publish (1)" });
	if (!(publish instanceof HTMLButtonElement)) throw Error("Expected native Publish button");
	await waitFor(() => expect(transport.coverage).toHaveBeenCalled());
	await waitFor(() => expect(client.isFetching()).toBe(0));
	const user = userEvent.setup();
	await user.hover(publish);
	await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).toBeTruthy());
	const tooltip = document.querySelector('[data-slot="tooltip-content"]');
	if (!tooltip) throw Error("Expected visible publish description");
	const alerts = screen.queryAllByRole("alert").map((element) => element.textContent);
	const coverageErrors = alerts.filter((text) => /coverage|staffing/i.test(text ?? ""));
	const receipt = {
		coverageCalls: transport.coverage.mock.calls.length,
		publishEnabled: !publish.disabled,
		tooltip: tooltip.textContent,
		alerts,
		coverageErrorCount: coverageErrors.length,
		retryButtons: screen.queryAllByRole("button", { name: /retry/i }).length,
		visibleBodyText: document.body.textContent,
		writes: {
			publish: transport.publish.mock.calls.length,
			upsert: transport.upsert.mock.calls.length,
			remove: transport.remove.mock.calls.length,
		},
		boundary:
			"real ShiftScheduler/QueryClient/provider/hooks/overlay/PublishFab; mocked action transport and admitted caller props; jsdom, no browser or server-authorization claim",
	};
	return { receipt, coverageErrors, ...mounted };
}

const healthyUnder = (count=1) => ({success:true,data:Array.from({length:count},(_,i)=>({date:new Date('2026-11-16T00:00:00Z'),subareaId:`synthetic-area-${i}`,subareaName:`Synthetic area ${i}`,locationName:'Synthetic office',status:'under',gapCount:1,utilizationPercent:0,totalRequired:1,totalActual:0,totalShortfall:1}))});
const deferred = () => { let resolve: (value:unknown)=>void=()=>{}; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; };
const noWrites = () => {expect(transport.publish).not.toHaveBeenCalled();expect(transport.upsert).not.toHaveBeenCalled();expect(transport.remove).not.toHaveBeenCalled();};
async function publishDescription() { const user=userEvent.setup(); const b=screen.getByRole('button',{name:'Publish (1)'});await user.unhover(b);await user.hover(b);await waitFor(()=>expect(document.querySelector('[data-slot="tooltip-content"]')).toBeTruthy());return document.querySelector('[data-slot="tooltip-content"]')?.textContent; }

it('independent: hiding failed coverage cannot advertise healthy empty publishing',async()=>{
 transport.coverage.mockResolvedValue({success:false,error:'Synthetic first-read refusal'});
 const {client}=await observe();
 await userEvent.setup().click(screen.getByRole('button',{name:'Coverage'}));
 expect(screen.queryByRole('alert')).toBeNull();
 expect(await publishDescription()).toContain('Coverage is unavailable');
 expect(await publishDescription()).not.toContain('Publish 1 draft shift and notify employees');
 expect(transport.coverage).toHaveBeenCalledTimes(1);expect(client.isFetching()).toBe(0);noWrites();
});

it('independent: first held coverage is loading until its own successful result',async()=>{
 const pending=deferred();transport.coverage.mockReturnValue(pending.promise);
 const {client}=mountPlanner();
 try { await screen.findByRole('button',{name:'Publish (1)'});await waitFor(()=>expect(transport.coverage).toHaveBeenCalledTimes(1));
 expect(screen.getByText('Loading coverage…')).toBeTruthy();expect(await publishDescription()).toContain('Coverage is loading');
 expect(screen.queryByText('Coverage Summary:')).toBeNull();noWrites();
 } finally {await act(async()=>pending.resolve(healthyUnder(2)));await waitFor(()=>expect(client.isFetching()).toBe(0));}
 expect(screen.getByText(/^2 understaffed/)).toBeTruthy();expect(await publishDescription()).toContain('minimum staffing requirements');noWrites();
});

it('independent: retained failed coverage Retry coalesces both observers and rejects then recovers',async()=>{
 transport.coverage.mockResolvedValue(healthyUnder(2));const {client}=await observe();
 transport.coverage.mockResolvedValue({success:false,error:'Synthetic refresh failure'});
 await act(async()=>{await client.invalidateQueries({queryKey:['coverage']});});
 await screen.findByRole('alert');expect(screen.getByText('Last loaded coverage')).toBeTruthy();
 const held=deferred();transport.coverage.mockReturnValue(held.promise);
 const retry=screen.getByRole('button',{name:'Retry'});
 fireEvent.click(retry);fireEvent.click(retry);
 try {await waitFor(()=>expect(transport.coverage).toHaveBeenCalledTimes(3));await waitFor(()=>expect(screen.getByRole('button',{name:'Retry'}).hasAttribute('disabled')).toBe(true));expect(screen.getByText(/^2 understaffed/)).toBeTruthy();noWrites();}
 finally {await act(async()=>held.resolve({success:false,error:'Synthetic retry refusal'}));await waitFor(()=>expect(client.isFetching()).toBe(0));}
 expect(screen.getByRole('button',{name:'Retry'}).hasAttribute('disabled')).toBe(false);
 transport.coverage.mockResolvedValue({success:true,data:[]});await userEvent.setup().click(screen.getByRole('button',{name:'Retry'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());expect(screen.queryByText('Last loaded coverage')).toBeNull();expect(screen.queryByText(/^2 understaffed/)).toBeNull();expect(await publishDescription()).toContain('Publish 1 draft shift and notify employees');noWrites();
});

it('independent: late actor A coverage cannot replace actor B or employee view',async()=>{
 const old=deferred();transport.coverage.mockReturnValueOnce(old.promise).mockResolvedValue(healthyUnder(2));
 const {client,view,draw}=mountPlanner();await screen.findByRole('button',{name:'Publish (1)'});await waitFor(()=>expect(transport.coverage).toHaveBeenCalledTimes(1));
 view.rerender(draw('synthetic-planner-b'));
 await screen.findByText(/^2 understaffed/);
 await act(async()=>old.resolve(healthyUnder(5)));await waitFor(()=>expect(client.isFetching()).toBe(0));
 expect(screen.queryByText(/^5 understaffed/)).toBeNull();expect(screen.getByText(/^2 understaffed/)).toBeTruthy();
 transport.shifts.mockResolvedValue({success:true,data:[]});view.rerender(draw('synthetic-planner-b','synthetic-org-a',false));
 await waitFor(()=>expect(client.isFetching()).toBe(0));expect(screen.queryByRole('button',{name:'Publish (1)'})).toBeNull();expect(screen.queryByRole('button',{name:'Coverage'})).toBeNull();expect(screen.queryByText(/^2 understaffed/)).toBeNull();noWrites();
});

it('independent: org A to B to A uses matching fresh coverage after retired result',async()=>{
 const old=deferred();transport.coverage.mockReturnValueOnce(old.promise).mockResolvedValueOnce(healthyUnder(2)).mockResolvedValue(healthyUnder(3));
 const {client,view,draw}=mountPlanner();await screen.findByRole('button',{name:'Publish (1)'});await waitFor(()=>expect(transport.coverage).toHaveBeenCalledTimes(1));
 view.rerender(draw('synthetic-planner-a','synthetic-org-b'));await screen.findByText(/^2 understaffed/);
 await act(async()=>old.resolve(healthyUnder(5)));await waitFor(()=>expect(client.isFetching()).toBe(0));expect(screen.queryByText(/^5 understaffed/)).toBeNull();
 view.rerender(draw());await screen.findByText(/^3 understaffed/);expect(screen.queryByText(/^2 understaffed/)).toBeNull();noWrites();
});

it('independent: supporting Retry remains pending until templates and compliance both settle',async()=>{
 transport.coverage.mockResolvedValue({success:true,data:[]});const {client}=await observe();
 transport.templates.mockResolvedValue({success:false,error:'Synthetic template refusal'});transport.compliance.mockResolvedValue({success:false,error:'Synthetic compliance refusal'});
 await act(async()=>{await client.invalidateQueries();});await screen.findByRole('alert');
 const template=deferred(), compliance=deferred();transport.templates.mockReturnValue(template.promise);transport.compliance.mockReturnValue(compliance.promise);
 const t0=transport.templates.mock.calls.length,c0=transport.compliance.mock.calls.length;
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));fireEvent.click(screen.getByRole('button',{name:/Retry/}));
 try {await waitFor(()=>expect(transport.templates).toHaveBeenCalledTimes(t0+1));expect(transport.compliance).toHaveBeenCalledTimes(c0+1);
 await act(async()=>template.resolve({success:true,data:[]}));await waitFor(()=>expect(screen.getByRole('button',{name:'Retry'}).hasAttribute('disabled')).toBe(true));noWrites();}
 finally {await act(async()=>{template.resolve({success:true,data:[]});compliance.resolve({success:true,data:{summary:{totalFindings:0}}});});await waitFor(()=>expect(client.isFetching()).toBe(0));}
 await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());noWrites();
});

it('independent: Activity return preserves one held Publish command and disabled duplicate control',async()=>{
 transport.coverage.mockResolvedValue({success:true,data:[]});const held=deferred();transport.publish.mockReturnValue(held.promise);
 const {client,view,draw}=await observe();await userEvent.setup().click(screen.getByRole('button',{name:'Publish (1)'}));
 await waitFor(()=>expect(transport.publish).toHaveBeenCalledTimes(1));
 try {view.rerender(draw('synthetic-planner-a','synthetic-org-a',true,'hidden'));view.rerender(draw());
 await waitFor(()=>expect(screen.getByRole('button',{name:'Publishing…'}).hasAttribute('disabled')).toBe(true));fireEvent.click(screen.getByRole('button',{name:'Publishing…'}));expect(transport.publish).toHaveBeenCalledTimes(1);expect(transport.upsert).not.toHaveBeenCalled();expect(transport.remove).not.toHaveBeenCalled();}
 finally {await act(async()=>held.resolve({success:true,data:{count:1,published:true,requiresAcknowledgment:false}}));await waitFor(()=>expect(client.isFetching()).toBe(0));}
 await screen.findByRole('button',{name:'Publish (1)'});expect(transport.publish).toHaveBeenCalledTimes(1);
});

it('independent: actual edit form retains notes and pending reservation through Activity then refusal',async()=>{
 transport.coverage.mockResolvedValue({success:true,data:[]});const held=deferred();transport.upsert.mockReturnValue(held.promise);
 const {view,draw}=await observe();fireEvent.click(screen.getByRole('button',{name:/Reception/}));await screen.findByRole('dialog',{name:'Edit Shift'});
 fireEvent.change(screen.getByLabelText(/Notes/),{target:{value:'Synthetic retained scheduling note'}});
 const save=screen.getByRole('button',{name:'Update Shift'});const form=save.closest('form');if(!form)throw Error('No actual edit form');
 fireEvent.submit(form);await waitFor(()=>expect(transport.upsert).toHaveBeenCalledTimes(1));
 try {view.rerender(draw('synthetic-planner-a','synthetic-org-a',true,'hidden'));view.rerender(draw());
 fireEvent.submit(form);fireEvent.keyDown(document,{key:'Escape',code:'Escape'});expect(transport.upsert).toHaveBeenCalledTimes(1);expect(screen.getByRole('dialog',{name:'Edit Shift'})).toBeTruthy();}
 finally {await act(async()=>held.resolve({success:false,error:'Synthetic domain refusal'}));}
 await waitFor(()=>expect(screen.getByRole('button',{name:'Update Shift'}).hasAttribute('disabled')).toBe(false));expect(screen.getByDisplayValue('Synthetic retained scheduling note')).toBeTruthy();expect(transport.publish).not.toHaveBeenCalled();expect(transport.remove).not.toHaveBeenCalled();
});
