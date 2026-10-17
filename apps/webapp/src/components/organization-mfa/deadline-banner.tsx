import Link from "next/link";
import { getOwnMfaRequirements } from "@/lib/organization-mfa/queries";
import { getTranslate } from "@/tolgee/server";
export async function MfaDeadlineBanner({
	userId,
	organizationId,
}: {
	userId: string;
	organizationId: string | null | undefined;
}) {
	if (!organizationId) return null;
	const [requirements, t] = await Promise.all([
		getOwnMfaRequirements(userId),
		getTranslate(),
	]);
	const requirement = requirements.find(
		(item) => item.organizationId === organizationId,
	);
	if (!requirement) return null;
	return (
		<aside className="border-b bg-muted px-5 py-3 text-sm">
			<p>
				{t(
					"mfa.banner.requirement",
					"This organization requires verified authentication from {deadline}.",
					{ deadline: requirement.deadlineLabel ?? "now" },
				)}{" "}
				<Link
					className="underline"
					href={`/mfa?organizationId=${encodeURIComponent(organizationId)}`}
				>
					{t("mfa.banner.action", "Review requirements and verify")}
				</Link>
			</p>
		</aside>
	);
}
