import { AppErrorState } from "@/components/errors/app-error-state";

export default function NotFoundPage() {
	return (
		<AppErrorState
			variant="not-found"
			titleKey="errors.notFound.title"
			titleDefault="Page not found"
			descriptionKey="errors.notFound.description"
			descriptionDefault="The page may have moved, the link may be outdated, or the address may be incorrect."
		/>
	);
}
