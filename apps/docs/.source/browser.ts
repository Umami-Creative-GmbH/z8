// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "admin-guide/index.mdx": () => import("../content/docs/admin-guide/index.mdx?collection=docs"), "deployment/index.mdx": () => import("../content/docs/deployment/index.mdx?collection=docs"), "getting-started/index.mdx": () => import("../content/docs/getting-started/index.mdx?collection=docs"), "manager-guide/index.mdx": () => import("../content/docs/manager-guide/index.mdx?collection=docs"), "technical/index.mdx": () => import("../content/docs/technical/index.mdx?collection=docs"), "user-guide/index.mdx": () => import("../content/docs/user-guide/index.mdx?collection=docs"), }),
};
export default browserCollections;