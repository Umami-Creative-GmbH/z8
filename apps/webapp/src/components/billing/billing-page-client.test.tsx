/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BillingPageClient } from "./billing-page-client";

vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({
		refresh: vi.fn(),
	}),
}));

describe("BillingPageClient", () => {
	it("uses the shared settings pane spacing wrapper", () => {
		const { container } = render(
			<BillingPageClient
				subscription={null}
				accessResult={{ canAccess: true }}
				isOwner={true}
			/>,
		);

		expect(container.firstElementChild?.classList.contains("flex")).toBe(true);
		expect(container.firstElementChild?.classList.contains("flex-1")).toBe(true);
		expect(container.firstElementChild?.classList.contains("flex-col")).toBe(true);
		expect(container.firstElementChild?.classList.contains("gap-6")).toBe(true);
		expect(container.firstElementChild?.classList.contains("p-4")).toBe(true);
		expect(container.firstElementChild?.classList.contains("md:p-6")).toBe(true);
	});
});
