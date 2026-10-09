import { describe, expect, it } from "vitest";
import { getAccountingProviderRegistry } from "../registry";
import { LEXWARE_OFFICE_CAPABILITIES } from "./connector";

describe("Lexware Office registration", () => {
	it("is a production accounting connector admins can connect", () => {
		const registry = getAccountingProviderRegistry();
		expect(registry.availableKinds()).toContain("lexware_office");
		expect(registry.get("lexware_office")).toMatchObject({
			kind: "lexware_office",
			capabilities: LEXWARE_OFFICE_CAPABILITIES,
		});
	});
});
