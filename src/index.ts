import { homedir } from "node:os";
import { dirname, join, resolve, sep, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, readFile, rm, access } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const REPO_URL = "https://github.com/effect-TS/effect.git";
const NPM_LATEST = "https://registry.npmjs.org/effect/latest";
const CACHE_DIR = join(homedir(), ".pi", "effect-ts-src");
const BASE_DIR = dirname(fileURLToPath(import.meta.url)); // .../src
const SKILLS_DIR = join(BASE_DIR, "..", "skills");

// In-memory cache of npm "latest" version; refreshed on list/clone.
let latestCache: { version: string; at: number } | undefined;
const LATEST_TTL_MS = 5 * 60_000;

const PKG_DIRS: Record<string, string> = {
  effect: "packages/effect/src",
  platform: "packages/platform/src",
  // ponytail: @effect/schema lives in a separate repo (effect-TS/schema);
  // add its own clone+tag path here if schema source lookup is needed.
};

function versionDir(version: string): string {
  return join(CACHE_DIR, version);
}

async function resolveLatest(): Promise<string> {
  if (latestCache && Date.now() - latestCache.at < LATEST_TTL_MS) {
    return latestCache.version;
  }
  const res = await fetch(NPM_LATEST);
  if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
  const data = (await res.json()) as { version: string };
  latestCache = { version: data.version, at: Date.now() };
  return data.version;
}

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9._-]+)?$/;

function validateVersion(v: string): string {
  if (!VERSION_RE.test(v)) {
    throw new Error(`Invalid Effect version: ${v}`);
  }
  return v;
}

/** Normalize a version input into a concrete version string (no tag prefix). */
async function resolveVersion(version: string | undefined): Promise<string> {
  const v = (version ?? "latest").trim();
  if (!v || v === "latest") return resolveLatest();
  return validateVersion(v);
}

