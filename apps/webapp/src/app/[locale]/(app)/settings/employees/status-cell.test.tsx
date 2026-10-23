/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeDirectoryRow } from "./employee-action-types";
import { StatusCell } from "./status-cell";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function row(fields: { isActive: boolean; isFormer?: boolean }) {
	return { id: "employee-1", kind: "employee", ...fields } as EmployeeDirectoryRow;
}

describe("employee directory status (#1438)", () => {
	it.each([
		["a current employee", { isActive: true, isFormer: false }, "Current"],
		["a deactivated employee", { isActive: false, isFormer: true }, "Former"],
		["an employee past a due departure", { isActive: true, isFormer: true }, "Former"],
		["a deactivation made on this page", { isActive: false }, "Former"],
	])("labels %s", (_label, fields, expected) => {
		render(<StatusCell employee={row(fields)} />);

		expect(screen.getByText(expected)).toBeTruthy();
	});
});
