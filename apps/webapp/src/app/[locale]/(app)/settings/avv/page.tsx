import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { requireUser } from "@/lib/auth-helpers";
import { AvvDownloadButton } from "@/components/settings/avv/avv-download-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AvvPage() {
	if (process.env.BILLING_ENABLED !== "true") {
		redirect("/settings");
	}

	const authContext = await requireUser();

	const organizationId = authContext.session.activeOrganizationId;
	if (!organizationId) {
		redirect("/");
	}

	const [memberRecord, organization] = await Promise.all([
		db.query.member.findFirst({
			where: and(
				eq(authSchema.member.userId, authContext.user.id),
				eq(authSchema.member.organizationId, organizationId),
			),
		}),
		db.query.organization.findFirst({
			where: eq(authSchema.organization.id, organizationId),
		}),
	]);

	if (memberRecord?.role !== "owner" && memberRecord?.role !== "admin") {
		redirect("/settings");
	}

	if (!organization) {
		redirect("/settings");
	}

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">Auftragsverarbeitungsvertrag (AVV)</h1>
				<p className="text-muted-foreground">
					Laden Sie Ihren Auftragsverarbeitungsvertrag gem&auml;&szlig; Art. 28 DSGVO
					herunter.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Vertragsdetails</CardTitle>
					<CardDescription>
						Dieser Vertrag regelt die Auftragsverarbeitung personenbezogener Daten
						zwischen Ihrer Organisation und Umami Creative GmbH.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="grid gap-6 sm:grid-cols-2">
						<div className="space-y-1">
							<h2 className="text-sm font-medium text-muted-foreground">
								Auftraggeber (Verantwortlicher)
							</h2>
							<p className="font-medium">{organization.name}</p>
						</div>

						<div className="space-y-1">
							<h2 className="text-sm font-medium text-muted-foreground">
								Auftragnehmer (Auftragsverarbeiter)
							</h2>
							<div className="text-sm">
								<p className="font-medium">Umami Creative GmbH</p>
								<p>Bismarckstra&szlig;e 9</p>
								<p>91054 Erlangen, Bayern</p>
								<p>Deutschland</p>
							</div>
						</div>
					</div>

					<div className="space-y-1">
						<h2 className="text-sm font-medium text-muted-foreground">
							Hosting &amp; Subprozessoren
						</h2>
						<p className="text-sm">
							Alle Daten werden auf Servern der Hetzner Online GmbH in Deutschland
							gehostet. Es werden keine weiteren Subprozessoren eingesetzt.
						</p>
					</div>

					<div className="border-t pt-6">
						<AvvDownloadButton organizationName={organization.name} />
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
