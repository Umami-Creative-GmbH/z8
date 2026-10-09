import { useForm } from "@tanstack/react-form";
import { attributionAvailability } from "../lib/attribution-availability";
import type { DesktopContext, AttributionIntent } from "../types";
function intent(value: string): AttributionIntent {
	if (value === "preserve") return { kind: "preserve" };
	if (value === "clear") return { kind: "clear" };
	return { kind: "replace", id: value };
}
export function useClosingAttribution(context?: DesktopContext) {
	const available = attributionAvailability(context);
	const form = useForm({
		defaultValues: { project: "preserve", workCategory: "preserve" },
	});
	return {
		form,
		value: () => ({
			project: available.project
				? intent(form.state.values.project)
				: { kind: "preserve" as const },
			workCategory: available.workCategory
				? intent(form.state.values.workCategory)
				: { kind: "preserve" as const },
		}),
	};
}
