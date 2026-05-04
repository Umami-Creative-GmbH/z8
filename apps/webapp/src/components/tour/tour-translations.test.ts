import { readFileSync } from "node:fs";
import { join } from "node:path";
import extractor from "../../../tolgee-extractor.mjs";
import { TOUR_STEP_DEFINITIONS } from "./tour-steps";

describe("tour translations", () => {
	it("extracts every tour title and description key with English defaults", () => {
		const source = readFileSync(join(process.cwd(), "src/components/tour/tour-steps.ts"), "utf8");
		const extractedKeys = extractor(source, "src/components/tour/tour-steps.ts").keys;
		const extractedByKey = new Map(
			extractedKeys.map((key) => [key.keyName, { defaultValue: key.defaultValue, namespace: key.namespace }]),
		);

		const missingKeys = TOUR_STEP_DEFINITIONS.flatMap((step) => [step.titleKey, step.descriptionKey]).filter(
			(key) => !extractedByKey.has(key),
		);

		const incorrectDefaults = TOUR_STEP_DEFINITIONS.flatMap((step) => [
			{ defaultValue: step.titleDefault, key: step.titleKey },
			{ defaultValue: step.descriptionDefault, key: step.descriptionKey },
		]).filter((expected) => extractedByKey.get(expected.key)?.defaultValue !== expected.defaultValue);

		const wrongNamespaces = TOUR_STEP_DEFINITIONS.flatMap((step) => [step.titleKey, step.descriptionKey]).filter(
			(key) => extractedByKey.get(key)?.namespace !== "common",
		);

		expect(missingKeys).toEqual([]);
		expect(incorrectDefaults).toEqual([]);
		expect(wrongNamespaces).toEqual([]);
	});
});
