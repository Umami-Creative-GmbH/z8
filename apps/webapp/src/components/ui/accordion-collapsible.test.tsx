/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion";
import { Button } from "./button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./collapsible";

describe("Accordion", () => {
	it("keeps the Radix-style single-value API while exposing Base UI open attributes", () => {
		render(
			<Accordion type="single" defaultValue="payroll">
				<AccordionItem value="payroll">
					<AccordionTrigger>Payroll</AccordionTrigger>
					<AccordionContent>Timesheet approvals</AccordionContent>
				</AccordionItem>
			</Accordion>,
		);

		const trigger = screen.getByRole("button", { name: "Payroll" });
		expect(trigger.hasAttribute("data-panel-open")).toBe(true);
		expect(trigger.className).toContain("[&[data-panel-open]>svg]:rotate-180");

		const content = screen
			.getByText("Timesheet approvals")
			.closest('[data-slot="accordion-content"]');
		expect(content?.getAttribute("data-slot")).toBe("accordion-content");
		expect(content?.hasAttribute("data-open")).toBe(true);
	});

	it("keeps single accordions non-collapsible by default", () => {
		render(
			<Accordion type="single" defaultValue="payroll">
				<AccordionItem value="payroll">
					<AccordionTrigger>Payroll</AccordionTrigger>
					<AccordionContent>Timesheet approvals</AccordionContent>
				</AccordionItem>
			</Accordion>,
		);

		const trigger = screen.getByRole("button", { name: "Payroll" });
		fireEvent.click(trigger);

		expect(trigger.hasAttribute("data-panel-open")).toBe(true);
	});
});

describe("Collapsible", () => {
	it("maps asChild roots to Base UI render props", () => {
		render(
			<Collapsible asChild defaultOpen>
				<section>Root content</section>
			</Collapsible>,
		);

		const root = screen.getByText("Root content");
		expect(root.getAttribute("data-slot")).toBe("collapsible");
		expect(root.hasAttribute("data-open")).toBe(true);
	});

	it("preserves trigger and content siblings when asChild roots receive multiple children", () => {
		render(
			<Collapsible asChild defaultOpen>
				<CollapsibleTrigger asChild>
					<div>Delivery row</div>
				</CollapsibleTrigger>
				<CollapsibleContent asChild>
					<section>Delivery payload</section>
				</CollapsibleContent>
			</Collapsible>,
		);

		expect(screen.getByRole("button", { name: "Delivery row" })).toBeTruthy();
		expect(screen.getByText("Delivery payload")).toBeTruthy();
	});

	it("maps asChild triggers and content to Base UI render props", () => {
		render(
			<Collapsible defaultOpen>
				<CollapsibleTrigger asChild>
					<button type="button">Details</button>
				</CollapsibleTrigger>
				<CollapsibleContent asChild>
					<section>Webhook payload</section>
				</CollapsibleContent>
			</Collapsible>,
		);

		const trigger = screen.getByRole("button", { name: "Details" });
		expect(trigger.getAttribute("data-slot")).toBe("collapsible-trigger");
		expect(trigger.hasAttribute("data-panel-open")).toBe(true);

		const content = screen.getByText("Webhook payload");
		expect(content.getAttribute("data-slot")).toBe("collapsible-content");
		expect(content.hasAttribute("data-open")).toBe(true);
	});

	it("keeps native button children native for asChild triggers", () => {
		render(
			<Collapsible defaultOpen>
				<CollapsibleTrigger asChild>
					<button type="button">Native trigger</button>
				</CollapsibleTrigger>
				<CollapsibleContent>Native panel</CollapsibleContent>
			</Collapsible>,
		);

		const trigger = screen.getByRole("button", { name: "Native trigger" });
		expect(trigger.tagName).toBe("BUTTON");
		expect(trigger.getAttribute("role")).toBeNull();
	});

	it("keeps Z8 Button children native for asChild triggers", () => {
		render(
			<Collapsible defaultOpen>
				<CollapsibleTrigger asChild>
					<Button>Design-system trigger</Button>
				</CollapsibleTrigger>
				<CollapsibleContent>Design-system panel</CollapsibleContent>
			</Collapsible>,
		);

		const trigger = screen.getByRole("button", { name: "Design-system trigger" });
		expect(trigger.tagName).toBe("BUTTON");
		expect(trigger.getAttribute("role")).toBeNull();
	});

	it("uses Base UI panel-open state on asChild triggers", () => {
		render(
			<Collapsible defaultOpen>
				<CollapsibleTrigger asChild>
					<div>Stateful trigger</div>
				</CollapsibleTrigger>
				<CollapsibleContent>Stateful panel</CollapsibleContent>
			</Collapsible>,
		);

		const trigger = screen.getByRole("button", { name: "Stateful trigger" });
		expect(trigger.hasAttribute("data-panel-open")).toBe(true);
		expect(trigger.hasAttribute("data-state")).toBe(false);

		fireEvent.click(trigger);
		expect(trigger.hasAttribute("data-panel-open")).toBe(false);
		expect(trigger.hasAttribute("data-state")).toBe(false);
	});

	it("passes Base UI state animation classes through", () => {
		render(
			<Collapsible defaultOpen>
				<CollapsibleContent className="motion-safe:data-closed:animate-accordion-up motion-safe:data-open:animate-accordion-down">
					Nav group
				</CollapsibleContent>
			</Collapsible>,
		);

		const content = screen.getByText("Nav group");
		expect(content.className).toContain("motion-safe:data-closed:animate-accordion-up");
		expect(content.className).toContain("motion-safe:data-open:animate-accordion-down");
	});
});
