import { IconClock, IconKeyOff } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SCIMManagedCredentialDTO } from "@/lib/scim/managed-control-plane";

type ScimCredentialStatus = SCIMManagedCredentialDTO["status"];

const lastUsedFormatters = new Map<string, Intl.DateTimeFormat>();
const expiryFormatters = new Map<string, Intl.DateTimeFormat>();

function getLastUsedFormatter(locale: string) {
	let formatter = lastUsedFormatters.get(locale);
	if (!formatter) {
		formatter = Intl.DateTimeFormat(locale, {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: "UTC",
		});
		lastUsedFormatters.set(locale, formatter);
	}
	return formatter;
}

function getExpiryFormatter(locale: string) {
	let formatter = expiryFormatters.get(locale);
	if (!formatter) {
		formatter = Intl.DateTimeFormat(locale, {
			dateStyle: "medium",
			timeZone: "UTC",
		});
		expiryFormatters.set(locale, formatter);
	}
	return formatter;
}

export function ScimCredentialList({
	credentials,
	onRevoke,
	pending,
}: {
	credentials: SCIMManagedCredentialDTO[];
	onRevoke: (id: string) => void;
	pending: boolean;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const lastUsedFormatter = getLastUsedFormatter(locale);
	const expiryFormatter = getExpiryFormatter(locale);
	const credentialStatusLabels = {
		active: () =>
			t(
				"settings.enterprise.identity.scim.credentials.status.active",
				"active",
			),
		decommissioned: () =>
			t(
				"settings.enterprise.identity.scim.status.decommissioned",
				"decommissioned",
			),
		expired: () =>
			t(
				"settings.enterprise.identity.scim.credentials.status.revoked",
				"revoked",
			),
		revoked: () =>
			t(
				"settings.enterprise.identity.scim.credentials.status.revoked",
				"revoked",
			),
	} satisfies Record<ScimCredentialStatus, () => string>;
	if (!credentials.length)
		return (
			<p className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
				{t(
					"settings.enterprise.identity.scim.credentials.empty",
					"No credentials have been issued.",
				)}
			</p>
		);
	return (
		<ul className="divide-y rounded-lg border">
			{credentials.map((credential) => (
				<li
					key={credential.credentialId}
					className="flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
				>
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-medium text-sm">
								{t(
									"settings.enterprise.identity.scim.credentials.credential",
									"Credential",
								)}
							</span>
							<Badge
								variant={credential.status === "active" ? "default" : "outline"}
							>
								{credentialStatusLabels[credential.status]?.() ??
									t(
										"settings.enterprise.identity.scim.credentials.status.revoked",
										"revoked",
									)}
							</Badge>
						</div>
						<p className="mt-1 flex flex-wrap gap-x-3 text-muted-foreground text-xs">
							<span
								role="status"
								aria-label={
									credential.lastUsedAt
										? t(
												"settings.enterprise.identity.scim.credentials.lastUsedAria",
												"Last used: {value} UTC",
												{
													value: lastUsedFormatter.format(
														new Date(credential.lastUsedAt),
													),
												},
											)
										: undefined
								}
							>
								<IconClock className="mr-1 inline size-3" aria-hidden="true" />
								{credential.lastUsedAt
									? lastUsedFormatter.format(new Date(credential.lastUsedAt))
									: t(
											"settings.enterprise.identity.scim.credentials.unused",
											"Not yet used",
										)}
							</span>
							<span>
								{t(
									"settings.enterprise.identity.scim.credentials.expires",
									"Expires",
								)}
								: {expiryFormatter.format(new Date(credential.expiresAt))}
							</span>
						</p>
					</div>
					{credential.status === "active" ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => onRevoke(credential.credentialId)}
							disabled={pending}
						>
							<IconKeyOff className="mr-2 size-4" aria-hidden="true" />
							{t(
								"settings.enterprise.identity.scim.credentials.revoke",
								"Revoke",
							)}
						</Button>
					) : null}
				</li>
			))}
		</ul>
	);
}
