/* @vitest-environment jsdom */

import { useForm } from "@tanstack/react-form";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	SurchargeRuleEditor,
	type SurchargeRuleFormValues,
} from "./surcharge-rule-editor";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		value,
		onChange,
	}: {
		value: string;
		onChange: (value: string) => void;
	}) => (
		<input
			data-testid="date-field"
			value={value}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));

function RuleEditorHarness({ rule }: { rule: SurchargeRuleFormValues }) {
	const form = useForm({ defaultValues: { rules: [rule] } });
	return <SurchargeRuleEditor form={form} onRemove={vi.fn()} ruleIndex={0} />;
}

const baseRule = {
	name: "Night premium",
	description: null,
	percentage: 0.5,
	priority: 0,
	validFrom: null,
	validUntil: null,
	isActive: true,
} as const;

describe("SurchargeRuleEditor", () => {
	it("preserves time-window form values and percentage scaling", () => {
		render(
			<RuleEditorHarness
				rule={{
					...baseRule,
					ruleType: "time_window",
					windowStartTime: "22:15",
					windowEndTime: "06:30",
				}}
			/>,
		);

		expect(screen.getByDisplayValue("Night premium")).toBeTruthy();
		expect(screen.getByDisplayValue("50")).toBeTruthy();
		expect(
			screen
				.getAllByDisplayValue("22:15")
				.some((input) => input.getAttribute("aria-hidden") !== "true"),
		).toBe(true);
		expect(
			screen
				.getAllByDisplayValue("06:30")
				.some((input) => input.getAttribute("aria-hidden") !== "true"),
		).toBe(true);
	});

	it("adapts date-only rule values through UTC Date boundaries", () => {
		render(
			<RuleEditorHarness
				rule={{
					...baseRule,
					ruleType: "date_based",
					specificDate: new Date("2026-12-24T00:00:00.000Z"),
					dateRangeStart: new Date("2026-12-20T00:00:00.000Z"),
					dateRangeEnd: new Date("2026-12-31T00:00:00.000Z"),
				}}
			/>,
		);

		expect(
			screen
				.getAllByTestId("date-field")
				.map((input) => input.getAttribute("value")),
		).toEqual(["2026-12-24", "2026-12-20", "2026-12-31"]);
	});
});
