import { Suspense } from "react";
import { VerifierResponsibility } from "@/components/driving-licence/verifier-settings";
import { getOwnDrivingLicenceStatusAction } from "@/lib/organization/driving-licence/policy-actions";
import { getTranslate } from "@/tolgee/server";

async function OwnDrivingLicenceContent() {
	const [result, t] = await Promise.all([
		getOwnDrivingLicenceStatusAction(),
		getTranslate(),
	]);
	return (
		<div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
			<h1 className="text-2xl font-semibold">
				{t("drivingLicence.myTitle", "My driving authorization")}
			</h1>
			{result.success ? (
				<section
					className="space-y-3 rounded-lg border bg-card p-6"
					aria-labelledby="own-driving-status"
				>
					<h2 id="own-driving-status" className="text-lg font-semibold">
						{result.data.enrolled
							? t(
									"drivingLicence.notChecked",
									"Not yet checked — no driving authorization",
								)
							: t(
									"drivingLicence.notEnrolled",
									"Not enrolled — no driving authorization",
								)}
					</h2>
					<p className="text-sm text-muted-foreground">
						{t(
							"drivingLicence.employeeExplanation",
							"Enrollment, an assigned vehicle and previous driving do not authorize driving. An authorized verifier must personally check your original licence for the relevant classes first.",
						)}
					</p>
					{result.data.timezone ? (
						<p className="text-sm text-muted-foreground">
							{t(
								"drivingLicence.employeeTimezone",
								"Calendar deadlines use {timezone}; your device timezone does not change them.",
								{ timezone: result.data.timezone },
							)}
						</p>
					) : null}
				</section>
			) : (
				<p role="alert">
					{t(
						"drivingLicence.loadError",
						"Driving licence control could not be loaded. Check your organization access.",
					)}
				</p>
			)}
			<VerifierResponsibility />
		</div>
	);
}
export default function OwnDrivingLicencePage() {
	return (
		<Suspense fallback={<div className="p-6" aria-busy="true" />}>
			<OwnDrivingLicenceContent />
		</Suspense>
	);
}
