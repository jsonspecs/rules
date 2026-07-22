# Migration from 2.x to 3.0.0

Version 3 is a clean implementation of snapshot formatVersion 2. It does not compile
legacy source arrays or fv1 snapshots inside the runtime.

Applications still depending on the deprecated unscoped `jsonspecs` compatibility
package must switch their dependency and imports to `@jsonspecs/rules`; the unscoped
package remains on the 2.x compatibility line.

## Snapshot

- Replace `artifacts: []` with an object keyed by opaque artifact id; remove `id`
  from artifact values.
- Add explicit sorted `exports: [pipelineId, ...]`; remove pipeline `entrypoint`.
- Replace pipeline `flow` and object steps with `steps: [artifactId, ...]`.
- Remove `description`, snapshot `meta`, `engine`, `requires`, `strict`,
  `required_context`, and `stepId` from the executable bundle.
- Set `formatVersion: 2`, `specVersion: "1.0.0-rc.5"`, and recompute
  `sourceHash` over the whole snapshot without `sourceHash` using JCS.

## Rules and conditions

- Remove `role`. Every rule returns PASS/FAIL/SKIP and may be referenced from
  `when`; rule steps additionally require `issue`.
- Move `level`, `code`, `message`, and author `meta` into `issue`.
- Use `aggregate.mode: ALL | ANY | COUNT`; remove `EACH`, `MIN`, and `MAX` modes.
- Remove regex `flags` and legacy backslash preprocessing.
- Conditions retain separate artifacts but use string `steps` and exact rule ids in
  `when`.

## Runtime API

```diff
- engine.compile(artifactArray)
- engine.runPipeline(prepared, pipelineId, payload, options)
+ engine.compileSnapshot(snapshot)
+ engine.runPipeline(prepared, { pipelineId, payload, context })
```

The result no longer contains `control`, `trace`, `engineVersion`, `kind`, or
`stepId`. Technical failures use the closed ABORT contract; business EXCEPTION is an
issue level.

## Custom operators

Replace `{check, predicate}` functions receiving `(rule, ctx)` with one immutable
name bound to `{schema, evaluate}`. Move payload dependencies into standard operands
or named `inputs`, constants into `params`, and return only PASS/FAIL/SKIP.
