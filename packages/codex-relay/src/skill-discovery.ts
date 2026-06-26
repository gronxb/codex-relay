import type { Dirent } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { AgentSkill, AgentSkillSource } from "./api-schema.js";

type SkillSearchRoot = {
  path: string;
  source: AgentSkillSource;
  sourceLabel: string;
  maxDepth: number;
};

type ListAvailableSkillsOptions = {
  codexHome?: string;
  homePath?: string;
  workspacePath: string;
};

type ParsedSkill = {
  description?: string;
  displayName?: string;
  name?: string;
};

export async function listAvailableSkills(
  options: ListAvailableSkillsOptions,
): Promise<AgentSkill[]> {
  const homePath = options.homePath ?? homedir();
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homePath, ".codex");
  const { workspacePath } = options;
  const roots: SkillSearchRoot[] = [
    {
      path: join(workspacePath, ".agents", "skills"),
      source: "workspace",
      sourceLabel: basename(workspacePath) || "workspace",
      maxDepth: 4,
    },
    {
      path: join(homePath, ".agents", "skills"),
      source: "personal",
      sourceLabel: "personal",
      maxDepth: 4,
    },
    {
      path: join(codexHome, "skills"),
      source: "personal",
      sourceLabel: "personal",
      maxDepth: 5,
    },
    {
      path: join(codexHome, "plugins", "cache"),
      source: "plugin",
      sourceLabel: "plugin",
      maxDepth: 8,
    },
  ];

  const skillPaths = dedupe(
    (await Promise.all(roots.map((root) => findSkillFiles(root)))).flat(),
    (entry) => entry.path,
  );
  const skills = await Promise.all(skillPaths.map(readSkill));
  return skills.filter((skill): skill is AgentSkill => Boolean(skill)).sort(compareSkills);
}

async function findSkillFiles(root: SkillSearchRoot) {
  const found: Array<SkillSearchRoot & { path: string }> = [];
  const visitedDirectories = new Set<string>();

  async function walk(path: string, depth: number) {
    if (depth < 0) {
      return;
    }

    let realDirectoryPath: string;
    try {
      realDirectoryPath = await realpath(path);
    } catch {
      return;
    }
    if (visitedDirectories.has(realDirectoryPath)) {
      return;
    }
    visitedDirectories.add(realDirectoryPath);

    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      const kind = await directoryEntryKind(entry, entryPath);
      if (kind === "file" && entry.name === "SKILL.md") {
        found.push({ ...root, path: entryPath });
        continue;
      }
      if (kind !== "directory" || entry.name === "node_modules") {
        continue;
      }
      await walk(entryPath, depth - 1);
    }
  }

  await walk(root.path, root.maxDepth);
  return found;
}

async function directoryEntryKind(entry: Dirent, entryPath: string) {
  if (entry.isFile()) {
    return "file";
  }
  if (entry.isDirectory()) {
    return "directory";
  }
  if (!entry.isSymbolicLink()) {
    return null;
  }

  try {
    const target = await stat(entryPath);
    if (target.isFile()) {
      return "file";
    }
    if (target.isDirectory()) {
      return "directory";
    }
  } catch {
    return null;
  }
  return null;
}

async function readSkill(entry: SkillSearchRoot & { path: string }): Promise<AgentSkill | null> {
  let markdown: string;
  try {
    markdown = await readFile(entry.path, "utf8");
  } catch {
    return null;
  }

  const parsed = parseSkillMarkdown(markdown);
  const name = parsed.name?.trim() || skillDirectoryName(entry.path);
  if (!name) {
    return null;
  }

  const isSystemSkill = entry.path.includes("/skills/.system/");
  const source = isSystemSkill ? "system" : entry.source;
  const displayName = parsed.displayName?.trim() || titleizeSkillName(name);
  return {
    id: `${source}:${name}:${entry.path}`,
    name,
    displayName,
    description: parsed.description?.trim() || undefined,
    path: entry.path,
    source,
    sourceLabel: isSystemSkill ? "system" : entry.sourceLabel,
  };
}

function parseSkillMarkdown(markdown: string): ParsedSkill {
  const frontmatter = parseFrontmatter(markdown);
  const heading = firstMarkdownHeading(markdownBody(markdown));
  return {
    description: frontmatter.description,
    displayName: heading ? cleanHeading(heading) : undefined,
    name: frontmatter.name,
  };
}

function parseFrontmatter(markdown: string) {
  if (!markdown.startsWith("---\n")) {
    return {} as Record<string, string>;
  }

  const end = markdown.indexOf("\n---", 4);
  if (end < 0) {
    return {} as Record<string, string>;
  }

  const fields: Record<string, string> = {};
  const lines = markdown.slice(4, end).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1];
    const value = match[2].trim();
    if (isBlockScalar(value)) {
      const blockLines: string[] = [];
      while (
        index + 1 < lines.length &&
        (lines[index + 1].trim() === "" || /^\s/.test(lines[index + 1]))
      ) {
        index += 1;
        blockLines.push(lines[index].replace(/^\s+/, ""));
      }
      fields[key] = formatBlockScalar(value, blockLines);
      continue;
    }
    fields[key] = unquoteYamlScalar(value);
  }
  return fields;
}

function isBlockScalar(value: string) {
  return ["|", "|-", "|+", ">", ">-", ">+"].includes(value);
}

function formatBlockScalar(marker: string, lines: string[]) {
  const trimmedLines = lines.map((line) => line.trimEnd());
  if (marker.startsWith("|")) {
    return trimmedLines.join("\n").trim();
  }
  return trimmedLines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function markdownBody(markdown: string) {
  if (!markdown.startsWith("---\n")) {
    return markdown;
  }
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) {
    return markdown;
  }
  return markdown.slice(end + 4).replace(/^\r?\n/, "");
}

function firstMarkdownHeading(markdown: string) {
  let fence: string | undefined;
  for (const line of markdown.split("\n")) {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      fence = fence ? undefined : fenceMatch[1];
      continue;
    }
    if (fence) {
      continue;
    }
    const heading = line.match(/^#\s+(.+)$/)?.[1]?.trim();
    if (heading) {
      return heading;
    }
  }
  return undefined;
}

function unquoteYamlScalar(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function skillDirectoryName(path: string) {
  return basename(dirname(path));
}

function cleanHeading(heading: string) {
  return heading.replace(/\s+\([^)]*\)\s*$/, "").trim();
}

function titleizeSkillName(name: string) {
  return name
    .split(/[-_:]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function compareSkills(a: AgentSkill, b: AgentSkill) {
  const sourceOrder: Record<AgentSkillSource, number> = {
    workspace: 0,
    personal: 1,
    plugin: 2,
    system: 3,
  };
  return (
    sourceOrder[a.source] - sourceOrder[b.source] ||
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
  );
}

function dedupe<T>(items: T[], keyFor: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
