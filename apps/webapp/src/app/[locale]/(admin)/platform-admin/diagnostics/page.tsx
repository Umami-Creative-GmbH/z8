import { connection } from "next/server";
import { collectPlatformDiagnostics } from "@/lib/platform-diagnostics";
import { getTranslate } from "@/tolgee/server";
import { DiagnosticsClient } from "./diagnostics-client";

export default async function PlatformDiagnosticsPage() {
	await connection();

	const [t, snapshot] = await Promise.all([getTranslate(), collectPlatformDiagnostics()]);

	return (
		<div className="space-y-10">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("admin:admin.diagnostics.title", "Deployment Diagnostics")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"admin:admin.diagnostics.description",
						"Safe platform configuration and app-only deployment health checks.",
					)}
				</p>
			</div>

			<DiagnosticsClient initialSnapshot={snapshot} />
		</div>
	);
}
