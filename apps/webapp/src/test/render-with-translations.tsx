import {
	type RenderOptions,
	render as testingLibraryRender,
} from "@testing-library/react";
import { FormatIcu } from "@tolgee/format-icu";
import { TolgeeCore, TolgeeProvider } from "@tolgee/react";
import type { ReactElement, ReactNode } from "react";

export function createTestTolgee(language = "en", translations = {}) {
	// The web factory starts extension-handshake timers that outlive jsdom teardown.
	return TolgeeCore()
		.use(FormatIcu())
		.init({
			language,
			staticData: { [language]: translations },
		});
}

/** Match the app's translation context for tests of shared UI components. */
export function render(ui: ReactElement, options: RenderOptions = {}) {
	const tolgee = createTestTolgee();
	const Wrapper = options.wrapper;
	return testingLibraryRender(ui, {
		...options,
		wrapper: ({ children }: { children: ReactNode }) => (
			<TolgeeProvider tolgee={tolgee}>
				{Wrapper ? <Wrapper>{children}</Wrapper> : children}
			</TolgeeProvider>
		),
	});
}
