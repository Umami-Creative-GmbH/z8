import { Effect } from "effect";
import { Suspense } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLayer } from "@/lib/effect/runtime";
import { PlatformAdminService } from "@/lib/effect/services/platform-admin.service";
import { collectPlatformDiagnostics } from "@/lib/platform-diagnostics";
import { getTranslate } from "@/tolgee/server";
import { DiagnosticsClient } from "./diagnostics-client";

export default function PlatformDiagnosticsPage() {
	return (
		<Suspense fallback={<PlatformDiagnosticsPageLoading />}>
			<PlatformDiagnosticsPageContent />
		</Suspense>
	);
}

async function PlatformDiagnosticsPageContent() {
	const [t, snapshot, admin] = await Promise.all([
		getTranslate(),
		collectPlatformDiagnostics(),
		Effect.runPromise(
			Effect.flatMap(PlatformAdminService, (adminService) =>
				adminService.requirePlatformAdmin(),
			).pipe(Effect.provide(AppLayer)),
		),
	]);

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

			<DiagnosticsClient initialSnapshot={snapshot} adminEmail={admin.email} />
		</div>
	);
}

function PlatformDiagnosticsPageLoading() {
	return (
		<div
			className="space-y-10"
			role="status"
			aria-label="Loading deployment diagnostics"
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-64" />
				<Skeleton aria-hidden="true" className="h-5 w-full max-w-xl" />
			</div>
			<div className="grid gap-4 lg:grid-cols-2">
				{["configuration", "health"].map((key) => (
					<Card key={key}>
						<CardHeader className="space-y-2">
							<Skeleton aria-hidden="true" className="h-5 w-40" />
							<Skeleton aria-hidden="true" className="h-4 w-64 max-w-full" />
						</CardHeader>
						<CardContent className="space-y-3">
							<Skeleton aria-hidden="true" className="h-12 w-full" />
							<Skeleton aria-hidden="true" className="h-12 w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		</div>
	);
}
