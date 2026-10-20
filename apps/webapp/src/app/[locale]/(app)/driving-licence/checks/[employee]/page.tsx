import { IconArrowLeft } from "@tabler/icons-react";
import { Suspense } from "react";
import { DrivingLicenceCheckPanel } from "@/components/driving-licence/check-panel";
import { Badge } from "@/components/ui/badge";
import { requireDrivingLicenceCheckPage } from "@/lib/organization/driving-licence/page-guards";
import { DRIVING_LICENCE_PATH } from "@/lib/organization/driving-licence/paths";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

interface DrivingLicenceCheckPageProps {
	params: Promise<{ employee: string }>;
}

/**
 * One employee's driving licence check (#1429). Reminders, tasks and the Checks table link
 * here. Not found while the feature is off, without a current verifier grant covering the
 * employee, and for the viewer's own check.
 */
async function DrivingLicenceCheckContent({ params }: DrivingLicenceCheckPageProps) {
	const [{ employee }, t] = await Promise.all([params, getTranslate()]);
	const { actor, subject } = await requireDrivingLicenceCheckPage(employee);
	return (
		<div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 p-4 sm:p-6">
			<header className="space-y-2">
				<Link
					href={`${DRIVING_LICENCE_PATH}?tab=checks`}
					className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
				>
					<IconArrowLeft aria-hidden="true" className="size-4" />
					{t("drivingLicence.checkPage.back", "Checks")}
				</Link>
				<div className="flex flex-wrap items-center gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("drivingLicence.checkPage.title", "Driving licence check for {name}", {
							name: subject.name,
						})}
					</h1>
					{subject.canVerify ? null : (
						<Badge variant="secondary">
							{t("drivingLicence.checkPage.former", "Former employee")}
						</Badge>
					)}
				</div>
			</header>
			<DrivingLicenceCheckPanel
				key={`${actor.organizationId}:${actor.userId}:${subject.employeeId}`}
				employeeId={subject.employeeId}
				name={subject.name}
				canVerify={subject.canVerify}
			/>
		</div>
	);
}

export default function DrivingLicenceCheckPage(props: DrivingLicenceCheckPageProps) {
	return (
		<Suspense fallback={<div className="p-6" aria-busy="true" />}>
			<DrivingLicenceCheckContent {...props} />
		</Suspense>
	);
}
