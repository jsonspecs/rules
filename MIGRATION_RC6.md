# Migration from Rules 3.x / RC.5 to the historical RC.6 implementation

This guide describes repository revision
[`193a4a2`](https://github.com/jsonspecs/rules/commit/193a4a2), which implemented RC.6
before the `v4.0.0` release tag was created. The published Rules 4.0.0 package targets
RC.7; use [MIGRATION_RC7.md](MIGRATION_RC7.md) for the active migration. The RC.6
revision had no runtime flag or compatibility profile for RC.5.

## Snapshot

1. Change `specVersion` to `"1.0.0-rc.6"`.
2. Rebuild the snapshot and recompute `sourceHash` over the complete RC.6 snapshot.
3. To reproduce the historical behavior, use Rules repository revision `193a4a2`.
   Do not install the published `@jsonspecs/rules@4.0.0` package for an RC.6 snapshot:
   that package targets RC.7 and rejects RC.6.

An RC.5 snapshot is rejected with `UNSUPPORTED_SPEC_VERSION`, even when its artifact
shape is otherwise valid.

## Wildcard behavior

RC.5 selected existing terminal paths from a flat projection. RC.6 first enumerates
real array elements from the nested payload and then classifies each concrete terminal
path as present or absent.

For example, `items[*].sku` now has one candidate per real item. With `ALL + EACH`, a
`not_empty` rule reports a missing child as `items[1].sku` and omits `actual` from that
issue. A value operator still receives core-level `SKIP` for the same absent candidate.

Review these effects when rebuilding a package:

- `matched` includes absent structural candidates;
- value-operator absence increments `skipped`;
- an all-`SKIP` population remains `SKIP` and does not use `onEmpty`;
- `onEmpty` applies only when no structural candidate exists;
- absence before another `[*]` creates no branch because there is no real next index;
- non-empty containers at terminal `items[*]` remain absent and are not exposed to an
  operator.

Presence and value rules should remain separate. Use a presence operator with
`aggregate: { mode: "ALL", onEmpty: "SKIP", issueMode: "EACH" }` to require a child
field for every existing item. Keep collection-emptiness checks in their existing
business rule.

The complete behavior is defined by the pinned
[RC.6 specification](https://github.com/jsonspecs/spec/blob/d75024047437ce0119a28c6ceda818eb79c4f302/SPEC.md)
and its [migration guide](https://github.com/jsonspecs/spec/blob/d75024047437ce0119a28c6ceda818eb79c4f302/MIGRATION_RC6.md).
