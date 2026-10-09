// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { render } from "@/test/render-with-translations";
import { DownloadPersonnelFile } from "./download-personnel-file";

const EMPLOYEE_ID = "e8710000-0000-4000-8000-000000000002";

describe("DownloadPersonnelFile", () => {
	it("downloads shared documents only by default, and everything once switched off", async () => {
		render(<DownloadPersonnelFile employeeId={EMPLOYEE_ID} />);

		fireEvent.click(screen.getByRole("button", { name: "Download personnel file" }));
		const checkbox = await screen.findByRole("checkbox", { name: "Shared documents only" });
		expect(checkbox.getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("link", { name: "Download ZIP" }).getAttribute("href")).toBe(
			`/api/personnel-files/employees/${EMPLOYEE_ID}/zip?sharedOnly=1`,
		);

		fireEvent.click(checkbox);
		expect(checkbox.getAttribute("aria-checked")).toBe("false");
		expect(screen.getByRole("link", { name: "Download ZIP" }).getAttribute("href")).toBe(
			`/api/personnel-files/employees/${EMPLOYEE_ID}/zip?sharedOnly=0`,
		);
	});
});
