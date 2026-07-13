# pi-extension-effect-ts

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that lets the
agent look up **Effect.ts** API from version-pinned official source and review
Effect.ts code against a structured best-practices checklist.

It clones the [`effect-TS/effect`](https://github.com/effect-TS/effect) monorepo
at a pinned version into a local cache (`~/.pi/effect-ts-src/<version>/`) and
exposes tools/commands to search and read the TypeScript source directly — so the
agent verifies signatures against the real source instead of guessing.

## What it provides

- **`effect_api` tool** — version-pinned Effect.ts source lookup.
  - `list` — show cloned versions + npm latest
  - `clone` — fetch a version (shallow clone of the `effect@<version>` tag)
  - `search` — ripgrep a symbol/pattern across `packages/effect/src` (or platform, or all)
  - `read` — open a source file by repo-relative path
  - `search`/`read` **auto-clone** the version if missing
- **`/effect` command** — interactive version management (list / clone / remove / show cache dir)
- **Two skills** (contributed via `resources_discover`):
  - `effect-api-reference` — how to use `effect_api` to look up APIs + source layout
  - `effect-review` — the 10-category Effect.ts review checklist (purity, platform
    isolation, services/layers, error modeling, resource safety, concurrency,
    pipelines, testing, performance, observability) with severity levels

## Install

### Local (this repo)

```bash
# from the project root
pi -e ./src/index.ts
```

Or drop into auto-discovery:

```bash
ln -s "$PWD/src/index.ts" ~/.pi/agent/extensions/effect-ts.ts
```

### As a pi package

Add to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/zac-jung/pi-extension-effect-ts"]
}
```

(Adjust the git path to your fork.)

## Usage

The agent calls `effect_api` automatically when the skills are active. Example
flows:

```
# agent, internal:
effect_api({ action: "search", query: "export const all", package: "effect" })
  → lists file:line hits in packages/effect/src

effect_api({ action: "read", path: "packages/effect/src/Effect.ts" })
  → returns the (truncated) source
```

Manual version management:

```
/effect
```

## Notes

- **Cache**: `~/.pi/effect-ts-src/<version>/`. Shallow clones (~tens of MB each).
  Remove versions via `/effect` → Remove, or delete the dir directly.
- **Versions**: `"latest"` resolves via the npm registry (`effect` package).
  Pin a specific version like `"3.21.4"` for reproducible lookups.
- **`@effect/schema`** lives in a separate repo and is **not** cloned here. Use
  the built-in `read`/`grep` on your project's `node_modules/@effect/schema`.
- **Platform**: the clone pins the whole monorepo at the `effect@<version>` tag,
  so `packages/platform/src` reflects whatever platform version was in the
  monorepo at that snapshot.

## Self-check

```bash
bash scripts/selfcheck.sh        # default: 3.21.4
bash scripts/selfcheck.sh 3.21.4
```

End-to-end clone + structure + search against a temp dir. Requires `git`,
`ripgrep` (or falls back to `grep`), and network.
