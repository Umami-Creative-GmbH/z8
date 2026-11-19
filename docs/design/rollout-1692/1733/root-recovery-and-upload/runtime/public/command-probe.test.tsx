// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import type { PayslipBatchPreview } from "@/lib/personnel-file/payslip-batch-store";
import { queryKeys } from "@/lib/query/keys";
import { PayslipBatchWorkspace } from "./payslip-batch-workspace";
import { PayslipBatchesScope } from "./payslip-batches-scope";

const boundary = vi.hoisted(() => ({
	get: vi.fn(),
	confirm: vi.fn(),
	update: vi.fn(),
	fetch: vi.fn(),
 success: vi.fn(), error: vi.fn(),
	noop: () => {},
	session: {
		data: { user: { id: "actor" }, session: { activeOrganizationId: "org" } },
		isPending: false,
	},
}));

vi.mock("sonner", () => ({toast:{success:boundary.success,error:boundary.error}}));
vi.mock("@/lib/auth-client", () => ({ useSession: () => boundary.session }));
vi.mock("@/lib/fetch", async (original) => ({
	...(await original<typeof import("@/lib/fetch")>()),
	fetchApi: boundary.fetch,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ replace: boundary.noop }),
}));
vi.mock("@/stores/organization-settings-store", () => ({
	OrganizationSettingsStoreProvider: ({ children }: { children: ReactNode }) => children,
	useOrganizationSettings: (selector: (store: unknown) => unknown) =>
		selector({ hydrate: boundary.noop, reset: boundary.noop }),
}));
vi.mock("@/app/[locale]/(app)/personnel-files/payslip-batches/actions", () => ({
	getPayslipBatchAction: boundary.get,
	confirmPayslipBatchAction: boundary.confirm,
	updatePayslipBatchFileAction: boundary.update,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key: string) => String(values?.[key] ?? match)),
	}),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({
	useAppLocale: () => "en",
}));
vi.mock("./use-payslip-batch-upload", () => ({
	usePayslipBatchUpload: () => ({
		addFiles: boundary.noop,
		isUploading: false,
		progress: { total: 0, staged: 0, failed: [] },
	}),
}));

const contextResponse = {
	user: { id: "actor" },
	session: { activeOrganizationId: "org" },
	employee: null,
	organizationSettings: null,
};
const preview: PayslipBatchPreview = {
	batch: {
		id: "batch",
		payPeriod: { year: 2026, month: 11 },
		visibility: "shared",
		status: "open",
		createdAt: "2026-11-15T12:00:00Z",
		confirmedAt: null,
	},
	files: [],
	employees: [],
};

function setup(
	content: ReactNode = (
		<PayslipBatchWorkspace batchId="batch" userId="actor" organizationId="org" />
	),
) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const initialContext = {
		userId: "actor",
		organizationId: "org",
		employee: null,
		organizationSettings: null,
		updatedAt: Date.now(),
	};
	const tree = (mode: "visible" | "hidden" = "visible") => (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={initialContext}>
				<Activity mode={mode}>{content}</Activity>
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
	const view = render(tree());
	return {
		client,
		tree,
		view,
		cleanup: () => {
			view.unmount();
			client.clear();
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	boundary.session = {
		data: { user: { id: "actor" }, session: { activeOrganizationId: "org" } },
		isPending: false,
	};
	boundary.fetch.mockResolvedValue(contextResponse);
	boundary.get.mockResolvedValue({ success: true, data: preview });
});

it("keeps an admitted matching session usable while its session refresh is pending", async () => {
	const subject = setup();
	try {
		await screen.findByText("No files yet.");
		boundary.session.isPending = true;
		subject.view.rerender(subject.tree());
		expect(screen.getByText("No files yet.")).toBeTruthy();
	} finally {
		subject.cleanup();
	}
});

it("recovers the batch through local organization Retry after the real provider read fails", async () => {
	const subject = setup();
	try {
		await screen.findByText("No files yet.");
		boundary.fetch.mockRejectedValueOnce(new Error("Internal read diagnostics"));
		await act(async () => {
			await subject.client.refetchQueries({
				queryKey: queryKeys.organizationContext.current("actor", "org"),
				exact: true,
			});
		});
		await waitFor(() => expect(screen.queryByText("No files yet.")).toBeNull());
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("Your current organization could not be confirmed.");
		expect(alert.textContent).not.toContain("Internal read diagnostics");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("No files yet.");
		expect(boundary.fetch).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole("alert")).toBeNull();
	} finally {
		subject.cleanup();
	}
});

