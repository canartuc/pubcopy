import type { PlatformProfile } from "./index";

export const MediumProfile: PlatformProfile = {
  name: "Medium",
  maxHeadingLevel: 4,
  maxListNestingDepth: 2,
  codeBlockWrapper: "pre-code",
  footnoteStrategy: "superscript-endnotes",
  supportsHighlight: false,
  supportsTaskLists: false,
  supportsTableHtml: true,
};
