# Migration notes (InstaConnect → Simple Talk)

Optional one-time import from celebconnect-v2 MongoDB.

## Map
| Old | New |
|-----|-----|
| `users` (user_type model) | `users` (user_type creator) + `creator_profiles` |
| `model_profiles` | `creator_profiles` |
| `wallets` | `wallets` (same fields) |
| `call_records` | optional historical import |
| appointments* | **skip** |

## Script

`apps/api/scripts/migrate_from_celebconnect.py` implements the map above. It is
idempotent (upserts by primary id) and never deletes.

```bash
cd apps/api
python scripts/migrate_from_celebconnect.py \
  --source "mongodb+srv://user:pass@old/celebconnect" --source-db celebconnect \
  --dest   "mongodb+srv://user:pass@new/voxora"    --dest-db voxora \
  --dry-run
# drop --dry-run to write; add --skip-calls to leave call history behind
```

What it does:
1. `users`: `user_type` `MODEL` → `creator` (lower-cased user/admin kept).
2. `model_profiles` → `creator_profiles`: `profile_images` → `images`, carries
   `is_approved`, `is_dnd`, rates, `category`, `languages`, `bio`; drops
   appointment-only fields.
3. `wallets`: copied as-is (`earnings_balance` preserved).
4. `call_records`: optional history import (`--skip-calls` to omit).
5. Skips every `appointments*` collection.
6. Rebuilds the core indexes after import.

After running, spot-check that `follows`, `reviews` and `transactions` still
reference the migrated `user_id`s, and that a migrated creator appears in Browse.


Run manually after soft-launch decision; empty DB is valid for a new brand launch.
