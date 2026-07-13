---
name: effect-review
description: 'Review TypeScript code that uses Effect.ts. Checks side-effect purity, platform dependency isolation, service/layer DI patterns, error modeling, resource safety, concurrency, and overall Effect best practices. Trigger: "effect review", "review effect", "effect.ts code review", "effect best practices", "effect anti-pattern", "effect 리뷰".'
---

# Effect.ts Review

## Overview

Structured checklist for reviewing Effect.ts codebases: explicit error
tracking, proper side-effect management, platform-agnostic design, dependency
injection via Context/Layer, fiber-safe concurrency, and resource safety.

**When in doubt about an API, verify it with the `effect_api` tool**
(see the `effect-api-reference` skill) rather than asserting from memory.
If a version isn't cloned yet, call `effect_api_clone` first, then use
`effect_api` to search/read.

## When to Use

- Reviewing a PR or file that imports from `effect` / `@effect/platform` / `@effect/schema`
- Auditing an Effect.ts codebase for anti-patterns
- Refactoring imperative code to Effect
- Onboarding a team member to Effect conventions

## Review Checklist

### 1. Side Effects & Purity

| Check | Anti-Pattern | Correct |
|-------|--------------|---------|
| All side effects wrapped in `Effect` constructors | `const id = generateId()` at top level | `Effect.sync(() => generateId())` or `Effect.try(() => riskyOp())` |
| No `throw` inside `Effect.gen` | `throw new Error("fail")` in generator | `yield* Effect.fail(new MyError())` |
| Promise rejections caught | `Effect.promise(() => fetch())` when fetch may reject | `Effect.tryPromise({ try: () => fetch(), catch: (e) => ... })` |
| Lazy evaluation for dynamic values | Capturing mutable vars at effect creation time | `Effect.suspend(() => effectUsingMutableState)` |
| No untracked fire-and-forget promises | `fetch()` without returning or yielding | Return the Effect or `Effect.forkDaemon` intentionally |
| Use `Clock` for time, not `Date` | `new Date()` / `Date.now()` in business logic | `yield* Clock.currentTimeMillis` |
| Use `Random` for randomness | `Math.random()` in logic | `yield* Random.next` |

Ask:
- Is this function pure? If not, wrapped in `Effect.sync` / `try` / `tryPromise`?
- Any hidden `throw` inside generators or callbacks?
- Is construction deferred with `Effect.suspend` when it depends on runtime state?

### 2. Platform Dependency Isolation

| Check | Anti-Pattern | Correct |
|-------|--------------|---------|
| No direct `process.env` in business logic | `process.env.API_KEY` deep in `Effect.gen` | `Config.string("API_KEY")` or a service |
| No direct Node.js `fs` / `path` in domain code | `fs.readFileSync` in a `.program.ts` | `FileSystem` service provided via Layer |
| No direct `fetch` / `window` / `globalThis` | Hard-coded `fetch(url)` | `HttpClient` service or `@effect/platform` |
| Platform specifics live in `.layer.ts` / infra | Browser APIs mixed with business rules | Platform layer provides capabilities; programs stay portable |

Ask:
- Would this code break in a different environment (browser → Node → edge)?
- Are platform APIs abstracted behind a `Context.Tag`?

### 3. Services & Dependency Injection (Context / Layer)

| Check | Anti-Pattern | Correct |
|-------|--------------|---------|
| Services as interfaces + `Context.Tag` | Passing services through every function param | `interface Foo { ... }; class Foo extends Context.Tag("Foo")<Foo, Foo>() {}` |
| Tag key unique and descriptive | `Context.Tag<Database>("@effect/Database")` | `class Database extends Context.Tag("MyApp/Database")<Database, Database>() {}` |
| Logic depends on `R` (Requirements), not concrete impl | Hard-coding `new PostgresClient()` in program | `yield* Database`; impl provided by Layer |
| Layers compose with `Layer.merge` / `Layer.provide` | Manual DI wiring at every entrypoint | `Layer.mergeAll(DatabaseLive, LoggerLive, ...)` |
| Live vs Test layers separate | One layer for prod and tests | `DatabaseLive`, `DatabaseMock`, `DatabaseTest` |
| Service methods return `Effect` | Methods that throw or return bare promises | `query: (sql) => Effect<Row[], QueryError>` |

Ask:
- Is this service abstracted behind a tag?
- Could I swap this impl (mock, test double) without touching program code?
- Are layers composed at the application boundary, not inside functions?

### 4. Error Modeling

| Check | Anti-Pattern | Correct |
|-------|--------------|---------|
| Recoverable errors in `E` channel | `throw` or `unknown` error types | `Data.TaggedError("DomainError")<{ ... }>()` |
| Defects (bugs) use `Effect.die` / `orDie` | Recoverable errors treated as defects | Network timeout → `E`; division by zero → `die` |
| Discriminated errors with `_tag` | `new Error("foo")` + string matching | `class FooError extends Data.TaggedError("FooError")<{}>()` |
| Error types domain-specific | Generic `Error` everywhere | `UserNotFound`, `PaymentDeclined` |
| Expected errors handled explicitly | `catchAll(() => Effect.succeed(default))` swallowing context | `catchTag`, `catchIf`, `matchEffect` with intent |

Ask:
- Is every failure mode represented in the error type?
- Can a caller distinguish "not found" vs "network error" at the type level?
- Are programmer bugs (defects) separated from expected failures?

### 5. Resource Safety

