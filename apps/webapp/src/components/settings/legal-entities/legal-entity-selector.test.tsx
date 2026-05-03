/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LegalEntitySelector } from "./legal-entity-selector";

vi.mock("next/navigation", () => ({
	usePathname: () => "/settings/holidays",
	useRouter: () => ({ push: vi.fn() }),
	useSearchParams: () => new URLSearchParams(),
}));

const entities = [
	{ id: "entity-a", name: "Germany GmbH" },
	{ id: "entity-b", name: "Portugal Lda" },
];

describe("LegalEntitySelector", () => {
	it("renders nothing when there is one entity", () => {
		const { container } = render(<LegalEntitySelector entities={[entities[0]]} selectedLegalEntityId="entity-a" />);
		expect(container.childElementCount).toBe(0);
	});

	it("renders a legal entity selector when multiple entities are available", () => {
		render(<LegalEntitySelector entities={entities} selectedLegalEntityId="entity-a" />);
		expect(screen.getByLabelText("Legal entity")).toBeTruthy();
		expect(screen.getByText("Germany GmbH")).toBeTruthy();
	});
});
