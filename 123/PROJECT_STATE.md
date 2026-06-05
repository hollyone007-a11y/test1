# Webzdarma Pokladna - Project State

Last updated: 2026-05-17

## Project

Site: http://pokladna.kvalitne.cz

Local workspace:
`C:\Users\huquf\Documents\Codex\2026-05-16\webzdarma-cz`

Deploy command:
`powershell -ExecutionPolicy Bypass -File .\deploy-webzdarma.ps1 -RemoteRoot /web`

The deploy script uploads `www`, runs `/api/install`, then verifies login and dashboard.

Do not paste or expose secrets in chat. Existing local secret/config files are intentionally not summarized here.

## Stack

- PHP API in `www/api`
- Route files in `www/api/routes`
- MySQL schema and runtime migrations in `www/schema.sql` and `www/config/db.php`
- Frontend SPA in `www/assets/js/app.js`
- Styling in `www/assets/css/app.css`

## Important Behavior

- Admin sees and controls all data.
- Normal users must see only their own data.
- Normal users get default self-access in `www/config/security.php`.
- Server-side scoping is done with `has_global_scope()`, `require_employee_access()`, and `current_employee_filter()`.
- Keep privacy rules in API, not only in frontend menus.

## Implemented Modules

- Dashboard with personal employee info for normal users.
- Employees: company, object, accommodation, contract, passport, contacts, bank account, notes.
- Employee documents upload/list/delete.
- Companies.
- Objects.
- Timesheets with `pending`, `approved`, `rejected`.
- Check-ins with GPS, manual start/end time, automatic hour calculation.
- Salary calculation.
- Payouts: card, cash, remaining balance, print page.
- Advances.
- Cash register.
- Resources: SIM cards, vehicles, accommodations.
- Recruitment candidates with feedback.
- Permission blocks for user capabilities.
- Warehouse module:
  - Syncs Google Sheet `SUMA` only.
  - `data_e-mail` was removed by request.
  - Manual warehouse records can be added per employee/account.
  - Normal users see only their own warehouse data.
- Language switch: CS/UA.
- Dark responsive/mobile UI.

## Recent User Requirements

- Ordinary employee must see only personal information.
- Employee dashboard should show only their own card/info.
- Warehouse employee records should be attachable individually to each account.
- Warehouse data should show hours, efficiency, productivity, etc.
- `data_e-mail` must stay removed.

## Efficient Work Rules For Future Chats

1. Read this file first.
2. Do not re-read all files unless needed.
3. For UI changes, edit mainly:
   - `www/assets/js/app.js`
   - `www/assets/css/app.css`
4. For backend changes, edit route file plus:
   - `www/config/security.php` for permissions
   - `www/config/db.php` and `www/schema.sql` for tables/columns
5. Always run:
   - `node --check www\assets\js\app.js`
6. Deploy with:
   - `powershell -ExecutionPolicy Bypass -File .\deploy-webzdarma.ps1 -RemoteRoot /web`
7. Final answer should be short: what changed, whether deploy passed.

## Known Deploy Note

FTP root is `/web`, not `/www`.

The deploy script skips `.htaccess` uploads because FTP denied them before. Existing server `.htaccess` remains in place.

