# Global Settings → Appearance (backend design system)

An operator can re-skin its entire UI from the admin — colours, fonts, radii,
shadows and per-component styling — and the change applies to **every user of
that operator, per role**, because the frontend hydrates its CSS variables from
these tokens at boot.

## Model

The stored value per `(tenant, scope)` is a **partial** theme — only the tokens
that were overridden. `scope` is `''` for the tenant-wide default, or a role code
(`owner`, `manager`, …) for a role override. The **effective** theme a user sees
is resolved by layering:

```
DEFAULT_THEME  ←  tenant override ('')  ←  role override (user's role)
```

`domain/theme.ts` is pure and tested: the token schema, `validateTheme` (hex +
range checks), `mergeTheme` (deep partial merge), `resolveTheme` (the 3-layer
precedence), and `tokensToCssVars`/`themeToCss` (the flat `--yb-*` projection the
frontend consumes). A save is validated before persist, so a bad value can never
brick the UI.

## API

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `GET`  | `/v1/appearance?role=` | any authed user | Effective theme (JSON) |
| `GET`  | `/v1/appearance/css?role=` | any authed user | Effective theme as `:root{…}` CSS |
| `GET`  | `/v1/appearance/admin/overview` | `tenant:manage` | Default + all overrides (editor) |
| `PUT`  | `/v1/appearance/tenant` | `tenant:manage` | Save tenant-wide override |
| `PUT`  | `/v1/appearance/role/:role` | `tenant:manage` | Save a role override |
| `DELETE` | `/v1/appearance/role/:role` | `tenant:manage` | Reset a role override |

Migration `0016_appearance_settings.sql` (`appearance_settings`, tenant-scoped RLS).
