# Repo split note + how to move the MariaDB backend changes

Backend and frontend are separate repos:
- Backend: https://github.com/peeter-afs/invoiceportal-backend
- Frontend: https://github.com/peeter-afs/invoiceportal-frontend

This directory (`/workspace/InvoicePortal`) is a legacy combined copy that accidentally received the MariaDB backend changes.

## Apply the MariaDB backend changes to the real backend repo

From your backend repo working copy (for example `/workspace/InvoicePortal-Backend` on this machine):

```bash
cd /workspace/InvoicePortal-Backend

# Apply patch (strips the transfer/patch-src2/{old,new}/ prefix)
patch -p3 < /workspace/InvoicePortal/transfer/out/invoiceportal-backend-mariadb.clean.patch

git status
git add -A
git commit -m "Switch backend to MariaDB (mysql2) + tenant-aware auth/invoices"
git push origin main
```

Note: In this Codex sandbox run I can’t write to `/workspace/InvoicePortal-Backend`, so the patch is generated here and needs to be applied/committed in the backend repo by you (or in an environment with permissions).

If you prefer `git apply`:

```bash
cd /workspace/InvoicePortal-Backend
git apply -p3 /workspace/InvoicePortal/transfer/out/invoiceportal-backend-mariadb.clean.patch
```

## Prepared backend repo with commit already made

I also created a ready-to-push copy of the backend repo (based on the existing backend repo history) here:
- `/workspace/InvoicePortal/prepared/invoiceportal-backend-ff`

It contains a commit on top of `origin/main`:
- `7dedde1 Switch backend to MariaDB (mysql2)`

To push it (in an environment with network access):

```bash
cd /workspace/InvoicePortal/prepared/invoiceportal-backend-ff
git push origin main
```

## Prepared frontend repo with docs note

Ready-to-push copy of the frontend repo (docs-only change) here:
- `/workspace/InvoicePortal/prepared/invoiceportal-frontend-ff`

It contains:
- `aa93d38 Docs: note frontend/backend are separate repos`

```bash
cd /workspace/InvoicePortal/prepared/invoiceportal-frontend-ff
git push origin main
```
