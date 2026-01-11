// @ts-nocheck
import { default as __fd_glob_13 } from "../content/docs/user-guide/meta.json?collection=meta"
import { default as __fd_glob_12 } from "../content/docs/technical/meta.json?collection=meta"
import { default as __fd_glob_11 } from "../content/docs/manager-guide/meta.json?collection=meta"
import { default as __fd_glob_10 } from "../content/docs/getting-started/meta.json?collection=meta"
import { default as __fd_glob_9 } from "../content/docs/deployment/meta.json?collection=meta"
import { default as __fd_glob_8 } from "../content/docs/admin-guide/meta.json?collection=meta"
import { default as __fd_glob_7 } from "../content/docs/meta.json?collection=meta"
import * as __fd_glob_6 from "../content/docs/user-guide/index.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/technical/index.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/manager-guide/index.mdx?collection=docs"
import * as __fd_glob_3 from "../content/docs/getting-started/index.mdx?collection=docs"
import * as __fd_glob_2 from "../content/docs/deployment/index.mdx?collection=docs"
import * as __fd_glob_1 from "../content/docs/admin-guide/index.mdx?collection=docs"
import * as __fd_glob_0 from "../content/docs/index.mdx?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.doc("docs", "content/docs", {"index.mdx": __fd_glob_0, "admin-guide/index.mdx": __fd_glob_1, "deployment/index.mdx": __fd_glob_2, "getting-started/index.mdx": __fd_glob_3, "manager-guide/index.mdx": __fd_glob_4, "technical/index.mdx": __fd_glob_5, "user-guide/index.mdx": __fd_glob_6, });

export const meta = await create.meta("meta", "content/docs", {"meta.json": __fd_glob_7, "admin-guide/meta.json": __fd_glob_8, "deployment/meta.json": __fd_glob_9, "getting-started/meta.json": __fd_glob_10, "manager-guide/meta.json": __fd_glob_11, "technical/meta.json": __fd_glob_12, "user-guide/meta.json": __fd_glob_13, });