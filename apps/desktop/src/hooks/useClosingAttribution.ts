import { useForm } from "@tanstack/react-form";
import type { AttributionIntent } from "../types";
function intent(value: string): AttributionIntent {
	if (value === "preserve") return { kind: "preserve" };
	if (value === "clear") return { kind: "clear" };
	return { kind: "replace", id: value };
}
export function useClosingAttribution() {
	const form = useForm({
		defaultValues: { project: "preserve", workCategory: "preserve" },
	});
	return {
		form,
		value: () => ({
			project: intent(form.state.values.project),
			workCategory: intent(form.state.values.workCategory),
		}),
	};
}
