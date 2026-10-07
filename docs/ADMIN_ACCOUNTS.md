# Admin Account Tool

`apps/api/scripts/create_admin.py` — create, rotate or list ops-dashboard
admins. Writes straight to MongoDB using the API's own `.env`, so it targets
whatever that file points at.

## Usage

```powershell
cd F:\startup\voxora\apps\api

# See who exists
python scripts\create_admin.py --list

# Interactive (recommended: password is typed, not echoed)
python scripts\create_admin.py

# Non-interactive
python scripts\create_admin.py --email ops@you.com --password 'a-strong-one' --name "Ops"
```

`--yes` skips the "this is a REMOTE database" confirmation (required for
scripted use).

## Behaviour

| Situation | Result |
|---|---|
| Email does not exist | Creates a new admin |
| Email exists as an admin | **Rotates the password** and updates the name |
| Email exists as a fan/creator | Promotes to admin, unsets `is_suspended` / `deleted` |

Passwords must be at least 10 characters. A small deny-list rejects values that
have previously been defaults in this project (they are in the git history).
Both a length check and a confirmation prompt apply in interactive mode.

The tool prints the target host and DB before doing anything, and asks for
confirmation on a remote database, because pointing it at production by accident
is easy.

## Rotating a leaked admin password

```powershell
python scripts\create_admin.py --email admin@voxora.app
# then type the new password at the prompt
```

## Security note — read this

The existing admin account (`admin@voxora.app`) still has the **password it was
created with in the old `celebconnect-v2` codebase**. That value is committed to
this repo's history in `docs/FIX_PLAN.md` (P0-4) and in the old app's
`Login.tsx`, which is why the tool refuses to set it again.

Anyone with repo access can read it and sign into the ops dashboard — which can
force creators offline, approve/reject verifications, approve withdrawals, and
read financials. **Rotate it now:**

```powershell
python scripts\create_admin.py --email admin@voxora.app
```

Then also consider:

- Verify the GitHub repo is **private**.
- Keep `ALLOW_ADMIN_BOOTSTRAP=false` in production (`render.yaml` already sets
  it). Bootstrap only works while no admin exists, but leaving it on is
  unnecessary risk.
- The dashboard login page no longer pre-fills credentials (P0-4 fix), so there
  is no longer a second copy of the password in the UI.
