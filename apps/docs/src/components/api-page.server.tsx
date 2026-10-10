import type { ComponentProps } from 'react';
import { openapi } from '@/lib/openapi';
import { OpenAPIPageClient } from './api-page';

type GeneratedProps = Omit<ComponentProps<typeof OpenAPIPageClient>, 'preloaded' | 'payload'> & {
  document: string;
};

/**
 * `<OpenAPIPage />` as the generated API reference pages use it: loads the
 * spec they name on the server and hands it to the client renderer.
 */
export async function OpenAPIPage(props: GeneratedProps) {
  const { bundled } = await openapi.getSchema(props.document);
  return <OpenAPIPageClient {...props} preloaded={{ docs: { [props.document]: bundled } }} />;
}
