"use client";

import { IconExternalLink } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ApiKeyDocumentation({ children }: { children?: ReactNode }) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardContent className="space-y-4">
				<h3 className="font-semibold">
					{t("settings.apiKeys.documentation.title", "Public API v1")}
				</h3>
				<div className="space-y-2 text-sm text-muted-foreground">
					<p>
						{t(
							"settings.apiKeys.documentation.resources",
							"Read work periods, absences, employees, projects, customers and custom-field definitions with Public API v1. Access is read-only.",
						)}
					</p>
					<p>
						{t(
							"settings.apiKeys.documentation.scopes",
							"An API key acts as your organization and reads only what its key scopes grant. Find endpoints, required scopes and examples in the reference.",
						)}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" asChild>
						<a
							href="https://docs.z8-time.app/docs/api-reference"
							target="_blank"
							rel="noreferrer"
						>
							{t("settings.apiKeys.documentation.reference", "API Reference")}
							<IconExternalLink aria-hidden="true" className="size-4" />
						</a>
					</Button>
					{children}
				</div>
			</CardContent>
		</Card>
	);
}
