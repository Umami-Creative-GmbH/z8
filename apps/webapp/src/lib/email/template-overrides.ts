import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { type EmailTemplateKey, organizationEmailTemplate } from "@/db/schema";

export interface EnabledOrganizationEmailTemplate {
	subject: string;
	html: string;
	plainText: string | null;
}

export async function getEnabledOrganizationEmailTemplate(
	organizationId: string,
	templateKey: EmailTemplateKey,
): Promise<EnabledOrganizationEmailTemplate | null> {
	const template = await db.query.organizationEmailTemplate.findFirst({
		columns: {
			subject: true,
			html: true,
			plainText: true,
		},
		where: and(
			eq(organizationEmailTemplate.organizationId, organizationId),
			eq(organizationEmailTemplate.templateKey, templateKey),
			eq(organizationEmailTemplate.isEnabled, true),
		),
	});

	return template ?? null;
}
