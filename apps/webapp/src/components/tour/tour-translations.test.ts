import commonMessages from "../../../messages/common/en.json";
import { TOUR_STEP_DEFINITIONS } from "./tour-steps";

function getNestedValue(source: unknown, path: string): unknown {
	return path.split(".").reduce<unknown>((value, segment) => {
		if (!value || typeof value !== "object") return undefined;
		return (value as Record<string, unknown>)[segment];
	}, source);
}

describe("tour translations", () => {
	it("has English messages for every tour title and description key", () => {
		const missingKeys = TOUR_STEP_DEFINITIONS.flatMap((step) => [
			step.titleKey,
			step.descriptionKey,
		]).filter((key) => typeof getNestedValue(commonMessages, key) !== "string");

		expect(missingKeys).toEqual([]);
	});
});
