/* @vitest-environment jsdom */

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentRequestsInBulkAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
import type { SelectableEmployee } from "@/components/employee-select";
import type { DocumentRequestRecipientOptions } from "@/lib/personnel-file/document-request-overview";
import { render } from "@/test/render-with-translations";
import { BulkDocumentRequestsDialog } from "./merge1730-baseline-bulk";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/action-panel", () => {
	const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
	return {
		ActionPanel: ({ children, open }: { children?: ReactNode; open: boolean }) =>
			open ? <div>{children}</div> : null,
		ActionPanelBody: Pass,
		ActionPanelContent: Pass,
		ActionPanelDescription: Pass,
		ActionPanelFooter: Pass,
		ActionPanelHeader: Pass,
		ActionPanelTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
	};
});
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({ value, onChange }: { value?: string | null; onChange: (v: string) => void }) => (
		<input
			aria-label="Deadline picker"
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));
// The employee picker is a searchable modal; a checkbox per offered employee stands in for it.
vi.mock("@/components/employee-select", () => ({
	EmployeeMultiSelect: ({
		label,
		value,
		onChange,
		employees = [],
		error,
	}: {
		label: string;
		value: string[];
		onChange: (value: string[]) => void;
		employees?: SelectableEmployee[];
		error?: string;
	}) => (
		<fieldset aria-invalid={error ? true : undefined}>
			<legend>{label}</legend>
			{error ? <p>{error}</p> : null}
			{employees.map((employee) => (
				<label key={employee.id}>
					<input
						type="checkbox"
						checked={value.includes(employee.id)}
						onChange={(event) =>
							onChange(
								event.target.checked
									? [...value, employee.id]
									: value.filter((id) => id !== employee.id),
							)
						}
					/>
					{employee.user.name}
				</label>
			))}
		</fieldset>
	),
}));
vi.mock("@/app/[locale]/(app)/personnel-files/document-request-actions", () => ({
	createDocumentRequestsInBulkAction: vi.fn(),
}));

const certificateOptions: DocumentRequestRecipientOptions = {
	certificate: {
		employees: [
			{ id: "anna", name: "Anna Example" },
			{ id: "dana", name: "Dana Example" },
		],
		teams: [
			{ id: "berlin", name: "Berlin" },
			{ id: "hamburg", name: "Hamburg" },
		],
	},
	other: { employees: [], teams: [] },
};

function renderDialog(options: DocumentRequestRecipientOptions = certificateOptions) {
	const onCreated = vi.fn();
	const onOpenChange = vi.fn();
	render(
		<BulkDocumentRequestsDialog
			open
			onOpenChange={onOpenChange}
			options={options}
			today="2026-10-18"
			onCreated={onCreated}
		/>,
	);
	return { onCreated, onOpenChange };
}

function fillRequest() {
	fireEvent.change(screen.getByRole("textbox", { name: /^Title/ }), {
		target: { value: "First aid refresher" },
	});
	fireEvent.change(screen.getByRole("textbox", { name: "Note (optional)" }), {
		target: { value: "Please upload the new card." },
	});
	fireEvent.change(screen.getByLabelText("Deadline picker"), { target: { value: "2026-11-30" } });
}

beforeEach(() => {
	vi.mocked(toast.error).mockReset();
	vi.mocked(toast.success).mockReset();
	vi.mocked(createDocumentRequestsInBulkAction).mockReset();
});


const refusal={success:false, error:"Refused", code:"too_many_recipients"} as const;
it("MERGE1730 normal bulk submit reaches the public action exactly once", async () => {
 let finish!: (value:any)=>void;
 vi.mocked(createDocumentRequestsInBulkAction).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 renderDialog();fireEvent.click(screen.getByRole("switch",{name:"Berlin"}));fillRequest();
 fireEvent.click(screen.getByRole("button",{name:"Request"}));
 await waitFor(()=>expect(createDocumentRequestsInBulkAction).toHaveBeenCalledTimes(1));
 await act(async()=>finish(refusal));
 expect(screen.getByRole("alert").textContent).toContain("at most 500");
});
it("MERGE1730 same-turn queued Cancel and duplicates remain reserved", async () => {
 let finish!: (value:any)=>void;
 vi.mocked(createDocumentRequestsInBulkAction).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const {onOpenChange}=renderDialog();fireEvent.click(screen.getByRole("switch",{name:"Berlin"}));fillRequest();
 const form=screen.getByRole("button",{name:"Request"}).closest("form")!;
 act(()=>{fireEvent.submit(form);fireEvent.click(screen.getByRole("button",{name:"Cancel"}));fireEvent.submit(form);});
 await waitFor(()=>expect(createDocumentRequestsInBulkAction).toHaveBeenCalledTimes(1));
 expect(onOpenChange).not.toHaveBeenCalled();
 await act(async()=>finish(refusal));
});
it("MERGE1730 retires a submit queued before Activity hides and reconnects", async () => {
 let finish: ((value:any)=>void)|undefined;
 vi.mocked(createDocumentRequestsInBulkAction).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const onCreated=vi.fn(),onOpenChange=vi.fn();
 const child=<BulkDocumentRequestsDialog open onOpenChange={onOpenChange} options={certificateOptions} today="2026-10-18" onCreated={onCreated}/>;
 const rendered=render(<Activity mode="visible">{child}</Activity>);
 fireEvent.click(screen.getByRole("switch",{name:"Berlin"}));fillRequest();
 const form=screen.getByRole("button",{name:"Request"}).closest("form")!;
 let beforeRetirement=-1;
 act(()=>{
  fireEvent.submit(form);
  beforeRetirement=vi.mocked(createDocumentRequestsInBulkAction).mock.calls.length;
  flushSync(()=>rendered.rerender(<Activity mode="hidden">{child}</Activity>));
  flushSync(()=>rendered.rerender(<Activity mode="visible">{child}</Activity>));
 });
 await act(async()=>{await Promise.resolve();await Promise.resolve();});
 const afterReconnect=vi.mocked(createDocumentRequestsInBulkAction).mock.calls.length;
 console.log("MERGE1730 bulk lifecycle",JSON.stringify({beforeRetirement,afterReconnect}));
 if(finish)await act(async()=>finish!(refusal));
 expect(beforeRetirement).toBe(0);
 expect(afterReconnect).toBe(0);
 expect(onCreated).not.toHaveBeenCalled();
});
