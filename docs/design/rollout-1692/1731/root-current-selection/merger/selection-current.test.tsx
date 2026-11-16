// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { DueDocumentsResult } from "@/lib/personnel-file/retention-store";
import { DueForDeletionList } from "../../due-for-deletion-list";

const boundary = vi.hoisted(() => ({
	read: vi.fn(),
	purge: vi.fn(),
	scope: {
		userId: "actor",
		activeOrganizationId: "org",
		employeeId: "self",
		isLoading: false,
		error: null,
	},
}));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => boundary.scope,
}));
vi.mock("@/app/[locale]/(app)/personnel-files/retention-actions", () => ({
	getDueForDeletionAction: boundary.read,
	purgeDueDocumentsAction: boundary.purge,
}));
vi.mock("@/components/providers/app-locale-provider", () => ({
	useAppLocale: () => "en-GB",
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match)),
	}),
}));

const due = {
	id: "due",
	employeeId: "former",
	employeeName: "Former Person",
	employeeNumber: "0042",
	category: "payslip" as const,
	title: "Retained payslip",
	documentDate: "2018-12-31",
	payPeriod: { year: 2018, month: 12 },
	retentionYears: 6,
	retentionStart: "2020-01-01",
	dueOn: "2026-01-01",
};
const unknown = {
	id: "unknown",
	employeeId: "legacy",
	employeeName: "Legacy Person",
	employeeNumber: null,
	category: "other" as const,
	title: "Unknown end",
	documentDate: "2015-01-01",
	payPeriod: null,
	retentionYears: 2,
};
const data: DueDocumentsResult = {
	today: "2026-11-15",
	documents: [due],
	unknownStart: [unknown],
};
function mount() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const tree = (mode: "visible" | "hidden" = "visible") => (
		<QueryClientProvider client={client}>
			<Activity mode={mode}>
				<DueForDeletionList />
			</Activity>
		</QueryClientProvider>
	);
	const rendered = render(tree());
	return {
		...rendered,
		client,
		show: (mode: "visible" | "hidden" = "visible") => rendered.rerender(tree(mode)),
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	boundary.scope = {
		userId: "actor",
		activeOrganizationId: "org",
		employeeId: "self",
		isLoading: false,
		error: null,
	};
	boundary.read.mockResolvedValue({ success: true, data });
	boundary.purge.mockResolvedValue({
		success: false,
		error: "Permission changed. Review your scope.",
	});
});


it("MERGE1731 fresh records remain selectable after all 500 selected records leave the refreshed result", async () => {
 const oldDocuments=Array.from({length:500},(_,i)=>({...due,id:'retired-'+i,title:'Old retained '+i}));
 boundary.read.mockResolvedValueOnce({success:true,data:{...data,documents:oldDocuments,unknownStart:[]}});
 const view=mount();
 await screen.findByText('Old retained 0');
 const selectAll=screen.getByRole('checkbox',{name:/Select due documents|Select all/});
 fireEvent.click(selectAll);
 const fresh={...due,id:'new-due',title:'Newly due record'};
 boundary.read.mockResolvedValue({success:true,data:{...data,documents:[fresh],unknownStart:[]}});
 await act(async()=>{await view.client.invalidateQueries();});
 await screen.findByText(fresh.title);
 const freshCheckbox=screen.getAllByRole('checkbox').find(node=>node!==screen.getByRole('checkbox',{name:/Select due documents|Select all/}))!;
 const clear=screen.queryByRole('button',{name:'Clear selection'});
 const before={freshCheckboxDisabled:freshCheckbox.hasAttribute('disabled')||freshCheckbox.getAttribute('aria-disabled')==='true'||freshCheckbox.hasAttribute('data-disabled'),clearPresent:clear!==null,clearDisabled:clear?.hasAttribute('disabled')??null,zeroCountVisible:screen.queryByText('Selected: 0 of 500 maximum')!==null};
 fireEvent.click(freshCheckbox);
 const selectedAfterIndividual=freshCheckbox.getAttribute('aria-checked');
 fireEvent.click(freshCheckbox);
 fireEvent.click(screen.getByRole('checkbox',{name:/Select due documents|Select all/}));
 const selectedAfterSelectAll=freshCheckbox.getAttribute('aria-checked');
 console.log('MERGE1731 selection recovery',JSON.stringify({...before,selectedAfterIndividual,selectedAfterSelectAll}));
 expect(before.freshCheckboxDisabled,JSON.stringify({...before,selectedAfterIndividual,selectedAfterSelectAll,freshCheckboxHtml:freshCheckbox.outerHTML,clearHtml:clear?.outerHTML??null})).toBe(false);
 expect(selectedAfterIndividual).toBe('true');
 expect(selectedAfterSelectAll).toBe('true');
});
