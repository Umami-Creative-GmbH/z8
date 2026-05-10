import { connection } from "next/server";
import { collectPlatformDiagnostics } from "@/lib/platform-diagnostics";
import { DiagnosticsClient } from "./diagnostics-client";

export default async function PlatformDiagnosticsPage() {
	await connection();

	const snapshot = await collectPlatformDiagnostics();

	return (
		<div className="space-y-10">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">Deployment Diagnostics</h1>
				<p className="text-muted-foreground">
					Safe platform configuration and app-only deployment health checks.
				</p>
			</div>

			<DiagnosticsClient initialSnapshot={snapshot} />
		</div>
	);
}