/** Convert a version to the git tag used by the effect-TS monorepo. */
function tagFor(version: string): string {
  return version.startsWith("effect@") ? version : `effect@${version}`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function listCloned(): Promise<string[]> {
  if (!(await exists(CACHE_DIR))) return [];
  const entries = await readdir(CACHE_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** Clone the monorepo at a version if not already present. Returns the dir. */
async function ensureCloned(
  pi: ExtensionAPI,
  version: string,
  signal: AbortSignal | undefined,
  onUpdate?: (update: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => void,
): Promise<string> {
  const dir = versionDir(version);
  if (await exists(join(dir, ".git"))) return dir;

  onUpdate?.({
    content: [
      {
        type: "text",
        text: `Cloning effect@${version} into ${dir} (shallow)...`,
      },
    ],
    details: {},
  });

  const tag = tagFor(version);
  // Shallow clone of the specific tag. --depth 1 keeps it small.
  const result = await pi.exec(
    "git",
    ["clone", "--depth", "1", "--branch", tag, REPO_URL, dir],
    { signal, timeout: 180_000 },
  );
  if (result.code !== 0) {
    // Clean up partial clone.
    await rm(dir, { recursive: true, force: true });
    throw new Error(
      `git clone failed (tag ${tag}): ${result.stderr || result.stdout || "exit " + result.code}`,
    );
  }
  return dir;
}

/** Detect ripgrep availability once. */
let rgAvailable: boolean | undefined;
async function hasRg(pi: ExtensionAPI): Promise<boolean> {
  if (rgAvailable !== undefined) return rgAvailable;
  try {
    const r = await pi.exec("rg", ["--version"], { timeout: 5_000 });
    rgAvailable = r.code === 0;
  } catch {
    rgAvailable = false;
  }
  return rgAvailable;
}

async function searchSource(
  pi: ExtensionAPI,
  dir: string,
  query: string,
  pkg: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const scopeDirs: string[] = [];
  if (pkg === "all") {
    for (const p of Object.values(PKG_DIRS)) scopeDirs.push(join(dir, p));
  } else {
    const rel = PKG_DIRS[pkg] ?? PKG_DIRS.effect;
    scopeDirs.push(join(dir, rel));
  }
  // ponytail: no async-in-filter; collect existing dirs explicitly
  const existing: string[] = [];
  for (const d of scopeDirs) {
    if (await exists(d)) existing.push(d);
  }
  const valid = existing.length > 0;
  if (existing.length === 0) {
    throw new Error(`No source dirs found under ${dir} for package(s): ${pkg}`);
  }

  let output: string;
  if (await hasRg(pi)) {
    const args = [
      "rg",
      "--line-number",
      "--color=never",
      "--type",
      "ts",
      "-C",
      "1",
      query,
      ...existing,
    ];
    const r = await pi.exec(args[0], args.slice(1), { signal, timeout: 60_000 });
    // rg exits 1 when no matches
    if (r.code !== 0 && r.code !== 1) {
      throw new Error(`ripgrep failed: ${r.stderr || r.stdout}`);
    }
    output = r.stdout;
  } else {
    const r = await pi.exec(
      "grep",
      ["-rn", "--include=*.ts", "-C", "1", query, ...existing],
      { signal, timeout: 60_000 },
    );
    if (r.code !== 0 && r.code !== 1) {
      throw new Error(`grep failed: ${r.stderr || r.stdout}`);
    }
    output = r.stdout;
  }

  if (!output.trim()) return "No matches found.";

  const truncation = truncateHead(output, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  let text = truncation.content;
  if (truncation.truncated) {
    text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Refine your query or use effect_api read on a specific file.]`;
  }
  return text;
}

async function readSourceFile(
  dir: string,
  relPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const resolvedDir = resolve(dir);
  const abs = resolve(dir, relPath);
  if (relPath.includes("\0") || isAbsolute(relPath) || !(abs === resolvedDir || abs.startsWith(resolvedDir + sep))) {
    throw new Error(`Path escapes repo root: ${relPath}`);
  }
  if (signal?.aborted) {
    throw new Error("Cancelled");
  }
  if (!(await exists(abs))) {
    throw new Error(`File not found: ${relPath} (resolved to ${abs})`);
  }
  const content = await readFile(abs, "utf8");
  const truncation = truncateHead(content, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  let text = truncation.content;
  if (truncation.truncated) {
    text += `\n\n[File truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Read a smaller region with offset/limit via the built-in read tool on: ${abs}]`;
  }
  return text;
}

/** Require a version to be already cloned. Throws if not — read-only tools must not clone. */
async function requireCloned(version: string): Promise<string> {
  const dir = versionDir(version);
  if (!(await exists(join(dir, ".git")))) {
    throw new Error(
      `effect@${version} is not cloned. Use the effect_api_clone tool to fetch it first, then retry.`,
    );
  }
  return dir;
}

const ReadParams = Type.Object({
  action: StringEnum(["list", "search", "read"]),
  version: Type.Optional(
    Type.String({
      description:
        "Effect version, e.g. '3.21.4'. Defaults to 'latest' (resolved from npm). Ignored for 'list'.",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "For 'search': symbol name or regex to find in Effect TypeScript source.",
    }),
  ),
  path: Type.Optional(
    Type.String({
      description:
        "For 'read': file path relative to the repo root, e.g. 'packages/effect/src/Effect.ts'.",
    }),
  ),
  package: Type.Optional(
    StringEnum(["effect", "platform", "all"], {
      description: "Scope for 'search'. Defaults to 'effect'.",
    }),
  ),
});

const CloneParams = Type.Object({
  version: Type.Optional(
    Type.String({
      description:
        "Effect version to clone, e.g. '3.21.4'. Defaults to 'latest' (resolved from npm).",
    }),
  ),
});

export default function (pi: ExtensionAPI) {
  // ponytail: CACHE_DIR (~/.pi/effect-ts-src) doubles as persistent state.
  // No session entries needed — the filesystem is the source of truth.

  // Contribute skills: API reference guide + review checklist.
  pi.on("resources_discover", () => {
    return {
      skillPaths: [
        join(SKILLS_DIR, "effect-api-reference"),
        join(SKILLS_DIR, "effect-review"),
      ],
    };
  });

  pi.registerCommand("effect", {
    description: "Manage Effect.ts source versions (clone, list, remove)",
    handler: async (_args, ctx) => {
      if (ctx.hasUI) {
        const cloned = await listCloned();
        const options = [
          "List cloned versions",
          "Clone a version (latest or specific)",
          "Remove a cloned version",
          `Show cache dir (${CACHE_DIR})`,
        ];
        const choice = await ctx.ui.select("Effect.ts source:", options);
        if (choice === undefined) return;

        if (choice === options[0]) {
          const latest = await resolveLatest().catch(() => "unknown");
          ctx.ui.notify(
            cloned.length
              ? `Cloned: ${cloned.join(", ")}\nLatest on npm: ${latest}`
              : `None cloned yet. Latest on npm: ${latest}`,
            "info",
          );
          return;
        }

        if (choice === options[1]) {
          const input = await ctx.ui.input(
            "Version to clone (blank = latest):",
            "3.21.4",
          );
          if (!input) return;
          const version = await resolveVersion(input || "latest");
          ctx.ui.setStatus("effect", `Cloning effect@${version}...`);
          try {
            await ensureCloned(pi, version, ctx.signal, undefined);
            ctx.ui.notify(`Cloned effect@${version} → ${versionDir(version)}`, "info");
          } catch (err) {
            ctx.ui.notify(`Clone failed: ${(err as Error).message}`, "error");
          } finally {
            ctx.ui.setStatus("effect", undefined);
          }
          return;
        }

        if (choice === options[2]) {
          if (!cloned.length) {
            ctx.ui.notify("Nothing to remove.", "info");
            return;
          }
          const v = await ctx.ui.select("Remove version:", cloned);
          if (!v) return;
          await rm(versionDir(v), { recursive: true, force: true });
          ctx.ui.notify(`Removed effect@${v}`, "info");
          return;
        }

        if (choice === options[3]) {
          ctx.ui.notify(`Cache dir: ${CACHE_DIR}`, "info");
          return;
        }
      } else {
        // Non-interactive: just list.
        const cloned = await listCloned();
        const latest = await resolveLatest().catch(() => "unknown");
        console.log(`Cloned: ${cloned.join(", ") || "(none)"}`);
        console.log(`Latest on npm: ${latest}`);
        console.log(`Cache dir: ${CACHE_DIR}`);
      }
    },
  });

  pi.registerTool({
    name: "effect_api",
    label: "Effect.ts API",
    description:
      "Look up Effect.ts API from the official source, version-pinned. Actions: " +
      "'list' (cloned versions + npm latest), 'search' (grep symbol in source), " +
      "'read' (open a source file). This tool is read-only — it does NOT clone. " +
      "If a version is not cloned yet, it returns an error pointing to effect_api_clone. " +
      "Use this instead of guessing Effect signatures.",
    promptSnippet:
      "Look up Effect.ts API signatures and source from version-pinned official source (read-only)",
    promptGuidelines: [
      "Use effect_api (action: search, then read) to verify Effect.ts signatures against the actual source instead of relying on memory, especially for version-specific behavior.",
      "If effect_api reports a version is not cloned, call effect_api_clone to fetch it first, then retry.",
    ],
    parameters: ReadParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const { action, version, query, path, package: pkg = "effect" } = params;

      if (action === "list") {
        const cloned = await listCloned();
        const latest = await resolveLatest().catch(
          () => "unknown (npm registry unreachable)",
        );
        const lines = [
          `Effect.ts source cache: ${CACHE_DIR}`,
          `Latest on npm: ${latest}`,
          `Cloned versions: ${cloned.length ? cloned.join(", ") : "(none — use effect_api_clone to fetch)"}`,
        ];
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { cloned, latest, cacheDir: CACHE_DIR },
        };
      }

      if (action === "search") {
        if (!query) {
          throw new Error("'query' is required for action: search");
        }
        const ver = await resolveVersion(version);
        const dir = await requireCloned(ver);
        const text = await searchSource(pi, dir, query, pkg, signal);
        return {
          content: [{ type: "text", text }],
          details: { version: ver, query, package: pkg },
        };
      }

      if (action === "read") {
        if (!path) {
          throw new Error("'path' is required for action: read");
        }
        const ver = await resolveVersion(version);
        const dir = await requireCloned(ver);
        const text = await readSourceFile(dir, path, signal);
        return {
          content: [{ type: "text", text }],
          details: { version: ver, path },
        };
      }

      throw new Error(`Unknown action: ${action}`);
    },
  });

  pi.registerTool({
    name: "effect_api_clone",
    label: "Effect.ts Clone",
    description:
      "Clone the Effect.ts monorepo at a pinned version into the local cache " +
      "(~/.pi/effect-ts-src/<version>/). This is the only write action — " +
      "effect_api (search/read) requires the version to be cloned first. " +
      "Use this when effect_api reports a version is not cloned.",
    promptSnippet:
      "Fetch Effect.ts source for a specific version (write — clone to cache)",
    parameters: CloneParams,

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const ver = await resolveVersion(params.version);
      const dir = await ensureCloned(pi, ver, signal, onUpdate);
      return {
        content: [
          { type: "text", text: `Cloned effect@${ver} → ${dir}` },
        ],
        details: { version: ver, dir },
      };
    },
  });
}
