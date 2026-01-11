import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { File, Folder, Files } from 'fumadocs-ui/components/files';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Callout } from 'fumadocs-ui/components/callout';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import { InlineTOC } from 'fumadocs-ui/components/inline-toc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mdxComponents: Record<string, any> = {
  ...defaultMdxComponents,
  // Steps for sequential instructions
  Steps,
  Step,
  // File tree visualization
  Files,
  File,
  Folder,
  // Collapsible sections
  Accordion,
  Accordions,
  // Tabbed content
  Tab,
  Tabs,
  // Callouts for warnings/info/tips
  Callout,
  // Card navigation
  Card,
  Cards,
  // Zoomable images
  ImageZoom,
  // Inline table of contents
  InlineTOC,
};
