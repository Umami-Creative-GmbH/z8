import type { VehicleUseMode } from "@/lib/time-tracking/vehicle-use/policy";
import type { WorksCouncilReviewIdentity } from "@/lib/works-council/review-identity";
import type { VehicleUseReview } from "@/lib/works-council/vehicle-use-review";
import type { getTranslate } from "@/tolgee/server";

type Translate = Awaited<ReturnType<typeof getTranslate>>;

function modeLabel(mode: VehicleUseMode, t: Translate): string {
	if (mode === "asked") return t("common.worksCouncil.vehicleUse.modeAsked", "Asked");
	if (mode === "expected") return t("common.worksCouncil.vehicleUse.modeExpected", "Expected");
	return t("common.worksCouncil.vehicleUse.modeOff", "Off");
}

function identityLabel(identity: WorksCouncilReviewIdentity, t: Translate): string {
	if (identity.kind === "named") return identity.name;
	if (identity.kind === "pseudonym") {
		return t("common.worksCouncil.vehicleUse.employeePseudonym", "Employee {ref}", {
			ref: identity.ref,
		});
	}
	return t("common.worksCouncil.identityHidden", "Identity hidden");
}

function CountTile({ label, value, t }: { label: string; value: number | null; t: Translate }) {
	return (
		<section aria-label={label} className="rounded-md border p-3">
			<p className="text-muted-foreground text-sm">{label}</p>
			{value === null ? (
				<p className="mt-1 font-medium text-muted-foreground text-sm">
					{t("common.worksCouncil.insufficientData", "Insufficient data")}
				</p>
			) : (
				<p className="mt-1 font-semibold text-xl tabular-nums">{value}</p>
			)}
		</section>
	);
}

/**
 * The works-council portal's read-only vehicle use section (#1130). It renders
 * only what the review model holds: the switch, assignments with their mode,
 * covered employees and the vehicle count. No reading or distance reaches it.
 */
export function VehicleUseReviewSection({ review, t }: { review: VehicleUseReview; t: Translate }) {
	const coverage = review.coveredEmployees;

	return (
		<section
			aria-labelledby="works-council-vehicle-use-title"
			className="rounded-lg border bg-card text-card-foreground shadow-sm"
		>
			<div className="border-b px-4 py-3">
				<h2 id="works-council-vehicle-use-title" className="font-semibold tracking-tight">
					{t("common.worksCouncil.vehicleUse.title", "Vehicle use")}
				</h2>
				<p className="text-muted-foreground text-sm">
					{t(
						"common.worksCouncil.vehicleUse.description",
						"Whom the organization asks to record the vehicle they drive for work. The works council never sees odometer readings or an employee's driven distances.",
					)}
				</p>
			</div>

			<div className="space-y-6 px-4 py-4">
				<dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
					<dt className="text-muted-foreground">
						{t("common.worksCouncil.vehicleUse.enabled", "Switch")}
					</dt>
					<dd className="font-medium">
						{review.enabled
							? t("common.worksCouncil.vehicleUse.on", "On")
							: t("common.worksCouncil.vehicleUse.off", "Off")}
					</dd>
					<dt className="text-muted-foreground">
						{t("common.worksCouncil.vehicleUse.organizationAssignment", "Whole organization")}
					</dt>
					<dd className="font-medium">
						{review.organizationAssignment === null
							? t("common.worksCouncil.vehicleUse.notAssigned", "Not assigned")
							: modeLabel(review.organizationAssignment, t)}
					</dd>
				</dl>

				<div className="grid gap-6 md:grid-cols-2">
					<section className="space-y-2">
						<h3 className="font-medium text-sm">
							{t("common.worksCouncil.vehicleUse.teamAssignments", "Team assignments")}
						</h3>
						{review.teamAssignments.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								{t("common.worksCouncil.vehicleUse.noTeamAssignments", "No team assignments.")}
							</p>
						) : (
							<ul className="divide-y rounded-md border text-sm">
								{review.teamAssignments.map((row) => (
									<li key={row.teamName} className="flex justify-between gap-4 px-3 py-2">
										<span className="break-words">{row.teamName}</span>
										<span className="font-medium">{modeLabel(row.mode, t)}</span>
									</li>
								))}
							</ul>
						)}
					</section>
					<section className="space-y-2">
						<h3 className="font-medium text-sm">
							{t("common.worksCouncil.vehicleUse.employeeAssignments", "Employee assignments")}
						</h3>
						{review.employeeAssignments.state === "counted" ? (
							<p className="text-sm">
								{t(
									"common.worksCouncil.vehicleUse.employeeAssignmentCounts",
									"{asked} asked, {expected} expected, {off} off individually",
									{
										asked: review.employeeAssignments.asked,
										expected: review.employeeAssignments.expected,
										off: review.employeeAssignments.off,
									},
								)}
							</p>
						) : review.employeeAssignments.rows.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								{t(
									"common.worksCouncil.vehicleUse.noEmployeeAssignments",
									"No employee assignments.",
								)}
							</p>
						) : (
							<ul className="divide-y rounded-md border text-sm">
								{review.employeeAssignments.rows.map((row, index) => (
									<li
										// biome-ignore lint/suspicious/noArrayIndexKey: read-only redacted server snapshot
										key={index}
										className="flex justify-between gap-4 px-3 py-2"
									>
										<span className="break-words">{identityLabel(row.employee, t)}</span>
										<span className="font-medium">{modeLabel(row.mode, t)}</span>
									</li>
								))}
							</ul>
						)}
					</section>
				</div>

				<section className="space-y-2">
					<h3 className="font-medium text-sm">
						{t("common.worksCouncil.vehicleUse.coveredTitle", "Covered employees")}
					</h3>
					<p className="text-muted-foreground text-sm">
						{t(
							"common.worksCouncil.vehicleUse.coveredDescription",
							"{count, plural, one {# active employee is} other {# active employees are}} asked or expected to record vehicle use right now.",
							{ count: coverage.coveredEmployees },
						)}
					</p>
					<div className="grid gap-3 sm:grid-cols-2">
						<CountTile
							t={t}
							label={t("common.worksCouncil.vehicleUse.coveredAsked", "Asked of")}
							value={coverage.state === "available" ? coverage.asked : null}
						/>
						<CountTile
							t={t}
							label={t("common.worksCouncil.vehicleUse.coveredExpected", "Expected of")}
							value={coverage.state === "available" ? coverage.expected : null}
						/>
					</div>
				</section>

				<section className="space-y-2">
					<h3 className="font-medium text-sm">
						{t("common.worksCouncil.vehicleUse.vehiclesTitle", "Organization vehicles")}
					</h3>
					<div className="grid gap-3 sm:grid-cols-2">
						<CountTile
							t={t}
							label={t("common.worksCouncil.vehicleUse.activeVehicles", "Active vehicles")}
							value={review.vehicles.active}
						/>
						<CountTile
							t={t}
							label={t("common.worksCouncil.vehicleUse.archivedVehicles", "Archived vehicles")}
							value={review.vehicles.archived}
						/>
					</div>
				</section>
			</div>
		</section>
	);
}
