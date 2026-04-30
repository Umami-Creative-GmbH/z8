import { describe, expect, it } from "vitest";
import extractor from "../tolgee-extractor.mjs";

describe("tolgee extractor", () => {
	it("uses adjacent fallback values for data-driven key properties", () => {
		const result = extractor(
			`
			export const STEPS = [{
				titleKey: "tour.sidebar.title",
				titleDefault: "Navigate Z8",
				descriptionKey: "tour.sidebar.description",
				descriptionDefault: "Use the sidebar to move around.",
			}];
		`,
			"tour-steps.ts",
		);

		expect(result.keys).toEqual([
			expect.objectContaining({
				defaultValue: "Navigate Z8",
				keyName: "tour.sidebar.title",
				namespace: "common",
			}),
			expect.objectContaining({
				defaultValue: "Use the sidebar to move around.",
				keyName: "tour.sidebar.description",
				namespace: "common",
			}),
		]);
	});
});
