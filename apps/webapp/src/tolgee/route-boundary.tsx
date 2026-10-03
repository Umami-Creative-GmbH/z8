import "server-only";
import { type ReactNode, Suspense } from "react";
import { FeatureTranslationProvider } from "./feature-provider";
import { loadCatalogSlice } from "./load-translations";
import { getRouteCatalogScope } from "./route-catalog-scopes";

type Props = {
	route: string;
	params: Promise<{ locale: string }>;
	children: ReactNode;
};

async function RouteCatalog({ route, params, children }: Props) {
	const { locale } = await params;
	const scope = getRouteCatalogScope(route);
	if (!scope) throw new Error(`No translation scope for ${route}`);
	const slice = await loadCatalogSlice(locale, scope.namespaces);
	return (
		<FeatureTranslationProvider slice={slice}>
			{children}
		</FeatureTranslationProvider>
	);
}

/** Keep feature content hidden until its public catalog is ready. The parent
 * shell retains shared error/dialog translations if acquisition rejects.
 */
export function RouteTranslationBoundary(props: Props) {
	return (
		<Suspense fallback={null}>
			<RouteCatalog {...props} />
		</Suspense>
	);
}
