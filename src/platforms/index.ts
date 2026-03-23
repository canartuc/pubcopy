export type CodeBlockWrapper = "pre-code" | "pre-only";
export type FootnoteStrategy = "superscript-endnotes" | "native";

export interface PlatformProfile {
  name: string;
  maxHeadingLevel: number;
  maxListNestingDepth: number;
  codeBlockWrapper: CodeBlockWrapper;
  footnoteStrategy: FootnoteStrategy;
  supportsHighlight: boolean;
  supportsTaskLists: boolean;
  supportsTableHtml: boolean;
}

export { MediumProfile } from "./medium";
export { SubstackProfile } from "./substack";
