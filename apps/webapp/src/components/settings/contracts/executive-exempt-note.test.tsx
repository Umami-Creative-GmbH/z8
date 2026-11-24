/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, describe, expect, it } from "vitest";
import { createTestTolgee } from "@/test/render-with-translations";
import deCatalog from "../../../../messages/settings/workPolicies/de.json";
import enCatalog from "../../../../messages/settings/workPolicies/en.json";
import { ExecutiveExemptNote } from "./executive-exempt-note";

/** `{ a: { b: "x" } }` → `{ "a.b": "x" }`, the keys the note asks for. */
function flatten(value: unknown, prefix = ""): Record<string, string> {
	if (typeof value === "string") return { [prefix]: value };
	return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
		(all, [key, child]) => Object.assign(all, flatten(child, prefix ? `${prefix}.${key}` : key)),
		{},
	);
}

function show(locale: "en" | "de") {
	const catalog = flatten(locale === "de" ? deCatalog : enCatalog);
	return render(
		<TolgeeProvider tolgee={createTestTolgee(locale, catalog)}>
			<ExecutiveExemptNote />
		</TolgeeProvider>,
	);
}

describe("ExecutiveExemptNote (#2023)", () => {
	afterEach(cleanup);

	it("says what executive exempt switches off and that youth protection still applies", () => {
		show("en");

		expect(
			screen.getByText(
				"Executive exempt (leitende Angestellte as defined in § 5 Abs. 3 BetrVG, § 18 Abs. 1 Nr. 1 ArbZG): no adult ArbZG checks, automatic break deductions or break reminders. Use it only for employees who meet that definition; team leads and other managers usually do not. Youth protection (JArbSchG) still applies while the employee is under 18.",
			),
		).toBeTruthy();
	});

	it("says the same in German", () => {
		show("de");

		expect(
			screen.getByText(
				"Leitende Angestellte (§ 18 Abs. 1 Nr. 1 ArbZG): keine Prüfung der ArbZG-Grenzen für Erwachsene, kein automatischer Pausenabzug und keine Pausenerinnerungen. Der Jugendarbeitsschutz (JArbSchG) gilt weiter, solange die Person unter 18 ist.",
			),
		).toBeTruthy();
	});
});
