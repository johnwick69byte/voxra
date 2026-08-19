# Migration notes (InstaConnect → Voxora)

Optional one-time import from celebconnect-v2 MongoDB.

## Map
| Old | New |
|-----|-----|
| `users` (user_type model) | `users` (user_type creator) + `creator_profiles` |
| `model_profiles` | `creator_profiles` |
| `wallets` | `wallets` (same fields) |
| `call_records` | optional historical import |
| appointments* | **skip** |

## Script outline
1. Export approved models + users + wallets from old DB
2. Rewrite `user_type: model` → `creator`
3. Insert into `voxora` DB with new indexes
4. Do not migrate appointment collections

Run manually after soft-launch decision; empty DB is valid for a new brand launch.
