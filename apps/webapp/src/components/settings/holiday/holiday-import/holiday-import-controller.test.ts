/* @vitest-environment jsdom */

import { readFile } from "node:fs/promises";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as controller from "./holiday-import-controller";
import * as helpers from "./holiday-import-helpers";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

const { runHolidayImport } = controller;

describe("holiday import controller request state", () => {
	it("does not expose close as an Effect Event to normal callbacks", async () => {
		const source = await readFile(
			"src/components/settings/holiday/holiday-import/holiday-import-controller.ts",
			"utf8",
		);

		expect(source).not.toContain("const close = useEffectEvent");
	});

	it("avoids redundant callbacks and chained holiday transformations", async () => {
		const source = await readFile(
			"src/components/settings/holiday/holiday-import/holiday-import-controller.ts",
			"utf8",
		);

		expect(source).not.toContain("useCallback");
		expect(source).not.toMatch(
			/holidays\.filter\(\(holiday\) => !holiday\.isDuplicate\)\.map\(getHolidayIdentity\)/,
		);
		expect(source).not.toMatch(
			/state\.holidays\s*\.filter\([\s\S]*?\.map\([\s\S]*?\.filter\(/,
		);
	});

	it("initializes request version guards only on mount", () => {
		const createRequestVersionGuard = vi.spyOn(helpers, "createRequestVersionGuard");
		const { rerender } = renderHook(() =>
			controller.useHolidayImportController({
				open: false,
				organizationId: "org-1",
				onOpenChange: vi.fn(),
				onSuccess: vi.fn(),
			}),
		);

		rerender();

		expect(createRequestVersionGuard).toHaveBeenCalledTimes(2);
	});

	it("invalidates location and preview requests before closing", () => {
		const calls: string[] = [];
		const locationRequests = {
			start: vi.fn(() => 1),
			invalidate: vi.fn(() => calls.push("location")),
			isCurrent: vi.fn(() => true),
		};
		const previewRequests = {
			start: vi.fn(() => 1),
			invalidate: vi.fn(() => calls.push("preview")),
			isCurrent: vi.fn(() => true),
		};
		vi.spyOn(helpers, "createRequestVersionGuard")
			.mockReturnValueOnce(locationRequests)
			.mockReturnValueOnce(previewRequests);
		const onOpenChange = vi.fn(() => calls.push("close"));
		const { result } = renderHook(() =>
			controller.useHolidayImportController({
				open: true,
				organizationId: "org-1",
				onOpenChange,
				onSuccess: vi.fn(),
			}),
		);

		act(() => result.current.close());

		expect(locationRequests.invalidate).toHaveBeenCalledOnce();
		expect(previewRequests.invalidate).toHaveBeenCalledOnce();
		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(calls).toEqual(["location", "preview", "close"]);
	});

	it("clears preview loading when invalidating an in-flight preview request", () => {
		const invalidate = vi.fn();
		const set = vi.fn();

		controller.invalidatePreviewRequests({ invalidate }, set);

		expect(invalidate).toHaveBeenCalledOnce();
		expect(set).toHaveBeenCalledWith("previewLoading", false);
	});

	it("clears region loading when invalidating an in-flight region request", () => {
		const invalidate = vi.fn();
		const set = vi.fn();

		controller.invalidateLocationRequests({ invalidate }, set);

		expect(invalidate).toHaveBeenCalledOnce();
		expect(set).toHaveBeenCalledWith("regionsLoading", false);
	});

	it("invalidates a preview before changing its year or holiday types", () => {
		const calls: string[] = [];
		const invalidate = vi.fn(() => calls.push("invalidate"));
		const set = vi.fn((key: string) => calls.push(`set:${key}`));

		controller.changePreviewInput({ invalidate }, set, "selectedYear", 2027);
		controller.changePreviewInput({ invalidate }, set, "selectedTypes", ["public", "bank"]);

		expect(calls).toEqual([
			"invalidate",
			"set:previewLoading",
			"set:selectedYear",
			"invalidate",
			"set:previewLoading",
			"set:selectedTypes",
		]);
	});
});

describe("runHolidayImport", () => {
	it("completes a successful holiday import when the default assignment fails", async () => {
		const createPreset = vi.fn().mockResolvedValue({ success: true, data: { id: "preset-1" } });
		const addHolidays = vi.fn().mockResolvedValue({ success: true });
		const createAssignment = vi
			.fn()
			.mockResolvedValue({ success: false, error: "Assignment failed" });
		const warning = vi.fn();
		const success = vi.fn();
		const onSuccess = vi.fn();
		const onClose = vi.fn();

		const result = await runHolidayImport({
			organizationId: "org-1",
			preset: {
				name: "Germany 2026",
				description: "",
				countryCode: "DE",
				year: 2026,
				color: "#4F46E5",
				isActive: true,
			},
			holidays: [
				{
					name: "New Year",
					description: "",
					month: 1,
					day: 1,
					durationDays: 1,
					holidayType: "public",
					isFloating: false,
					isActive: true,
				},
			],
			setAsOrgDefault: true,
			messages: {
				assignmentWarning: "Preset created but could not set as organization default",
				success: 'Created preset "Germany 2026" with 1 holidays',
			},
			actions: { createPreset, addHolidays, createAssignment },
			toast: { error: vi.fn(), warning, success },
			onSuccess,
			onClose,
		});

		expect(result).toEqual({ success: true });
		expect(addHolidays).toHaveBeenCalledWith("preset-1", expect.any(Array));
		expect(createAssignment).toHaveBeenCalledWith(
			"org-1",
			expect.objectContaining({ presetId: "preset-1", assignmentType: "organization" }),
		);
		expect(warning).toHaveBeenCalledWith(
			"Preset created but could not set as organization default",
		);
		expect(success).toHaveBeenCalledWith('Created preset "Germany 2026" with 1 holidays');
		expect(onSuccess).toHaveBeenCalledOnce();
		expect(onClose).toHaveBeenCalledOnce();
	});
});