it("preserves the start-page control through the same provider failure and Retry", async () => {
	const subject = setup(
		<PayslipBatchesScope userId="actor" organizationId="org">
			<p>Admitted start-page records</p>
		</PayslipBatchesScope>,
	);
	try {
		await screen.findByText("Admitted start-page records");
		boundary.fetch.mockRejectedValueOnce(new Error("Internal read diagnostics"));
		await act(async () => {
			await subject.client.refetchQueries({
				queryKey: queryKeys.organizationContext.current("actor", "org"),
				exact: true,
			});
		});
		await screen.findByRole("alert");
		expect(screen.queryByText("Admitted start-page records")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		await screen.findByText("Admitted start-page records");
		expect(boundary.fetch).toHaveBeenCalledTimes(2);
	} finally {
		subject.cleanup();
	}
});


function readyPreview(): PayslipBatchPreview {
  return {
    ...preview,
    employees: [{ id: "employee", name: "Employee One", employeeNumber: "100", teamId: null, teamName: null, isActive: true }],
    files: [{ id: "file", fileName: "100.pdf", sizeBytes: 100, matchKind: "matched", matchedEmployeeIds: ["employee"], assignedEmployeeId: null, employeeId: "employee", included: true, state: "staged", failure: null, alreadyHasPayslip: false }],
  };
}


const scenarios = ["confirm", "edit"].flatMap(kind => ["success", "refusal", "rejection"].flatMap(outcome => ["hidden", "resumed"].map(settlement => ({kind,outcome,settlement}))));
it.each(scenarios)("independent $kind / $outcome / settle-$settlement guards requests until current readback", async ({kind,outcome,settlement}) => {
 let complete: ((v:unknown)=>void)|undefined, reject: ((e:Error)=>void)|undefined, read: ((v:unknown)=>void)|undefined;
 const action=kind==="confirm"?boundary.confirm:boundary.update;
 const fresh=readyPreview();fresh.files[0].fileName="authoritative.pdf";
 boundary.get.mockResolvedValue({success:true,data:readyPreview()});
 action.mockImplementationOnce(()=>new Promise((yes,no)=>{complete=yes;reject=no;}));
 action.mockResolvedValue({success:false,error:"Fresh deliberate refusal"});
 const sub=setup();
 const start=async()=>{
   if(kind==="confirm"){
     fireEvent.click(await screen.findByRole("button",{name:"Save 1 payslips"}));
     const decision=screen.queryByRole("button",{name:"Save payslips"});if(decision)fireEvent.click(decision);
   }else fireEvent.click(await screen.findByRole("checkbox",{name:/Include (100|authoritative)\.pdf/}));
 };
 try {
   await start();await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));
   sub.view.rerender(sub.tree("hidden"));sub.view.rerender(sub.tree("visible"));
   await waitFor(()=>expect(boundary.get).toHaveBeenCalledTimes(2));await waitFor(()=>expect(sub.client.isFetching()).toBe(0));
   const save=screen.getByRole("button",{name:"Save 1 payslips"});expect(save.hasAttribute("disabled")).toBe(true);
   fireEvent.click(save);const decision=screen.queryByRole("button",{name:"Save payslips"});if(decision)fireEvent.click(decision);
   expect(action).toHaveBeenCalledTimes(1);expect(kind==="confirm"?boundary.update:boundary.confirm).not.toHaveBeenCalled();
   if(settlement==="hidden")sub.view.rerender(sub.tree("hidden"));
   boundary.get.mockImplementationOnce(()=>new Promise(yes=>{read=yes;}));
   await act(async()=>{
     if(outcome==="rejection")reject!(new Error("Retired private diagnostic"));
     else complete!(outcome==="refusal"?{success:false,error:"Retired refusal"}:{success:true,data:{batch:readyPreview().batch,created:[],failed:[]}});
   });
   if(settlement==="hidden"){
     expect(boundary.get).toHaveBeenCalledTimes(2);sub.view.rerender(sub.tree("visible"));
   }
   await waitFor(()=>expect(read).toBeTypeOf("function"));
   expect(action).toHaveBeenCalledTimes(1);expect(screen.queryByText("authoritative.pdf")).toBeNull();
   const whileRead=screen.getByRole("button",{name:"Save 1 payslips"});expect(whileRead.hasAttribute("disabled")).toBe(true);fireEvent.click(whileRead);
   expect(action).toHaveBeenCalledTimes(1);
   await act(async()=>read!({success:true,data:fresh}));await screen.findByText("authoritative.pdf");
   await waitFor(()=>expect(screen.getByRole("button",{name:"Save 1 payslips"}).hasAttribute("disabled")).toBe(false));
   expect(boundary.success).not.toHaveBeenCalled();expect(boundary.error).not.toHaveBeenCalled();expect(screen.queryByRole("alert")).toBeNull();
   expect(action).toHaveBeenCalledTimes(1);await start();await waitFor(()=>expect(action).toHaveBeenCalledTimes(2));
 } finally {sub.view.unmount();await act(async()=>{complete?.({success:false,error:"Cleanup"});read?.({success:true,data:fresh});});sub.client.clear();}
});
it.each(["confirm","edit"])("independent %s failed retired readback gates stale preview and uses local Retry",async kind=>{
 let finish:((v:unknown)=>void)|undefined;
 boundary.get.mockResolvedValue({success:true,data:readyPreview()});
 const action=kind==="confirm"?boundary.confirm:boundary.update;
 action.mockImplementationOnce(()=>new Promise(yes=>finish=yes));const sub=setup();
 try {
   if(kind==="confirm"){fireEvent.click(await screen.findByRole("button",{name:"Save 1 payslips"}));fireEvent.click(screen.getByRole("button",{name:"Save payslips"}));}
   else fireEvent.click(await screen.findByRole("checkbox",{name:"Include 100.pdf"}));
   await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));sub.view.rerender(sub.tree("hidden"));sub.view.rerender(sub.tree("visible"));
   await waitFor(()=>expect(boundary.get).toHaveBeenCalledTimes(2));await waitFor(()=>expect(sub.client.isFetching()).toBe(0));
   boundary.get.mockResolvedValueOnce({success:false,error:"Authoritative read failed"});
   await act(async()=>finish!({success:false,error:"Retired refusal"}));
   expect((await screen.findByRole("alert")).textContent).toContain("The payslip batch could not be loaded.");
   expect(screen.queryByText("100.pdf")).toBeNull();expect(screen.queryByRole("button",{name:"Save 1 payslips"})).toBeNull();
   fireEvent.click(screen.getByRole("button",{name:"Retry"}));await screen.findByText("100.pdf");
   await waitFor(()=>expect(sub.client.isFetching()).toBe(0));expect(action).toHaveBeenCalledTimes(1);
   expect(boundary.error).not.toHaveBeenCalled();expect(boundary.success).not.toHaveBeenCalled();
 } finally {sub.view.unmount();await act(async()=>finish?.({success:false,error:"Cleanup"}));sub.client.clear();}
});
