import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const dir = '.tmp/1733-root-checks/runtime';
const target = 'apps/webapp/src/components/personnel-file/independent1733-command-probe.test.tsx';
assert.ok(!existsSync(target));
let source = readFileSync('apps/webapp/src/components/personnel-file/payslip-batch-workspace-scope.test.tsx','utf8').replaceAll('\r\n','\n');
source = source.replace('import type { ReactNode } from "react";', 'import { Activity, type ReactNode } from "react";');
source = source.replace('const tree = () => (', 'const tree = (mode: "visible" | "hidden" = "visible") => (');
source = source.replace('\n\t\t\t\t{content}\n', '\n\t\t\t\t<Activity mode={mode}>{content}</Activity>\n');
assert.ok(source.includes('<Activity mode={mode}>{content}</Activity>'));
source += `

function readyPreview(): PayslipBatchPreview {
  return {
    ...preview,
    employees: [{ id: "employee", name: "Employee One", employeeNumber: "100", teamId: null, teamName: null, isActive: true }],
    files: [{ id: "file", fileName: "100.pdf", sizeBytes: 100, matchKind: "matched", matchedEmployeeIds: ["employee"], assignedEmployeeId: null, employeeId: "employee", included: true, state: "staged", failure: null, alreadyHasPayslip: false }],
  };
}

it.each([false, true])("prevents a duplicate pending confirmation with Activity resume=%s", async (resume) => {
  const pending: ((value: unknown) => void)[] = [];
  boundary.get.mockResolvedValue({ success: true, data: readyPreview() });
  boundary.confirm.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const subject = setup();
  try {
    fireEvent.click(await screen.findByRole("button", { name: "Save 1 payslips" }));
    expect(boundary.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
    await waitFor(() => expect(boundary.confirm).toHaveBeenCalledTimes(1));
    expect(pending).toHaveLength(1);
    const first = screen.getByRole("button", { name: "Save payslips" });
    expect(first.hasAttribute("disabled")).toBe(true);
    fireEvent.click(first);
    expect(boundary.confirm).toHaveBeenCalledTimes(1);
    if (resume) {
      subject.view.rerender(subject.tree("hidden"));
      subject.view.rerender(subject.tree("visible"));
      await waitFor(() => expect(boundary.get.mock.calls.length).toBeGreaterThanOrEqual(2));
      const reopen = await screen.findByRole("button", { name: "Save 1 payslips" });
      await waitFor(() => expect(reopen.hasAttribute("disabled")).toBe(false));
      // First promise remains unsettled; perform a second ordinary public confirmation.
      expect(pending).toHaveLength(1);
      fireEvent.click(reopen);
      fireEvent.click(screen.getByRole("button", { name: "Save payslips" }));
    }
    expect(boundary.confirm).toHaveBeenCalledTimes(1);
    expect(pending).toHaveLength(1);
  } finally {
    subject.view.unmount();
    await act(async () => { for (const resolve of pending) resolve({ success: false, error: "Synthetic command settled after observation" }); });
    subject.client.clear();
  }
});
`;
writeFileSync(dir+'/command-probe.test.tsx',source);
writeFileSync(target,source);

const headingTarget='apps/webapp/src/components/personnel-file/independent1733-heading-probe.test.tsx';
assert.ok(!existsSync(headingTarget));
let heading=readFileSync('apps/webapp/src/components/personnel-file/payslip-batches-loading.test.tsx','utf8').replaceAll('\r\n','\n');
heading=heading.slice(0,heading.indexOf('it("keeps one safe'));
heading=heading.replace('payslip-batches/page"','payslip-batches/[batchId]/page"');
heading=heading.replace('"/en/personnel-files/payslip-batches"','"/en/personnel-files/payslip-batches/9f6c3b8f-f024-48f1-a15d-58a1e9c5c08d"');
heading=heading.replace('import { PayslipBatchesScope } from "./payslip-batches-scope";', '');
heading+=`
it("renders one safe h1 from the actual detail Page fallback alongside SiteHeader", () => {
  const fallback = Page({ params: Promise.resolve({ batchId: "9f6c3b8f-f024-48f1-a15d-58a1e9c5c08d" }) }).props.fallback;
  render(<><SiteHeader /><main>{fallback}</main></>);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1, name: "Payslip batch" })).toBeTruthy();
  expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
  expect(screen.queryByLabelText("Payslip files")).toBeNull();
  expect(screen.queryByRole("button", { name: "Save payslips" })).toBeNull();
});
`;
writeFileSync(dir+'/heading-probe.test.tsx',heading);
writeFileSync(headingTarget,heading);
writeFileSync(dir+'/bridge-ownership.json',JSON.stringify({files:[target,headingTarget], policy:'Only exact generated owned bytes may be removed'},null,2)+'\n');
