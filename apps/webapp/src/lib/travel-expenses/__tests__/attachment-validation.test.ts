import { describe, expect, it } from "vitest";
import {
	ALLOWED_TRAVEL_EXPENSE_MIME_TYPES,
	isAllowedTravelExpenseMime,
} from "@/lib/travel-expenses/attachment-validation";

describe("travel-expense attachment mime validation", () => {
	it("accepts allowed mime types", () => {
		expect(ALLOWED_TRAVEL_EXPENSE_MIME_TYPES).toContain("application/pdf");
		expect(isAllowedTravelExpenseMime("application/pdf")).toBe(true);
		expect(isAllowedTravelExpenseMime("image/jpeg")).toBe(true);
		expect(isAllowedTravelExpenseMime("image/png")).toBe(true);
		expect(isAllowedTravelExpenseMime("image/webp")).toBe(true);
		expect(isAllowedTravelExpenseMime("image/gif")).toBe(true);
		expect(isAllowedTravelExpenseMime("image/bmp")).toBe(true);
		expect(isAllowedTravelExpenseMime("image/tiff")).toBe(true);
	});

	it("rejects unsupported mime types", () => {
		expect(isAllowedTravelExpenseMime("text/plain")).toBe(false);
		expect(isAllowedTravelExpenseMime("application/zip")).toBe(false);
		expect(isAllowedTravelExpenseMime("image/svg+xml")).toBe(false);
		expect(isAllowedTravelExpenseMime("application/octet-stream")).toBe(false);
	});
});