| Check | Anti-Pattern | Correct |
|-------|--------------|---------|
| Acquire-release for scoped resources | `const conn = db.connect(); try { ... } finally { conn.close() }` | `Effect.acquireRelease(open, close)` |
| `Scope` for composite resources | Manual cleanup lists | `Effect.gen(function* () { const scope = yield* Scope.make; ... })` |
| Finalizers guaranteed | Cleanup that might throw before running | `Effect.ensuring`, `Effect.onExit`, `Effect.acquireRelease` |

### 6. Concurrency & Fibers

| Check | Anti-Pattern | Correct |
|-------|--------------|---------|
| Parallel work uses `Effect.all` / `Effect.forEach` | `await Promise.all([...])` mixed with Effect | `Effect.all([fx1, fx2], { concurrency: "unbounded" })` |
| Fiber supervision intentional | Fire-and-forget without joining/supervising | `Effect.fork`, `Fiber.join`, `Effect.onExit` |
| Race conditions handled | `Promise.race` without cancellation | `Effect.race`, `Effect.timeout`, `Effect.interruptible` |
| Blocking ops offloaded | `Effect.sync(() => heavySyncWork)` on main fiber | `.pipe(Effect.withSpan("heavy"), Effect.fork)` |
| Shared state via `Ref` / `SynchronizedRef` | Mutable `let counter = 0` across fibers | `yield* Ref.make(0)` then `Ref.update(ref, n => n + 1)` |

### 7. Pipelines & Composability

| Check | Anti-Pattern | Correct |
|-------|--------------|---------|
| Prefer `pipe` or `Effect.gen` over nested callbacks | Pyramid of `.then().catch()` | `Effect.gen` / `pipe` + operators |
| `flatMap` chains readable | Deep `.pipe(Effect.flatMap(...), Effect.flatMap(...))` | Extract named effects or use `Effect.gen` |
| `Effect.tap` for side-effect logging | `Effect.map(x => { log(x); return x })` | `Effect.tap(x => Effect.log(x))` |
| `Effect.andThen` used appropriately | `Effect.flatMap(x => Effect.succeed(f(x)))` | `Effect.andThen` (auto-detects pure vs Effect) |
| No unused effects in pipelines | `Effect.flatMap(x => { someEffect; return Effect.succeed(x) })` | `Effect.andThen(someEffect)` or `Effect.zipRight` |

### 8. Testing & Layer Provisioning

| Check | Anti-Pattern | Correct |
|-------|--------------|---------|
| Programs runnable without manual DI | Tests construct full service graph manually | Provide a `TestLayer` and run with `Effect.provide` |
| Side effects swapped in tests | Tests hit real database / API | Mock layers replace `HttpClient`, `Database`, `Clock` |
| Time is controllable | `Date.now()` or real timers in tests | `TestClock.adjust` or custom `Clock` layer |
| Effects asserted properly | `await runPromise(effect)` without error checks | `Effect.runPromiseExit`, `Effect.either`, vitest/jest assertions |

### 9. Performance & Scheduling

| Check | Anti-Pattern | Correct |
|-------|--------------|---------|
| Retries use `Schedule` | `for (let i = 0; i < 3; i++) { try ... }` | `Effect.retry(effect, Schedule.recurs(3))` |
| Timeouts explicit | Hanging effects with no timeout | `Effect.timeout("5 seconds")` |
| Batching / caching considered | Repeated identical requests | `Effect.cached`, `Effect.cachedInvalidateWithTTL` |
| Resource pools for connections | New connection per request | `Effect.acquireRelease(pool.get(), pool.release)` |

### 10. Observability

| Check | Anti-Pattern | Correct |
|-------|--------------|---------|
| Spans for traced effects | No insight into execution | `Effect.withSpan("operation-name")` |
| Logging via `Effect.log` | `console.log` scattered | `Effect.log("message")` or `yield* Effect.log("message")` |
| Metrics recorded intentionally | No visibility on throughput/latency | `Metric.counter`, `Metric.histogram` |

## Severity Levels

| Level | Meaning | Example |
|-------|---------|---------|
| **BLOCKER** | Runtime bugs or defects | `throw` inside `Effect.gen`, unhandled rejections |
| **HIGH** | Breaks portability or testability | Platform APIs in domain code, missing service abstraction |
| **MEDIUM** | Reduces composability or clarity | Missing `suspend`, poorly modeled errors, nested callbacks |
| **LOW** | Style / convention | `flatMap` where `andThen` suffices, missing `tap` |
| **INFO** | Suggestion | Add `Schedule` for retries, consider `withSpan` |

## Review Workflow

1. **Read the diff/files fully** before climbing the ladder. Trace the real
   flow end to end — every file the change touches.
2. Run the checklist above. For each finding, **verify the API against source**
   via `effect_api` (`action: search` then `read`) when you are not 100% sure
   of a signature, error type, or whether an API exists in the target version.
3. Report findings grouped by severity. For each finding:
   1. **Location** (file, line)
   2. **Issue** (which checklist item is violated)
   3. **Severity**
   4. **Suggested fix** (with corrected code when helpful)
   5. **Rationale** (why this matters in Effect.ts)

Only flag real problems. Do not invent issues to seem thorough. If code is
fine, say so.

## File Organization Reference

Naming is convention, not law — the **separation of concerns** matters more
than the suffix.

| Suffix | Typical Responsibility |
|--------|------------------------|
| `*.error.ts` | `Data.TaggedError` definitions |
| `*.service.ts` | Service interface + `Context.Tag` |
| `*.layer.ts` | Layer implementations (live, mock, test) |
| `*.program.ts` | Business logic, `Effect.gen` pipelines |
| `*.test.ts` | `Effect.runPromiseExit` assertions with `Layer` provisioning |

> Review tip: if the path doesn't match the pattern, judge whether the code
> sits at the right abstraction level (no platform API leaking into business
> logic) rather than whether the name is "correct".
