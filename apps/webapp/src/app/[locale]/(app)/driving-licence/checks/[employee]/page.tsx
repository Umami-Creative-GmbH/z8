import { permanentRedirect } from "next/navigation";
import { drivingLicenceCheckPath } from "@/lib/organization/driving-licence/paths";

interface LegacyDrivingLicenceCheckPageProps {
	params: Promise<{ locale: string; employee: string }>;
}

/**
 * The check page moved to Organization (#1937, #1953). Reminder emails and inbox items sent
 * before the move still link here, so this route permanently redirects. The new route applies
 * the same access check; this one reveals nothing.
 */
export default async function LegacyDrivingLicenceCheckPage({
	params,
}: LegacyDrivingLicenceCheckPageProps) {
	const { locale, employee } = await params;
	permanentRedirect(`/${locale}${drivingLicenceCheckPath(employee)}`);
}
