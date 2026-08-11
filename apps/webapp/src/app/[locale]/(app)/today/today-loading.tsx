import { Skeleton } from "@/components/ui/skeleton";

const TODAY_SUMMARY_LOADING_KEYS = [
	"critical",
	"approvals",
	"attendance",
	"payroll",
	"coverage",
	"overtime",
] as const;

const TODAY_ACTION_LOADING_KEYS = ["needs-action", "approval-inbox"] as const;

const TODAY_SUPPORTING_LOADING_KEYS = [
	"attendance",
	"absences",
	"coverage",
	"overtime",
	"payroll",
] as const;

export function TodayPageLoading() {
	return (
		<div
			aria-label="Loading today's manager briefing"
			className="@container/main flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6"
			role="status"
		>
			<header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
				<div className="space-y-3">
					<Skeleton aria-hidden="true" className="h-8 w-48" />
					<Skeleton aria-hidden="true" className="h-5 w-full max-w-2xl" />
				</div>
				<Skeleton aria-hidden="true" className="h-4 w-40" />
			</header>

			<section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
				{TODAY_SUMMARY_LOADING_KEYS.map((key) => (
					<Skeleton aria-hidden="true" className="h-32 w-full" key={key} />
				))}
			</section>

			<section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
				{TODAY_ACTION_LOADING_KEYS.map((key) => (
					<Skeleton aria-hidden="true" className="h-72 w-full" key={key} />
				))}
			</section>

			<section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{TODAY_SUPPORTING_LOADING_KEYS.map((key) => (
					<Skeleton aria-hidden="true" className="h-52 w-full" key={key} />
				))}
			</section>
		</div>
	);
}
