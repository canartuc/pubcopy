import type { PubcopySettings } from "../settings";

interface CodeFenceRange {
  start: number;
  end: number;
}

function findCodeFences(text: string): CodeFenceRange[] {
  const ranges: CodeFenceRange[] = [];
  const regex = /^(`{3,}|~{3,}).*$/gm;
  let openFence: { marker: string; start: number } | null = null;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const marker = match[1];
    if (openFence === null) {
      openFence = { marker, start: match.index };
    } else if (marker[0] === openFence.marker[0] && marker.length >= openFence.marker.length) {
      ranges.push({ start: openFence.start, end: match.index + match[0].length });
      openFence = null;
    }
  }
  return ranges;
}

function isInsideCodeFence(pos: number, ranges: CodeFenceRange[]): boolean {
  return ranges.some((r) => pos >= r.start && pos <= r.end);
}

function replaceOutsideCodeFences(
  text: string,
  pattern: RegExp,
  replacement: string | ((match: string, ...args: string[]) => string),
  codeFences: CodeFenceRange[]
): string {
  return text.replace(pattern, (match, ...args) => {
    const offset = args[args.length - 2] as number;
    if (isInsideCodeFence(offset, codeFences)) {
      return match;
    }
    if (typeof replacement === "function") {
      return replacement(match, ...args);
    }
    return replacement;
  });
}

export function preprocess(text: string, settings: PubcopySettings): string {
  let result = text;
  const codeFences = findCodeFences(result);

  // Strip YAML frontmatter (must be at very start of file)
  if (settings.stripFrontmatter) {
    result = result.replace(/^---\n[\s\S]*?\n---\n?/, "");
  }

  // Strip Obsidian comments %%...%%
  result = replaceOutsideCodeFences(
    result,
    /%%[\s\S]*?%%/g,
    "",
    codeFences
  );

  // Strip HTML comments
  result = replaceOutsideCodeFences(
    result,
    /<!--[\s\S]*?-->/g,
    "",
    codeFences
  );

  // Strip block IDs ^block-id (at end of line or paragraph)
  result = replaceOutsideCodeFences(
    result,
    / ?\^[\w-]+$/gm,
    "",
    codeFences
  );

  // Strip tags #tag and #tag/subtag
  if (settings.stripTags) {
    result = replaceOutsideCodeFences(
      result,
      /(?<=\s|^)#[a-zA-Z][\w/]*/gm,
      "",
      codeFences
    );
  }

  // Convert wikilinks to plain text
  if (settings.stripWikilinks) {
    // Wikilinks with alias: [[page|display]] -> display
    result = replaceOutsideCodeFences(
      result,
      /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
      (_match: string, _page: string, display: string) => display,
      codeFences
    );

    // Wikilinks with heading: [[page#heading]] -> heading
    result = replaceOutsideCodeFences(
      result,
      /\[\[([^\]#]+)#\^?([^\]]+)\]\]/g,
      (_match: string, _page: string, ref: string) => ref,
      codeFences
    );

    // Plain wikilinks: [[page]] -> page
    result = replaceOutsideCodeFences(
      result,
      /\[\[([^\]]+)\]\]/g,
      (_match: string, page: string) => page,
      codeFences
    );
  }

  // Strip Obsidian URIs
  result = replaceOutsideCodeFences(
    result,
    /\[([^\]]*)\]\(obsidian:\/\/[^)]+\)/g,
    "",
    codeFences
  );

  // Clean up multiple blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}
