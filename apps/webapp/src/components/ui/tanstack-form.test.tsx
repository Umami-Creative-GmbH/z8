/* @vitest-environment jsdom */

import { useForm } from "@tanstack/react-form";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "./tanstack-form";

function ValidatedForm() {
	const form = useForm({ defaultValues: { name: "" } });
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="name"
				validators={{ onChange: z.string().min(1, "Enter a name") }}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel>Name</TFormLabel>
						<TFormControl hasError={field.state.meta.errors.length > 0}>
							<input
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<button type="submit">Save</button>
		</form>
	);
}

describe("TanStack form UI helpers", () => {
	it("does not crash when a label is rendered without TFormItem", () => {
		render(<TFormLabel>Standalone label</TFormLabel>);

		expect(screen.getByText("Standalone label")).toBeTruthy();
	});

	it("announces and associates Standard Schema validation errors from a real TanStack field", async () => {
		const user = userEvent.setup();
		render(<ValidatedForm />);
		await user.click(screen.getByRole("button", { name: "Save" }));
		const message = await screen.findByRole("alert");
		expect(message.textContent).toBe("Enter a name");
		expect(
			screen
				.getByRole("textbox", { name: "Name" })
				.getAttribute("aria-describedby")
				?.split(" "),
		).toContain(message.id);
	});
});
