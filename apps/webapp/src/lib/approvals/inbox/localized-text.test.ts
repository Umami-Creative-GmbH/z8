import { describe, expect, it } from "vitest";
import { localizedTextFallback, resolveLocalizedText } from "./localized-text";
import type { ApprovalInboxLocalizedText } from "./types";

const dayLine: ApprovalInboxLocalizedText = {
	key: "approvals:approvals.evidence.perDiemLocation",
	fallback: "{label}",
	params: {
		label: {
			perDiemLocation: {
				country: "IT",
				place: "mailand",
				label: "Italien – Mailand",
			},
		},
	},
};

function english(_key: string, fallback: string, params?: Record<string, string | number>) {
	return fallback.replace(/\{(\w+)\}/g, (match, name: string) =>
		params && name in params ? String(params[name]) : match,
	);
}

describe("resolveLocalizedText", () => {
	it("names a per diem location in the reader's language (#681)", () => {
		expect(resolveLocalizedText(dayLine, english, "en")).toBe("Italy – Milan");
		expect(resolveLocalizedText(dayLine, english, "de")).toBe("Italien – Mailand");
		expect(localizedTextFallback(dayLine)).toBe("Italy – Milan");
	});
});
