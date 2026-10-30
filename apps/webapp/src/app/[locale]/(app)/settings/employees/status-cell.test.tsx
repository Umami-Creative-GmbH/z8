/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeDirectoryRow } from "./employee-action-types";
import { StatusCell } from "./status-cell";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

function row(fields: { isActive: boolean; isFormer?: boolean; formerSince?: string | null }) {
	return { id: "employee-1", kind: "employee", ...fields } as EmployeeDirectoryRow;
}

describe("employee directory status (#1438, #1439)", () => {
	it.each([
		["a current employee", { isActive: true, isFormer: false }, "Current"],
		[
			"a deactivated employee",
			{ isActive: false, isFormer: true, formerSince: "2026-10-12" },
			"Former since Oct 12, 2026",
		],
		[
			"an employee past a due departure",
			{ isActive: true, isFormer: true, formerSince: "2026-03-01" },
			"Former since Mar 1, 2026",
		],
		[
			"a former employee whose date isn't recorded",
			{ isActive: false, isFormer: true, formerSince: null },
			"Former · date not recorded",
		],
		["a deactivation made on this page", { isActive: false }, "Former"],
	])("labels %s", (_label, fields, expected) => {
		render(<StatusCell employee={row(fields)} />);

		expect(screen.getByText(expected)).toBeTruthy();
	});
});
