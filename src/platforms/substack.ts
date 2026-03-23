import type { PlatformProfile } from "./index";

export const SubstackProfile: PlatformProfile = {
  name: "Substack",
  maxHeadingLevel: 6,
  maxListNestingDepth: Infinity,
  codeBlockWrapper: "pre-only",
  footnoteStrategy: "native",
  supportsHighlight: false,
  supportsTaskLists: false,
  supportsTableHtml: true,
};
