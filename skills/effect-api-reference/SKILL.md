---
name: effect-api-reference
description: 'Look up Effect.ts API signatures and behavior from version-pinned official source. Use when writing or reviewing Effect.ts code and you need to verify an API''s exact signature, error type, service shape, or version-specific behavior. Trigger: "effect api", "effect signature", "effect docs", "effect reference", "how does Effect.X work", "Effect.ts version".'
---

# Effect.ts API Reference (via `effect_api` tool)

## When to Use

- You are about to write or suggest an Effect.ts call and are unsure of the exact signature.
- A review depends on whether an API exists in the user's Effect version.
- You need the real error type or service interface shape (not a guess).
- Version-specific behavior matters (e.g. `Effect.all` concurrency options, `Data.TaggedError` call style).

Do **not** rely on memory for signatures. The Effect API has shifted across 3.x
minor releases. Spend one `effect_api` call to confirm.

## How It Works

The `effect_api` tool (read-only) searches and reads the official `effect-TS/effect`
monorepo source from a local cache at `~/.pi/effect-ts-src/<version>/`. A separate
`effect_api_clone` tool fetches versions into the cache.

**Two-tool split:**
- `effect_api` — `list` / `search` / `read`. Read-only. Does NOT clone. If a
  version isn't cached, it returns an error pointing to `effect_api_clone`.
- `effect_api_clone` — fetches a version (shallow clone of the `effect@<version>`
  tag) into the cache. This is the only write action.

Read-only agents (e.g. reviewers) get only `effect_api`; the main agent gets both.

## Workflow

1. **Ensure the version is cloned** — `effect_api_clone` with `version: "3.21.4"`
   (or omit version for `latest`). Skips if already cached. Only needed once per
   version.
2. **Find the symbol** — `effect_api` with `action: "search"`, `query: "<symbol>"`.
   Defaults to `version: "latest"` and `package: "effect"`.
   - Examples: `query: "export const succeed"`, `query: "TaggedError"`,
     `query: "acquireRelease"`.
   - Results show `file:line` with context. Pick the most relevant file.
3. **Read the source** — `effect_api` with `action: "read"`, `path: "<file>"`
   (the path printed by search, relative to repo root).
4. **Confirm the signature**, then write/review against the real one.

For platform APIs, pass `package: "platform"` to `search`.

> `@effect/schema` lives in a separate repo (`effect-TS/schema`) and is not
> cloned by this tool. Use the built-in `read`/`grep` tools against your
> project's `node_modules/@effect/schema` if you need schema source.

## Source Layout (monorepo)

| Package | Source dir |
|---------|-----------|
| `effect` | `packages/effect/src/` |
| `@effect/platform` | `packages/platform/src/` |
| `@effect/schema` | separate repo (not cloned) |

Common entry files under `packages/effect/src/`:

| Topic | File |
|-------|------|
| Core effects (`succeed`, `fail`, `gen`, `try`, `tryPromise`) | `Effect.ts` |
| Context / services / tags | `Context.ts` |
| Layers | `Layer.ts` |
| Errors & `Data` | `Data.ts`, `Cause.ts` |
| Scheduling | `Schedule.ts` |
| Streams | `Stream.ts` |
| Schema | `node_modules/@effect/schema` (separate repo) |
| Resource scoping | `Scope.ts` |

## Version Notes

- `version` accepts a concrete version like `"3.21.4"` or `"latest"`.
- The clone pins the **whole monorepo** at the `effect@<version>` tag, so
  platform source reflects whatever version was in the monorepo at that
  snapshot. If you need a platform-specific release, clone its own tag via
  `/effect` → Clone (e.g. `@effect/platform@0.x`).

## Tips

- Search by the exported name you'd type: `Effect.all`, `Context.Tag`,
  `Layer.effect`, `Data.TaggedError`.
- For JSDoc / doc comments, `read` the file — comments live above the
  declaration in source.
- If a search returns too much, narrow to one file: `action: "read"` on the
  likely file, then scan.
- Use `action: "list"` to see which versions are already cloned locally.

## Quick Reference (fallback when source lookup is overkill)

| Task | Constructor / Operator |
|------|------------------------|
| Pure success | `Effect.succeed(value)` |
| Recoverable error | `Effect.fail(error)` |
| Sync side effect (won't throw) | `Effect.sync(thunk)` |
| Sync that might throw | `Effect.try(thunk)` |
| Async (won't reject) | `Effect.promise(() => Promise)` |
| Async that might reject | `Effect.tryPromise(() => Promise)` |
| Defer construction | `Effect.suspend(() => effect)` |
| Sequential composition | `Effect.gen(function* () { ... })` |
| Map / flatMap / andThen / tap | `Effect.map`, `Effect.flatMap`, `Effect.andThen`, `Effect.tap` |
| Parallel collect | `Effect.all([fx1, fx2])` |
| Recover by tag | `Effect.catchTag("TagName", f)` |
| Service tag | `class S extends Context.Tag("S")<S, S>() {}` |
| Provide via layer | `Effect.provide(program, layer)` |

When the table conflicts with the source you read via `effect_api`, **the
source wins**.
