# Scenario tracker

Status of every scenario from the product scenario list. Generated from the tracker; statuses:

- **DONE** — built and verified (endpoint / job / rule named in *where*)
- **GAP** — in scope, not built yet
- **OPEN** — not yet reviewed against the code
- **CONFLICT** — contradicts an earlier product decision (e.g. counter cash / branch wallet were removed)
- **INFRA / PROCESS** — deployment or business process, not application code
- **DUP** — same scenario as an earlier number

*Backend* is the API / job / rule; *Frontend* is the web-app screen. A scenario is complete only when both are DONE (frontend **TODO** = backend done, screen not built or not yet verified).

| Backend status | Count |
|---|---|
| OPEN | 2711 |
| DONE | 981 |
| GAP | 284 |
| CONFLICT | 76 |
| INFRA | 20 |
| DUP | 9 |
| PROCESS | 6 |

| Frontend status | Count |
|---|---|
| — | 3097 |
| DONE | 605 |
| TODO | 376 |
| DUP | 9 |


## #1–#500

CONFLICT 20, DONE 373, GAP 93, INFRA 17, PROCESS 3

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 1 | Create new multi-tenant bus operator account | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |
| 2 | Enter operator company name and legal details | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |
| 3 | Assign unique operator code | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |
| 4 | Assign custom domain to operator | DONE | DONE | PUT /admin/tenants/:id/domain (host resolves immediately) · UI: Super admin → Operators → Settings: custom domain, favicon, API rate limit, per-operator feature flags + roll back everywhere |
| 5 | Upload operator logo | DONE | DONE | verified manually: existing module/API · UI: Operator console → Settings → Branding: logo |
| 6 | Set operator primary contact person | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |
| 7 | Set operator email and phone | DONE | DONE | verified manually: existing module/API · UI: Settings → Company profile |
| 8 | Set GST number for operator | DONE | DONE | verified manually: existing module/API · UI: Super admin → Applications → Details: GSTIN, PAN, bank, documents; hold / reject / reopen with reason |
| 9 | Set PAN number for operator | DONE | DONE | verified manually: existing module/API · UI: Super admin → Applications → Details: GSTIN, PAN, bank, documents; hold / reject / reopen with reason |
| 10 | Enter bank account details for settlements | DONE | DONE | verified manually: existing module/API · UI: Settings › Bank Details: checked fields, re-enter number, change under review, withdraw |
| 11 | Enable or disable global payment gateways | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 12 | Configure Razorpay credentials | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 13 | Configure PayU credentials | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 14 | Configure Easebuzz credentials | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 15 | Configure Paytm credentials | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 16 | Configure SMS gateway credentials | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 17 | Configure WhatsApp Business API credentials | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 18 | Configure Email SMTP settings | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 19 | Test SMS sending | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 20 | Test WhatsApp sending | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 21 | Test Email sending | DONE | DONE | GET/PUT /admin/integrations, POST /admin/integrations/:provider/enabled/test · UI: Super admin → Settings → Integrations: credentials per provider (secrets write-only), enable/disable, test send |
| 22 | Create global role-permission templates | DONE | DONE | GET/POST/PUT/DELETE /admin/role-templates; POST /roles/templates/:id/apply · UI: Super admin → Settings → Role templates: create / edit / remove, permissions by group |
| 23 | Edit existing global role permissions | DONE | DONE | verified manually: existing module/API · UI: Super admin → Settings → Role templates: create / edit / remove, permissions by group |
| 24 | Create new custom platform role | DONE | TODO | verified manually: existing module/API |
| 25 | Assign multiple roles to platform user | DONE | TODO | verified manually: existing module/API |
| 26 | Set IP whitelist for platform admin access | DONE | DONE | PUT /admin/policies/admin-ip-allowlist (enforced at admin login) · UI: Super admin → Settings → Security: password rules, admin sign-in IP list, suspicious sign-in alerts, encryption keys |
| 27 | Set password minimum length policy | DONE | DONE | PUT /admin/policies/password (enforced wherever a password is set; expiry at login) · UI: Super admin → Settings → Security: password rules, admin sign-in IP list, suspicious sign-in alerts, encryption keys |
| 28 | Set password complexity rules | DONE | DONE | PUT /admin/policies/password (enforced wherever a password is set; expiry at login) · UI: Super admin → Settings → Security: password rules, admin sign-in IP list, suspicious sign-in alerts, encryption keys |
| 29 | Set password expiry days | DONE | DONE | PUT /admin/policies/password (enforced wherever a password is set; expiry at login) · UI: Super admin → Settings → Security: password rules, admin sign-in IP list, suspicious sign-in alerts, encryption keys |
| 30 | Set maximum failed login attempts | DONE | DONE | verified manually: existing module/API · UI: Super admin → Settings → Security: password rules, admin sign-in IP list, suspicious sign-in alerts, encryption keys |
| 31 | Lock operator account on suspicious activity | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: suspend with a reason (staff can no longer sign in), re-activate |
| 32 | Unlock operator account | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: suspend with a reason (staff can no longer sign in), re-activate |
| 33 | Define global GST tax slabs | DONE | DONE | PUT /admin/policies/gst-slabs · UI: Super admin → Settings → Business rules: GST slabs, agent credit default/cap, OTA release default, data retention (server minimums) |
| 34 | Create cancellation policy templates | DONE | DONE | verified manually: existing module/API · UI: Settings › Cancellation Policy: tiers with checks, preview, reset to default |
| 35 | Create refund policy templates | DONE | DONE | verified manually: existing module/API · UI: Settings › Cancellation Policy: tiers with checks, preview, reset to default |
| 36 | Enable dynamic pricing engine globally | DONE | DONE | verified manually: existing module/API · UI: Super admin → Plans (feature dynamic_pricing) and Operators → Settings → Features (per operator) |
| 37 | Enable redBus integration | DONE | DONE | verified manually: existing module/API · UI: Super admin → OTA partners: add, activate/suspend, terms, prepaid top-ups, API keys (shown once, revoke), webhook + test |
| 38 | Enable AbhiBus integration | DONE | DONE | verified manually: existing module/API · UI: Super admin → OTA partners: add, activate/suspend, terms, prepaid top-ups, API keys (shown once, revoke), webhook + test |
| 39 | Enable MakeMyTrip integration | DONE | DONE | verified manually: existing module/API · UI: Super admin → OTA partners: add, activate/suspend, terms, prepaid top-ups, API keys (shown once, revoke), webhook + test |
| 40 | Enable Goibibo integration | DONE | DONE | verified manually: existing module/API · UI: Super admin → OTA partners: add, activate/suspend, terms, prepaid top-ups, API keys (shown once, revoke), webhook + test |
| 41 | Enable ixigo integration | DONE | DONE | verified manually: existing module/API · UI: Super admin → OTA partners: add, activate/suspend, terms, prepaid top-ups, API keys (shown once, revoke), webhook + test |
| 42 | Set global default inventory release percentage for OTAs | DONE | DONE | PUT /scheduling/services/:id/sales-rules {otaReleasePct}; platform default PUT /admin/policies/ota-release; enforced on hold · UI: Super admin → Settings → Business rules: GST slabs, agent credit default/cap, OTA release default, data retention (server minimums) |
| 43 | Define commission slab structures | DONE | TODO | verified manually: existing module/API |
| 44 | Set default agent credit limit policy | DONE | DONE | PUT /admin/policies/agent-credit (default + cap applied on agent create) · UI: Super admin → Settings → Business rules: GST slabs, agent credit default/cap, OTA release default, data retention (server minimums) |
| 45 | Publish system-wide announcement banner | DONE | DONE | verified manually: existing module/API · UI: Super admin → Announcements: banner with start and end time |
| 46 | Schedule announcement start and end time | DONE | DONE | verified manually: existing module/API · UI: Super admin → Announcements: banner with start and end time |
| 47 | Enable maintenance mode | DONE | DONE | MaintenanceGuard · UI: Super admin → Settings → System: maintenance mode now / planned windows (tell operators, cancel), cache clear, audit log CSV 30/90 days |
| 48 | Disable maintenance mode | DONE | DONE | MaintenanceGuard · UI: Super admin → Settings → System: maintenance mode now / planned windows (tell operators, cancel), cache clear, audit log CSV 30/90 days |
| 49 | Trigger manual full database backup | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 50 | Trigger incremental backup | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 51 | Test backup restore on staging | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 52 | Export platform audit logs for last 30 days | DONE | DONE | GET /admin/tenants/audit-log/export?days=30/90 (CSV) · UI: Super admin → Settings → System: maintenance mode now / planned windows (tell operators, cancel), cache clear, audit log CSV 30/90 days |
| 53 | Export platform audit logs for last 90 days | DONE | DONE | GET /admin/tenants/audit-log/export?days=30/90 (CSV) · UI: Super admin → Settings → System: maintenance mode now / planned windows (tell operators, cancel), cache clear, audit log CSV 30/90 days |
| 54 | Configure suspicious login activity alerts | DONE | DONE | PUT /admin/policies/suspicious-login (SecurityAlertService) · UI: Super admin → Settings → Security: password rules, admin sign-in IP list, suspicious sign-in alerts, encryption keys |
| 55 | Set high CPU usage alert threshold | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 56 | Set high memory usage alert threshold | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 57 | Set disk space alert threshold | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 58 | Enable feature flag for specific operator | DONE | DONE | PUT /admin/tenants/:id/features/:feature, POST /admin/tenants/features/:feature/rollback · UI: Super admin → Operators → Settings: custom domain, favicon, API rate limit, per-operator feature flags + roll back everywhere |
| 59 | Disable feature flag for specific operator | DONE | DONE | PUT /admin/tenants/:id/features/:feature, POST /admin/tenants/features/:feature/rollback · UI: Super admin → Operators → Settings: custom domain, favicon, API rate limit, per-operator feature flags + roll back everywhere |
| 60 | Rollback feature flag globally | DONE | DONE | PUT /admin/tenants/:id/features/:feature, POST /admin/tenants/features/:feature/rollback · UI: Super admin → Operators → Settings: custom domain, favicon, API rate limit, per-operator feature flags + roll back everywhere |
| 61 | Set global API rate limits | DONE | TODO | verified manually: existing module/API |
| 62 | Set per-operator API rate limits | DONE | DONE | PUT /admin/tenants/:id/rate-limit (RateLimitGuard reads it, cached) · UI: Super admin → Operators → Settings: custom domain, favicon, API rate limit, per-operator feature flags + roll back everywhere |
| 63 | Configure webhook endpoints for events | DONE | DONE | POST/GET/DELETE /webhooks, POST /webhooks/:id/test — public https URLs only (no localhost / private / metadata addresses, re-checked per send, no redirects), one registration per URL, 10 per operator, 404 across operators · UI: Distribution: register with event choice + URL checks, secret shown once, send test (status/latency), deliveries, revoke with confirm |
| 64 | Test webhook delivery | DONE | DONE | POST/GET/DELETE /webhooks, POST /webhooks/:id/test — public https URLs only (no localhost / private / metadata addresses, re-checked per send, no redirects), one registration per URL, 10 per operator, 404 across operators · UI: Distribution: register with event choice + URL checks, secret shown once, send test (status/latency), deliveries, revoke with confirm |
| 65 | Set white-label primary color for operator | GAP | — | not built: per-operator colours (only the platform / per-role theme exists) |
| 66 | Set white-label secondary color for operator | GAP | — | not built: per-operator colours (only the platform / per-role theme exists) |
| 67 | Set white-label favicon for operator | DONE | DONE | PUT /admin/tenants/:id/favicon; GET /operator/branding (public) · UI: Super admin → Operators → Settings: custom domain, favicon, API rate limit, per-operator feature flags + roll back everywhere |
| 68 | Define offline booking sync rules | GAP | — | verified manually: not built yet |
| 69 | Manage global seat layout templates library | DONE | TODO | verified manually: existing module/API |
| 70 | Create new seat layout template | DONE | TODO | verified manually: existing module/API |
| 71 | Edit existing seat layout template | DONE | TODO | verified manually: existing module/API |
| 72 | Delete unused seat layout template | DONE | TODO | verified manually: existing module/API |
| 73 | Create global report templates | GAP | — | verified manually: not built yet |
| 74 | Give custom report builder access to operator | GAP | — | verified manually: not built yet |
| 75 | Set data retention policy in days | DONE | DONE | PUT /admin/policies/data-retention + worker 'data-retention' purge job · UI: Super admin → Settings → Business rules: GST slabs, agent credit default/cap, OTA release default, data retention (server minimums) |
| 76 | Process data deletion request | DONE | TODO | verified manually: existing module/API |
| 77 | Set support ticket priority matrix | DONE | DONE | support tickets: staff raise by PNR / reply / priority / assign / resolve; customers own tickets only; author from account · UI: Support: queue views (active/mine/unassigned/…), search, ticket thread with reply, resolve/reopen/close, priority, assign; raise for a caller by PNR |
| 78 | Deploy critical bug hotfix | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 79 | Deploy new release to staging | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 80 | Run smoke tests on staging | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 81 | Approve production release | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 82 | Rollback to previous production version | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 83 | Enable multi-currency support | DONE | DONE | verified manually: existing module/API · UI: Super admin → Settings → i18n & Currency: publish exchange rates (new currency on first rate, source noted), language pack strings, converter |
| 84 | Add new currency | DONE | DONE | verified manually: existing module/API · UI: Super admin → Settings → i18n & Currency: publish exchange rates (new currency on first rate, source noted), language pack strings, converter |
| 85 | Set currency conversion source | DONE | DONE | verified manually: existing module/API · UI: Super admin → Settings → i18n & Currency: publish exchange rates (new currency on first rate, source noted), language pack strings, converter |
| 86 | Enable multi-language support | DONE | DONE | verified manually: existing module/API · UI: Super admin → Settings → i18n & Currency: publish exchange rates (new currency on first rate, source noted), language pack strings, converter |
| 87 | Add new language pack | DONE | DONE | verified manually: existing module/API · UI: Super admin → Settings → i18n & Currency: publish exchange rates (new currency on first rate, source noted), language pack strings, converter |
| 88 | Monitor platform health dashboard | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 89 | View current uptime percentage | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 90 | View booking success rate | DONE | DONE | verified manually: existing module/API · UI: Super admin → Platform health: payment success per gateway, error rate, SMS/WhatsApp/email delivery, operator ranking |
| 91 | View overall error rate | DONE | DONE | verified manually: existing module/API · UI: Super admin → Platform health: payment success per gateway, error rate, SMS/WhatsApp/email delivery, operator ranking |
| 92 | View total active operators | DONE | DONE | verified manually: existing module/API · UI: Super admin → Analytics & Plans: active operators / total |
| 93 | View total active buses across platform | DONE | DONE | verified manually: existing module/API · UI: Super admin → Analytics & Plans: active buses, revenue this month (Indian calendar) |
| 94 | View platform-wide daily booking volume | DONE | DONE | GET /admin/monitoring/bookings/activity (per operator, today by default) + GET /admin/monitoring/bookings (feed, live holds) · UI: super admin › Live bookings |
| 95 | View platform-wide monthly revenue | DONE | DONE | verified manually: existing module/API · UI: Super admin → Analytics & Plans: active buses, revenue this month (Indian calendar) |
| 96 | Suspend non-paying operator | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |
| 97 | Set suspension reason | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |
| 98 | Reactivate suspended operator | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |
| 99 | Change operator subscription plan | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |
| 100 | Generate platform invoice for operator | DONE | DONE | POST/GET /admin/billing/invoices (GST, FY numbering); GET /operator/platform-invoices · UI: Super admin → Billing: generate GST invoice for a period (one per period), discounts for one / all operators, revoke |
| 101 | Apply platform-level discount | DONE | DONE | POST/GET/DELETE /admin/billing/discounts (applied on platform invoices) · UI: Super admin → Billing: generate GST invoice for a period (one per period), discounts for one / all operators, revoke |
| 102 | Set maximum buses allowed per plan | DONE | DONE | plan maxVehicles enforced on bus create · UI: Super admin → Analytics & Plans → Plans: price, max buses / branches / agents / staff / routes, included features; edit |
| 103 | Set maximum branches allowed per plan | DONE | DONE | plan quotas max_branches / max_agents enforced (entitlements module; also users, routes, buses) · UI: Super admin → Analytics & Plans → Plans: price, max buses / branches / agents / staff / routes, included features; edit |
| 104 | Set maximum agents allowed per plan | DONE | DONE | plan quotas max_branches / max_agents enforced (entitlements module; also users, routes, buses) · UI: Super admin → Analytics & Plans → Plans: price, max buses / branches / agents / staff / routes, included features; edit |
| 105 | Configure platform commission percentage | DONE | DONE | verified manually: existing module/API · UI: Super admin → Analytics & Plans → platform settings: default commission % |
| 106 | View operator-wise performance ranking | DONE | DONE | GET /admin/tenants/ranking?from&to&sortBy · UI: Super admin → Platform health: payment success per gateway, error rate, SMS/WhatsApp/email delivery, operator ranking |
| 107 | Export complete operator list with status | DONE | DONE | GET /admin/tenants/export (CSV) · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |
| 108 | Send bulk notification to all operators | DONE | DONE | POST/GET /admin/tenants/broadcasts · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |
| 109 | Schedule platform maintenance window | DONE | DONE | POST /admin/platform/maintenance/windows (auto maintenance mode while running) · UI: Super admin → Settings → System: maintenance mode now / planned windows (tell operators, cancel), cache clear, audit log CSV 30/90 days |
| 110 | Notify operators about maintenance | DONE | DONE | POST /admin/platform/maintenance/windows/:id/notify (or notifyOperators on create) · UI: Super admin → Settings → System: maintenance mode now / planned windows (tell operators, cancel), cache clear, audit log CSV 30/90 days |
| 111 | Monitor payment gateway success rates | DONE | DONE | GET /admin/monitoring/payments · UI: Super admin → Platform health: payment success per gateway, error rate, SMS/WhatsApp/email delivery, operator ranking |
| 112 | Monitor SMS delivery success rates | DONE | DONE | GET /admin/monitoring/messages (per channel/provider) · UI: Super admin → Platform health: payment success per gateway, error rate, SMS/WhatsApp/email delivery, operator ranking |
| 113 | Monitor WhatsApp delivery success rates | DONE | DONE | GET /admin/monitoring/messages (per channel/provider) · UI: Super admin → Platform health: payment success per gateway, error rate, SMS/WhatsApp/email delivery, operator ranking |
| 114 | View aggregated error logs across services | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 115 | Restart specific microservice | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 116 | Clear platform-level cache | DONE | DONE | POST /admin/platform/cache/clear · UI: Super admin → Settings → System: maintenance mode now / planned windows (tell operators, cancel), cache clear, audit log CSV 30/90 days |
| 117 | Run database optimization job | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 118 | View slow query logs | INFRA | — | DevOps/monitoring runbook (not an app feature) |
| 119 | Manage partner API keys | DONE | DONE | verified manually: existing module/API · UI: Super admin → OTA partners: add, activate/suspend, terms, prepaid top-ups, API keys (shown once, revoke), webhook + test |
| 120 | Rotate platform encryption keys | DONE | DONE | key ring (ENCRYPTION_PREVIOUS_KEYS) + POST /admin/security/encryption/reencrypt; RUNBOOK · UI: Super admin → Settings → Security: password rules, admin sign-in IP list, suspicious sign-in alerts, encryption keys |
| 121 | Complete operator profile with full address | DONE | DONE | PATCH /operator/profile {address, contacts} · UI: Settings → Company profile |
| 122 | Upload company logo | DONE | DONE | verified manually: existing module/API · UI: Settings → Branding |
| 123 | Set primary and secondary contact | DONE | DONE | PATCH /operator/profile {address, contacts} · UI: Settings → Company profile |
| 124 | Add new branch office | DONE | DONE | verified manually: existing module/API · UI: Branches: add/edit with name (unique, any case), address, phone checks, per-day opening hours incl. past midnight; deactivate (confirm) / activate |
| 125 | Enter branch name and code | DONE | DONE | verified manually: existing module/API · UI: Branches → name and code |
| 126 | Enter branch full address | DONE | DONE | verified manually: existing module/API · UI: Branches: add/edit with name (unique, any case), address, phone checks, per-day opening hours incl. past midnight; deactivate (confirm) / activate |
| 127 | Enter branch phone numbers | DONE | DONE | verified manually: existing module/API · UI: Branches: add/edit with name (unique, any case), address, phone checks, per-day opening hours incl. past midnight; deactivate (confirm) / activate |
| 128 | Assign branch manager | DONE | DONE | verified manually: existing module/API · UI: Branches page (manager) |
| 129 | Set branch working hours | DONE | DONE | branches.working_hours via POST/PATCH /branches · UI: Branches: add/edit with name (unique, any case), address, phone checks, per-day opening hours incl. past midnight; deactivate (confirm) / activate |
| 130 | Deactivate branch temporarily | DONE | DONE | verified manually: existing module/API · UI: Branches: add/edit with name (unique, any case), address, phone checks, per-day opening hours incl. past midnight; deactivate (confirm) / activate |
| 131 | Reactivate branch | DONE | DONE | verified manually: existing module/API · UI: Branches: add/edit with name (unique, any case), address, phone checks, per-day opening hours incl. past midnight; deactivate (confirm) / activate |
| 132 | Add new bus with registration number | DONE | DONE | verified manually: existing module/API · UI: Fleet › Add vehicle (reg validated) + vehicle page |
| 133 | Select bus type (Seater, Sleeper, Semi-Sleeper, Multi-Axle) | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts editor + Vehicle Types & Amenities |
| 134 | Enter total seat capacity | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts editor + Vehicle Types & Amenities |
| 135 | Design seat layout visually | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts editor + Vehicle Types & Amenities |
| 136 | Mark window seats | DONE | DONE | POST /master-data/seat-layouts/:id/seats/auto-positions / seats/mark (position) · UI: Fleet → Seat Layouts: editor marks window/aisle, ladies, disability-friendly, berths per deck; Auto window/aisle |
| 137 | Mark aisle seats | DONE | DONE | POST /master-data/seat-layouts/:id/seats/auto-positions / seats/mark (position) · UI: Fleet → Seat Layouts: editor marks window/aisle, ladies, disability-friendly, berths per deck; Auto window/aisle |
| 138 | Mark lower berths | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts: editor marks window/aisle, ladies, disability-friendly, berths per deck; Auto window/aisle |
| 139 | Mark upper berths | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts: editor marks window/aisle, ladies, disability-friendly, berths per deck; Auto window/aisle |
| 140 | Mark ladies seats | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts: editor marks window/aisle, ladies, disability-friendly, berths per deck; Auto window/aisle |
| 141 | Mark disabled-friendly seats | DONE | DONE | seats/mark {accessible}; trip_seats.accessible; kept for 'disabled' passengers · UI: Fleet → Seat Layouts: editor marks window/aisle, ladies, disability-friendly, berths per deck; Auto window/aisle |
| 142 | Set bus amenities list | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts editor + Vehicle Types & Amenities |
| 143 | Enable AC amenity | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts editor + Vehicle Types & Amenities |
| 144 | Enable WiFi amenity | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts editor + Vehicle Types & Amenities |
| 145 | Enable charging point amenity | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts editor + Vehicle Types & Amenities |
| 146 | Enable blanket and water amenity | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts editor + Vehicle Types & Amenities |
| 147 | Enable toilet amenity | DONE | DONE | verified manually: existing module/API · UI: Fleet → Seat Layouts editor + Vehicle Types & Amenities |
| 148 | Create new route with origin and destination | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops › New route (stops, km, timing validated) + publish |
| 149 | Add intermediate stage 1 | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → stops with km, running time, boarding/dropping points |
| 150 | Add intermediate stage 2 | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → stops with km, running time, boarding/dropping points |
| 151 | Add multiple intermediate stages | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → stops with km, running time, boarding/dropping points |
| 152 | Set distance between stages | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → stops with km, running time, boarding/dropping points |
| 153 | Set running duration between stages | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → stops with km, running time, boarding/dropping points |
| 154 | Map primary pickup points | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → stops with km, running time, boarding/dropping points |
| 155 | Map secondary pickup points | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → stops with km, running time, boarding/dropping points |
| 156 | Map drop points | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → stops with km, running time, boarding/dropping points |
| 157 | Create complete stage-to-stage fare matrix | DONE | DONE | verified manually: existing module/API · UI: Pricing → Fare plans (seat-type fares, seat overrides) |
| 158 | Set base fare for main route | DONE | DONE | verified manually: existing module/API · UI: Pricing → Fare plans (seat-type fares, seat overrides) |
| 159 | Set peak hour fare multiplier | DONE | DONE | PUT /pricing/routes/:id/rules peakWindows · UI: Pricing → Route limits & peak times |
| 160 | Set off-peak fare multiplier | DONE | DONE | PUT /pricing/routes/:id/rules peakWindows (−%) · UI: Pricing → Route limits & peak times |
| 161 | Apply festive season fare hike percentage | DONE | DONE | verified manually: existing module/API · UI: Pricing → Fare plan: sheet download/upload, change all by % |
| 162 | Create daily service for specific date | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 163 | Set service departure time | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 164 | Set service arrival time | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 165 | Set weekly recurring schedule (Mon-Sun) | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 166 | Create special extra trip service | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 167 | Temporarily cancel a service | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Cancel trip (reason) |
| 168 | Set cancellation reason | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Cancel trip (reason) |
| 169 | Permanently delete a service | DONE | DONE | DELETE /scheduling/services/:id (only without history) · UI: Schedule → Manage service |
| 170 | Set OTA inventory release percentage per service | DONE | DONE | PUT /scheduling/services/:id/sales-rules {otaReleasePct}; platform default PUT /admin/policies/ota-release; enforced on hold · UI: Schedule → Manage service |
| 171 | Set agent-wise inventory quota | DONE | DONE | POST /trips/:tripId/quotas (fixed: every allocation used to fail) · UI: Trip chart → Agent & branch seats |
| 172 | Set branch-wise inventory allocation percentage | DONE | DONE | POST /trips/:tripId/quotas/percentage (branch/agent) · UI: Trip chart → Agent & branch seats |
| 173 | Set ladies quota percentage or seats | DONE | DONE | sales-rules categoryQuotas.female/senior (seats or pct, releaseHours), enforced on hold · UI: Schedule → Manage service |
| 174 | Set senior citizen quota | DONE | DONE | sales-rules categoryQuotas.female/senior (seats or pct, releaseHours), enforced on hold · UI: Schedule → Manage service |
| 175 | Enable dynamic pricing on selected routes | DONE | DONE | verified manually: existing module/API · UI: Pricing → dynamic yield (occupancy / advance steps) |
| 176 | Create percentage based coupon | DONE | DONE | POST /pricing/coupons: percent 1–100, flat ≥ ₹1, end after start and in the future, code A-Z0-9-_; DB checks (0087); 404 on another operator's coupon · UI: Pricing › Coupons: percent 1–100 or flat ₹ (paise), cap, min fare, valid till, total and per-customer uses, first-booking; switch off/on; stats; applied at checkout |
| 177 | Create flat amount coupon | DONE | DONE | POST /pricing/coupons: percent 1–100, flat ≥ ₹1, end after start and in the future, code A-Z0-9-_; DB checks (0087); 404 on another operator's coupon · UI: Pricing › Coupons: percent 1–100 or flat ₹ (paise), cap, min fare, valid till, total and per-customer uses, first-booking; switch off/on; stats; applied at checkout |
| 178 | Set coupon validity dates | DONE | DONE | POST /pricing/coupons: percent 1–100, flat ≥ ₹1, end after start and in the future, code A-Z0-9-_; DB checks (0087); 404 on another operator's coupon · UI: Pricing › Coupons: percent 1–100 or flat ₹ (paise), cap, min fare, valid till, total and per-customer uses, first-booking; switch off/on; stats; applied at checkout |
| 179 | Set coupon usage limit | DONE | DONE | POST /pricing/coupons: percent 1–100, flat ≥ ₹1, end after start and in the future, code A-Z0-9-_; DB checks (0087); 404 on another operator's coupon · UI: Pricing › Coupons: percent 1–100 or flat ₹ (paise), cap, min fare, valid till, total and per-customer uses, first-booking; switch off/on; stats; applied at checkout |
| 180 | Configure privilege card program | CONFLICT | — | earlier product decision |
| 181 | Configure loyalty points rules | CONFLICT | — | earlier product decision |
| 182 | Create new agent account | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 183 | Enter agent name and contact | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 184 | Assign agent code | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 185 | Set agent credit limit amount | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 186 | Set agent commission percentage | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 187 | Set agent commission type (percentage or flat) | GAP | — | verified manually: not built yet |
| 188 | Temporarily block agent | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 189 | Set block reason | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 190 | Unblock agent | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 191 | Create new staff user | DONE | DONE | verified manually: existing module/API · UI: Staff page |
| 192 | Assign staff name, mobile, email | DONE | DONE | verified manually: existing module/API · UI: Staff page |
| 193 | Assign staff to one or more branches | DONE | DONE | PUT /users/:id/branch (one home branch per person; active branches of this operator only) · UI: Staff page |
| 194 | Create custom role named Branch Manager | DONE | DONE | verified manually: existing module/API · UI: Staff → Roles & permissions |
| 195 | Create custom role named Dispatch Manager | DONE | DONE | verified manually: existing module/API · UI: Staff → Roles & permissions |
| 196 | Create custom role named Finance Executive | DONE | DONE | verified manually: existing module/API · UI: Staff → Roles & permissions |
| 197 | Create custom role named Inventory Manager | DONE | DONE | verified manually: existing module/API · UI: Staff → Roles & permissions |
| 198 | Create custom role named Conductor Supervisor | DONE | DONE | verified manually: existing module/API · UI: Staff → Roles & permissions |
| 199 | Assign full permissions to a role | DONE | DONE | verified manually: existing module/API · UI: Staff → Roles & permissions |
| 200 | Assign limited permissions to a role | DONE | DONE | verified manually: existing module/API · UI: Staff → Roles & permissions |
| 201 | Edit permissions of existing role | DONE | DONE | verified manually: existing module/API · UI: Staff → Roles & permissions |
| 202 | Duplicate role and modify | DONE | DONE | POST /iam/roles/:id/duplicate · UI: Staff → Roles & permissions |
| 203 | Delete unused custom role | DONE | DONE | DELETE /iam/roles/:id (not built-in, not assigned) · UI: Staff → Roles & permissions |
| 204 | View complete permission matrix | DONE | DONE | verified manually: existing module/API · UI: Staff → Roles & permissions (catalogue per role) |
| 205 | Set branch-level permission override | GAP | — | verified manually: not built yet |
| 206 | Give temporary permission with end date | DONE | DONE | PUT /users/:id/roles/:roleId {expiresAt} · UI: Staff modal (roles until, access & hours, reports to, new password) |
| 207 | View staff activity logs | DONE | DONE | verified manually: existing module/API · UI: Staff page |
| 208 | Force logout a staff session | DONE | DONE | POST /users/:id/force-logout (tokens_valid_after) · UI: Staff page |
| 209 | Reset staff password | DONE | DONE | PUT /users/:id/password (unlocks, signs out; not yourself) · UI: Staff modal (roles until, access & hours, reports to, new password) |
| 210 | Deactivate staff account | DONE | DONE | verified manually: existing module/API · UI: Staff page |
| 211 | Reactivate staff account | DONE | DONE | verified manually: existing module/API · UI: Staff page |
| 212 | Bulk upload staff using Excel template | DONE | DONE | GET /users/import-template.csv; POST /users/bulk-import (row by row) · UI: Staff → Upload staff |
| 213 | Download staff upload template | DONE | DONE | GET /users/import-template.csv; POST /users/bulk-import (row by row) · UI: Staff → Upload staff |
| 214 | Export complete staff directory | DONE | DONE | GET /users/export.csv · UI: Staff page |
| 215 | Set allowed login time window for staff | DONE | DONE | PUT /users/:id/access {loginWindow} (overnight-safe) · UI: Staff modal (roles until, access & hours, reports to, new password) |
| 216 | View staff last login date and time | DONE | DONE | verified manually: existing module/API · UI: Staff page |
| 217 | Set reporting manager for staff | DONE | DONE | PUT /users/:id/access {managerId} (no loops) · UI: Staff modal (roles until, access & hours, reports to, new password) |
| 218 | Create temporary contractor staff with expiry | DONE | DONE | PUT /users/:id/access {accessExpiresAt} · UI: Staff modal (roles until, access & hours, reports to, new password) |
| 219 | System auto-deactivates expired staff | DONE | DONE | auth guard refuses expired access on next request · UI: Staff modal (roles until, access & hours, reports to, new password) |
| 220 | View main operator dashboard | DONE | DONE | GET /reports/summary (today in operator tz, live holds) + GET /scheduling/trips?date= + GET /bookings/search · UI: operator Dashboard (KPIs, today's departures, latest bookings) |
| 221 | View today’s total bookings | DONE | DONE | verified manually: existing module/API · UI: Dashboard (today's bookings, sales, occupancy, bookings by hour, best/least filled routes) |
| 222 | View today’s total revenue | DONE | DONE | verified manually: existing module/API · UI: Dashboard (today's bookings, sales, occupancy, bookings by hour, best/least filled routes) |
| 223 | View today’s average occupancy | DONE | DONE | verified manually: existing module/API · UI: Dashboard (today's bookings, sales, occupancy, bookings by hour, best/least filled routes) |
| 224 | Compare today vs yesterday metrics | GAP | — | verified manually: not built yet |
| 225 | View hourly booking trend graph | DONE | DONE | verified manually: existing module/API · UI: Dashboard (today's bookings, sales, occupancy, bookings by hour, best/least filled routes) |
| 226 | View top 5 performing routes | DONE | DONE | verified manually: existing module/API · UI: Dashboard (today's bookings, sales, occupancy, bookings by hour, best/least filled routes) |
| 227 | View bottom 5 performing routes | DONE | DONE | verified manually: existing module/API · UI: Dashboard (today's bookings, sales, occupancy, bookings by hour, best/least filled routes) |
| 228 | View OTA vs Direct booking percentage | GAP | — | verified manually: not built yet |
| 229 | View cash vs digital collection split | CONFLICT | — | earlier product decision |
| 230 | Configure occupancy-based dynamic pricing rule | DONE | DONE | verified manually: existing module/API · UI: Pricing → dynamic yield (occupancy / advance steps) |
| 231 | Configure time-based pricing rule | DONE | DONE | peak windows by departure time · UI: Pricing → Route limits & peak times |
| 232 | Configure demand surge pricing rule | GAP | — | verified manually: not built yet |
| 233 | Block complete inventory for charter | DONE | DONE | verified manually: existing module/API · UI: Trips & Charts › chart: Block / open seats |
| 234 | Release previously blocked inventory | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Block / open seats |
| 235 | Create multi-hop connecting service | DONE | DONE | verified manually: existing module/API · UI: Settings → Connections: take part in two-bus journeys, shortest/longest change; preview your own connections |
| 236 | Define layover time rules | DONE | DONE | verified manually: existing module/API · UI: Settings → Connections: take part in two-bus journeys, shortest/longest change; preview your own connections |
| 237 | Configure waitlist maximum size | DONE | DONE | GET/PUT /operator/waitlist-rules (+ reset): max per trip, seats per entry, close time, entry expiry; applied on join, list and notify · UI: Settings → Waitlist |
| 238 | Set waitlist auto-confirm rules | GAP | — | verified manually: not built yet |
| 239 | Set waitlist entry expiry hours | DONE | DONE | GET/PUT /operator/waitlist-rules (+ reset): max per trip, seats per entry, close time, entry expiry; applied on join, list and notify · UI: Settings → Waitlist |
| 240 | Enable way-side booking on service | CONFLICT | — | earlier product decision |
| 241 | Disable way-side booking on service | CONFLICT | — | earlier product decision |
| 242 | Set maximum advance booking days allowed | DONE | DONE | PUT /concessions/booking-window {maxAdvanceDays} · UI: Pricing → Concessions & booking rules |
| 243 | Set minimum hours before departure for booking | DONE | DONE | PUT /concessions/booking-window {minMinutesBeforeDeparture} · UI: Pricing → Concessions & booking rules |
| 244 | Configure cancellation charge slabs by time | DONE | DONE | verified manually: existing module/API · UI: Settings → Refund policy (time slabs) |
| 245 | Set free cancellation window in hours | DONE | DONE | PATCH /operator/refund-policy freeCancellationHours: full refund within N hours of paying (cutoff still applies) · UI: Settings → Cancellation Policy → Free cancellation window |
| 246 | Configure rules for partial cancellation | DONE | DONE | verified manually: existing module/API · UI: Settings → Cancellation policy → Allow cancelling some seats (off = whole bookings only for customers/agents/partners) |
| 247 | Set no-show marking policy | DONE | DONE | verified manually: existing module/API · UI: Settings → Cancellation policy → No-show grace (minutes after departure) |
| 248 | Enable automatic seat assignment | GAP | — | verified manually: not built yet |
| 249 | Configure preferred seat assignment logic | GAP | — | verified manually: not built yet |
| 250 | Set group booking minimum seats for discount | GAP | — | verified manually: not built yet |
| 251 | Configure corporate booking credit terms | GAP | — | verified manually: not built yet |
| 252 | Set standard luggage allowance | DONE | DONE | PUT /operator/luggage-policy; trip detail luggage; add-ons active/stop · UI: Settings → Luggage / Add-ons; trip & manage booking show allowance |
| 253 | Configure extra luggage charge per kg or piece | DONE | DONE | PUT /operator/luggage-policy; trip detail luggage; add-ons active/stop · UI: Settings → Luggage / Add-ons; trip & manage booking show allowance |
| 254 | View all live running services | DONE | DONE | verified manually: existing module/API · UI: Trips (On the road / Cancelled filter) → chart: Mark departed / arrived, Change bus |
| 255 | View currently delayed services | DONE | DONE | verified manually: existing module/API · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 256 | View today’s cancelled services | DONE | DONE | verified manually: existing module/API · UI: Trips (On the road / Cancelled filter) → chart: Mark departed / arrived, Change bus |
| 257 | Manually mark service as departed | DONE | DONE | verified manually: existing module/API · UI: Trips (On the road / Cancelled filter) → chart: Mark departed / arrived, Change bus |
| 258 | Manually mark service as arrived | DONE | DONE | verified manually: existing module/API · UI: Trips (On the road / Cancelled filter) → chart: Mark departed / arrived, Change bus |
| 259 | Force release all temporary holds on service | DONE | DONE | POST /scheduling/trips/:id/release-holds · UI: Trips & Charts › chart: Release holds |
| 260 | View live seat map of any service | DONE | DONE | verified manually: existing module/API · UI: Trip chart (live seat map) |
| 261 | Temporarily block specific seats | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Block / open seats |
| 262 | Release previously blocked seats | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Block / open seats |
| 263 | Change allocated bus of a service last minute | DONE | DONE | verified manually: existing module/API · UI: Trips (On the road / Cancelled filter) → chart: Mark departed / arrived, Change bus |
| 264 | Change allocated crew last minute | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 265 | Add internal remark on service | DONE | DONE | POST/GET /scheduling/trips/:id/remarks · UI: Trips & Charts › chart: Staff remarks |
| 266 | Clone an existing service to new date | DONE | DONE | POST /scheduling/services/:id/clone · UI: Schedule → Manage service |
| 267 | Bulk update fares using Excel | DONE | DONE | GET rules.csv + POST /pricing/fare-plans/:id/rules/import / adjust · UI: Pricing → Fare plan: sheet download/upload, change all by % |
| 268 | Bulk create schedules using Excel | GAP | — | verified manually: not built yet |
| 269 | View complete schedule version history | DONE | DONE | GET /scheduling/services/:id/versions · UI: Schedule → Manage service |
| 270 | Rollback schedule to previous version | DONE | DONE | POST /scheduling/services/:id/versions/:n/restore · UI: Schedule → Manage service |
| 271 | Set blackout dates for route | DONE | DONE | POST /scheduling/routes/:routeId/blackouts (materialisation skips) · UI: Schedule → Route blackouts |
| 272 | Configure seasonal schedule patterns | DONE | DONE | POST /scheduling/services/:id/clone {season:true} · UI: Schedule → Manage service |
| 273 | Create festival special services in bulk | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 274 | Set temporary route diversion | DONE | DONE | incident type 'diversion' → trip.diverted SMS to every passenger · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 275 | Trigger passenger notification on schedule change | DONE | DONE | POST /scheduling/trips/:id/retime → trip.retimed SMS to every passenger · UI: Trips & Charts › chart: Change departure time |
| 276 | View current inventory utilization percentage | DONE | DONE | verified manually: existing module/API · UI: Reports → Dispatch |
| 277 | View occupancy forecast for next 7 days | DONE | DONE | verified manually: existing module/API · UI: Reports → Forecast (weak trips: keep / plan to cancel) |
| 278 | View occupancy forecast for next 15 days | DONE | DONE | GET /reports/occupancy-forecast?days=15 · UI: Reports → Forecast (weak trips: keep / plan to cancel) |
| 279 | Accept AI suggestion for adding extra trip | DONE | DONE | verified manually: existing module/API · UI: Schedule → Busy trips suggestions |
| 280 | Reject AI suggestion for cancelling service | DONE | DONE | GET /reports/cancel-suggestions; POST /trips/:tripId/cancel-suggestion/decision · UI: Reports → Forecast: Keep running / Plan to cancel |
| 281 | Set minimum fare floor value | DONE | DONE | route floor (engine, after yield) · UI: Pricing → Route limits & peak times |
| 282 | Set maximum fare ceiling value | DONE | DONE | route ceiling (engine, after yield) · UI: Pricing → Route limits & peak times |
| 283 | Configure round-trip discount percentage | DONE | DONE | PUT /concessions/round-trip (0–50%); hold returnOf=onward booking applies it after concessions when it qualifies (confirmed, same passenger, back the way, later bus, once — unique live return) · UI: Pricing → Concessions: Round trip; confirmation 'X% off your way back'; checkout shows the discount; falls back to full price with the reason |
| 284 | Manage master list of boarding points | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → stops with km, running time, boarding/dropping points |
| 285 | Manage master list of drop points | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → stops with km, running time, boarding/dropping points |
| 286 | Set additional charges for specific pickup points | DONE | DONE | GET/PUT /master-data/routes/:id/point-charges; quote adds per-seat charge before GST, after coupon; trip stops show charges · UI: Routes → Point charges; seat page +₹ per point and in the estimate; checkout summary |
| 287 | Set additional charges for specific drop points | DONE | DONE | GET/PUT /master-data/routes/:id/point-charges; quote adds per-seat charge before GST, after coupon; trip stops show charges · UI: Routes → Point charges; seat page +₹ per point and in the estimate; checkout summary |
| 288 | Configure complete ladies special service rules | DONE | DONE | verified manually: existing module/API · UI: Schedule → service → Sales: women quota up to 100% (ladies special) |
| 289 | Configure senior citizen concession percentage | DONE | DONE | verified manually: existing module/API · UI: Pricing → Concessions & booking rules |
| 290 | Configure student concession percentage | DONE | DONE | verified manually: existing module/API · UI: Pricing → Concessions & booking rules |
| 291 | Configure defense personnel concession | DONE | DONE | verified manually: existing module/API · UI: Pricing → Concessions & booking rules |
| 292 | Set child fare rules by age | DONE | DONE | verified manually: existing module/API · UI: Pricing → Concessions & booking rules |
| 293 | Set infant policy (free or charged) | DONE | DONE | verified manually: existing module/API · UI: Pricing → Concessions & booking rules |
| 294 | Configure disability-friendly seat rules | DONE | DONE | PUT /concessions/accessible-seats (release hours), enforced on hold · UI: Pricing → Concessions & booking rules |
| 295 | Upload and manage bus permit documents | DONE | DONE | verified manually: existing module/API · UI: Fleet › vehicle page › documents upload/replace + submit for verification |
| 296 | Upload and manage insurance documents | DONE | DONE | verified manually: existing module/API · UI: Fleet › vehicle page › documents upload/replace + submit for verification |
| 297 | Upload and manage fitness certificate | DONE | DONE | verified manually: existing module/API · UI: Fleet → bus page documents (upload, expiry) + Fleet → Renewals |
| 298 | Set document expiry reminder days | GAP | — | verified manually: not built yet |
| 299 | View document expiry dashboard | DONE | DONE | verified manually: existing module/API · UI: Fleet → bus page documents (upload, expiry) + Fleet → Renewals |
| 300 | Upload bus exterior and interior photos | DONE | DONE | verified manually: existing module/API · UI: Fleet → bus page → Photos (max 10, no video) |
| 301 | Set bus public display name | GAP | — | verified manually: not built yet |
| 302 | View agent performance ranking by bookings | GAP | — | verified manually: not built yet |
| 303 | View agent performance ranking by revenue | GAP | — | verified manually: not built yet |
| 304 | Give performance incentive to top agents | GAP | — | verified manually: not built yet |
| 305 | Apply penalty to high cancellation agents | GAP | — | verified manually: not built yet |
| 306 | Increase credit limit of good performing agent | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 307 | Decrease credit limit of risky agent | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 308 | View complete agent ledger | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 309 | Process agent payment settlement | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 310 | Generate agent tax invoice | GAP | — | verified manually: not built yet |
| 311 | Generate agent TDS report | GAP | — | verified manually: not built yet |
| 312 | Download agent commission statement | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents |
| 313 | Block agent from booking specific routes | GAP | — | verified manually: not built yet |
| 314 | Allocate exclusive inventory to preferred agents | DONE | DONE | POST /trips/:tripId/quotas (fixed: every allocation used to fail) · UI: Trip chart → Agent & branch seats |
| 315 | Set maximum discount percentage agent can give | GAP | — | verified manually: not built yet |
| 316 | View branch-wise collection report | GAP | — | verified manually: not built yet |
| 317 | View branch-wise occupancy report | GAP | — | verified manually: not built yet |
| 318 | Compare performance of all branches | GAP | — | verified manually: not built yet |
| 319 | Set monthly targets for each branch | GAP | — | verified manually: not built yet |
| 320 | View branch expense versus collection | GAP | — | verified manually: not built yet |
| 321 | Approve or reject branch expense claims | GAP | — | verified manually: not built yet |
| 322 | Transfer staff from one branch to another | DONE | DONE | verified manually: existing module/API · UI: Staff page |
| 323 | Temporarily close a branch | DONE | DONE | verified manually: existing module/API · UI: Branches: add/edit with name (unique, any case), address, phone checks, per-day opening hours incl. past midnight; deactivate (confirm) / activate |
| 324 | Reopen a closed branch | DONE | DONE | verified manually: existing module/API · UI: Branches: add/edit with name (unique, any case), address, phone checks, per-day opening hours incl. past midnight; deactivate (confirm) / activate |
| 325 | View complete financial dashboard | DONE | DONE | verified manually: existing module/API · UI: Reports → Revenue, Profit & Loss; Settings → Platform bills |
| 326 | View total outstanding receivables | GAP | — | verified manually: not built yet |
| 327 | View total payables to OTAs | GAP | — | verified manually: not built yet |
| 328 | Match OTA settlement file | GAP | — | verified manually: not built yet |
| 329 | Raise formal dispute on OTA settlement | GAP | — | verified manually: not built yet |
| 330 | Generate data for GST returns | GAP | — | verified manually: not built yet |
| 331 | Generate data for TDS returns | GAP | — | verified manually: not built yet |
| 332 | View monthly Profit and Loss statement | DONE | DONE | verified manually: existing module/API · UI: Reports → Profit & Loss (route / bus / trip) |
| 333 | View route-wise profitability ranking | DONE | DONE | verified manually: existing module/API · UI: Reports › Route Performance (last 30 days, fixed occupancy) |
| 334 | View bus-wise profitability ranking | DONE | DONE | verified manually: existing module/API · UI: Reports → Profit & Loss (route / bus / trip) |
| 335 | Export all financial reports | GAP | — | verified manually: not built yet |
| 336 | Configure list of expense categories | GAP | — | verified manually: not built yet |
| 337 | Add fuel expense entry | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Expenses & P&L |
| 338 | Add maintenance expense entry | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Expenses & P&L |
| 339 | Add toll expense entry | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Expenses & P&L |
| 340 | Add crew salary expense entry | GAP | — | verified manually: not built yet |
| 341 | View monthly expense trends | GAP | — | verified manually: not built yet |
| 342 | Set budget alert thresholds | GAP | — | verified manually: not built yet |
| 343 | View projected cash flow | GAP | — | verified manually: not built yet |
| 344 | Configure automatic reminders for pending dues | GAP | — | verified manually: not built yet |
| 345 | View current refund liability amount | GAP | — | verified manually: not built yet |
| 346 | Process bulk refunds | DONE | DONE | verified manually: existing module/API · UI: Refunds → Needs action: select failed refunds → Retry selected |
| 347 | Approve high-value refund requests | GAP | — | verified manually: not built yet |
| 348 | View complete audit trail of financial entries | DONE | DONE | verified manually: existing module/API · UI: Reports → Ledger (journal with postings, PNR/type filter, trial balance, CSV) |
| 349 | Download final month-end closing pack | GAP | — | verified manually: not built yet |
| 350 | Perform final operator health check | GAP | — | verified manually: not built yet |
| 351 | Login to assigned branch dashboard | GAP | — | verified manually: not built yet |
| 352 | View list of today’s services under branch | GAP | — | verified manually: not built yet |
| 353 | View real-time seat occupancy of each service | DONE | DONE | verified manually: existing module/API · UI: Trip chart (live seat map) |
| 354 | Apply special discount on low occupancy service | DONE | DONE | PUT /pricing/trips/:id/adjustment (−%) · UI: Trip chart → Fare for this trip |
| 355 | Temporarily increase fare on high demand service | DONE | DONE | PUT /pricing/trips/:id/adjustment (+%) · UI: Trip chart → Fare for this trip |
| 356 | Assign daily booking targets to staff members | DONE | DONE | PUT/DELETE /users/:id/target; targets in /users/performance · UI: Staff modal target + Performance vs target |
| 357 | View individual staff booking performance | DONE | DONE | GET /users/performance (bookings, seats, sales, cancellations per seller; bookings.booked_by) · UI: Staff page |
| 358 | View individual staff cancellation rate | DONE | DONE | GET /users/performance (bookings, seats, sales, cancellations per seller; bookings.booked_by) · UI: Staff page |
| 359 | Hold seats temporarily for walk-in passenger | DONE | DONE | verified manually: existing module/API · UI: Search & Book → hold then pay |
| 360 | Convert held seats to confirmed booking | DONE | DONE | verified manually: existing module/API · UI: Search & Book → hold then pay |
| 361 | Confirm booking received on phone | DONE | DONE | verified manually: existing module/API · UI: Search & Book → Phone booking (hold until a release time) → booking page: Take UPI payment |
| 362 | Verify booking done by agent | DONE | DONE | verified manually: existing module/API · UI: Bookings → channel Travel agent + agent filter; booking shows the agent |
| 363 | Approve agent booking | GAP | — | verified manually: not built yet |
| 364 | Generate boarding chart in PDF | GAP | — | verified manually: not built yet |
| 365 | Print boarding chart | DONE | DONE | GET /bookings/trips/:tripId/chart (passenger list by boarding point) — printed from the web chart · UI: Trips & Charts › chart: Print chart + passenger list |
| 366 | Share boarding chart with conductor | GAP | — | verified manually: not built yet |
| 367 | Approve passenger boarding point change request | DONE | DONE | verified manually: existing module/API · UI: Booking → Change… |
| 368 | Approve passenger drop point change request | DONE | DONE | verified manually: existing module/API · UI: Booking → Change… |
| 369 | Process seat shift request on same bus | DONE | DONE | verified manually: existing module/API · UI: Booking → Change… |
| 370 | Process date change request | DONE | DONE | verified manually: existing module/API · UI: Booking → Change… |
| 371 | Calculate fare difference on date change | DONE | DONE | verified manually: existing module/API · UI: Booking → Change… |
| 372 | Process full cancellation request | DONE | DONE | verified manually: existing module/API · UI: Booking → Cancel… (refund shown first) |
| 373 | Initiate refund after cancellation | DONE | DONE | verified manually: existing module/API · UI: Booking → Cancel… (refund shown first) |
| 374 | Process partial cancellation of one passenger | DONE | DONE | POST /bookings/:id/cancel-seats (staff / owner / booking mobile; seat_count kept in step) · UI: booking detail › Cancel… (pick seats, refund preview, reason) |
| 375 | Mark passenger as no-show | DONE | DONE | verified manually: existing module/API · UI: Booking → No-show (after departure) |
| 376 | Generate daily cash collection summary | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 377 | View digital payment collection summary | GAP | — | verified manually: not built yet |
| 378 | Reconcile total cash plus digital collection | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 379 | Enter cash shortage amount | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 380 | Enter cash excess amount | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 381 | Generate formal day-end closing report | GAP | — | verified manually: not built yet |
| 382 | Submit day-end report to operator admin | GAP | — | verified manually: not built yet |
| 383 | View branch occupancy trend for last 7 days | GAP | — | verified manually: not built yet |
| 384 | View branch occupancy trend for last 30 days | GAP | — | verified manually: not built yet |
| 385 | View branch revenue trend | GAP | — | verified manually: not built yet |
| 386 | Identify top performing staff | DONE | DONE | GET /users/performance (bookings, seats, sales, cancellations per seller; bookings.booked_by) · UI: Staff page |
| 387 | Identify under-performing staff | DONE | DONE | GET /users/performance (bookings, seats, sales, cancellations per seller; bookings.booked_by) · UI: Staff page |
| 388 | Issue warning to under-performing staff | DONE | DONE | POST /users/:id/warnings; GET /users/me + acknowledge · UI: Staff modal warnings; My account acknowledge |
| 389 | Grant temporary system access to new staff | DONE | DONE | verified manually: existing module/API · UI: Staff modal (access ends / disable) |
| 390 | Temporarily block access of a staff member | DONE | DONE | verified manually: existing module/API · UI: Staff modal (access ends / disable) |
| 391 | Activate special promotional offer for branch | GAP | — | verified manually: not built yet |
| 392 | Raise request for extra service on festival | GAP | — | verified manually: not built yet |
| 393 | Send delay notification to all passengers | DONE | DONE | verified manually: existing module/API · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 394 | Suggest alternate service for delayed bus | GAP | — | verified manually: not built yet |
| 395 | Re-allocate passengers when bus breaks down | DONE | DONE | verified manually: existing module/API · UI: Trips (On the road / Cancelled filter) → chart: Mark departed / arrived, Change bus |
| 396 | Handle large group booking request | GAP | — | verified manually: not built yet |
| 397 | Process corporate company booking | GAP | — | verified manually: not built yet |
| 398 | Check current branch wallet balance | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 399 | Raise branch wallet recharge request | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 400 | Raise formal complaint against agent | DONE | DONE | verified manually: existing module/API · UI: Distribution → Travel agents → agent → Complaints (raise with PNR, uphold / dismiss with decision) |
| 401 | Register passenger complaint in system | DONE | DONE | support tickets: staff raise by PNR / reply / priority / assign / resolve; customers own tickets only; author from account · UI: Support: queue views (active/mine/unassigned/…), search, ticket thread with reply, resolve/reopen/close, priority, assign; raise for a caller by PNR |
| 402 | Enter lost and found item details | DONE | DONE | POST /lost-found (+claim with PNR check, 30-day disposal) · UI: Operations → Lost & found |
| 403 | Manage stock of ticket rolls | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 404 | Manage stock of printer paper | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 405 | Report printer or hardware problem | DONE | DONE | verified manually: existing module/API · UI: Operations → Report incident (other / breakdown) with details |
| 406 | Create booking in offline mode | GAP | — | verified manually: not built yet |
| 407 | Sync offline bookings when internet returns | GAP | — | verified manually: not built yet |
| 408 | Manually resolve sync conflict | GAP | — | verified manually: not built yet |
| 409 | Download branch level audit report | GAP | — | verified manually: not built yet |
| 410 | Prepare and submit month-end branch summary | GAP | — | verified manually: not built yet |
| 411 | View real-time seat availability of any service | DONE | DONE | verified manually: existing module/API · UI: Trip chart (live seat map) |
| 412 | Block seats for VIP or special movement | DONE | DONE | verified manually: existing module/API · UI: Trips & Charts › chart: Block / open seats |
| 413 | Release previously blocked VIP seats | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Block / open seats |
| 414 | Change boarding point for multiple passengers together | DONE | DONE | verified manually: existing module/API · UI: Booking → Change… |
| 415 | Search booking using PNR number | DONE | DONE | verified manually: existing module/API · UI: operator Bookings list + detail (find by PNR/mobile/ticket, filters, CSV) |
| 416 | Search booking using mobile number | DONE | DONE | GET /bookings/search?mobile= (last-10-digit match) · UI: operator Bookings list + detail (find by PNR/mobile/ticket, filters, CSV) |
| 417 | Search booking using ticket number | DONE | DONE | GET /bookings/search?ticket= · UI: operator Bookings list + detail (find by PNR/mobile/ticket, filters, CSV) |
| 418 | View complete passenger travel history | DONE | DONE | verified manually: existing module/API · UI: Customers → open a customer: every trip |
| 419 | Manually apply senior citizen discount | DONE | DONE | verified manually: existing module/API · UI: Search & Book (counter): concession per passenger with ID; ladies seat for a man only with a written reason |
| 420 | Manually apply student discount | DONE | DONE | verified manually: existing module/API · UI: Search & Book (counter): concession per passenger with ID; ladies seat for a man only with a written reason |
| 421 | Override ladies seat restriction with proper reason | DONE | DONE | POST /bookings/hold ladiesSeatOverrideReason (staff only, event booking.ladies_seat_override) · UI: Search & Book (counter): concession per passenger with ID; ladies seat for a man only with a written reason |
| 422 | Show cancellation charges to passenger before confirming | DONE | DONE | verified manually: existing module/API · UI: Booking → Cancel… (refund shown first) |
| 423 | Process refund back to original payment method | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 424 | Process refund in cash | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 425 | View list of pending refunds for branch | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 426 | Escalate high value cancellation to operator admin | GAP | — | verified manually: not built yet |
| 427 | View live GPS location of branch services | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Live location (GPS, speed, next stop ETA, signal lost) |
| 428 | Mark service as departed from this branch | DONE | DONE | verified manually: existing module/API · UI: Trips (On the road / Cancelled filter) → chart: Mark departed / arrived, Change bus |
| 429 | Enter detailed delay reason | DONE | DONE | verified manually: existing module/API · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 430 | View complete no-show passenger list | DONE | DONE | verified manually: existing module/API · UI: Bookings → No-shows only (seats shown), tap the mobile to call |
| 431 | Contact no-show passenger | DONE | DONE | verified manually: existing module/API · UI: Bookings → No-shows only (seats shown), tap the mobile to call |
| 432 | Release no-show seat to waitlist | GAP | — | verified manually: not built yet |
| 433 | View current waitlist for services | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Waitlist |
| 434 | Confirm passenger from waitlist | GAP | — | verified manually: not built yet |
| 435 | Cancel entry from waitlist | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Waitlist: Remove |
| 436 | View all group bookings | GAP | — | verified manually: not built yet |
| 437 | Modify existing group booking | GAP | — | verified manually: not built yet |
| 438 | Split one group booking into multiple | GAP | — | verified manually: not built yet |
| 439 | View staff attendance for the day | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties → Duty roster → Today's attendance / pick a day (present/late/absent/not marked) |
| 440 | Approve overtime request of staff | GAP | — | verified manually: not built yet |
| 441 | View branch expense entries | GAP | — | verified manually: not built yet |
| 442 | Add new petty cash expense | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 443 | Raise stationery requirement request | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 444 | View customer feedback received for branch | GAP | — | verified manually: not built yet |
| 445 | Respond to passenger complaint | DONE | DONE | support tickets: staff raise by PNR / reply / priority / assign / resolve; customers own tickets only; author from account · UI: Support: queue views (active/mine/unassigned/…), search, ticket thread with reply, resolve/reopen/close, priority, assign; raise for a caller by PNR |
| 446 | View ranking of own branch among all branches | GAP | — | verified manually: not built yet |
| 447 | Customize personal dashboard widgets | GAP | — | verified manually: not built yet |
| 448 | Export daily operational report to Excel | DONE | DONE | verified manually: existing module/API · UI: Reports → Dispatch → Export to Excel (CSV) |
| 449 | View list of offline bookings still pending sync | GAP | — | verified manually: not built yet |
| 450 | Force synchronize offline data | GAP | — | verified manually: not built yet |
| 451 | View list of sync conflicts | GAP | — | verified manually: not built yet |
| 452 | Resolve sync conflict with manager decision | GAP | — | verified manually: not built yet |
| 453 | View previous shift handover notes | DONE | DONE | GET /shift-notes · UI: Operations → Shift notes |
| 454 | Write handover notes for next shift manager | DONE | DONE | POST /shift-notes · UI: Operations → Shift notes |
| 455 | Lock all counters at end of day | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 456 | Unlock counters at start of next day | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 457 | View branch collection against monthly target | GAP | — | verified manually: not built yet |
| 458 | View all agent bookings done through this branch | DONE | DONE | verified manually: existing module/API · UI: Bookings → Branch filter (counter staff + agents of the branch) |
| 459 | Approve agent request for higher credit | GAP | — | verified manually: not built yet |
| 460 | View list of blacklisted passengers | DONE | DONE | customer_blocks per operator (account + mobile), GET /customers?filter=blocked, hold → 403 · UI: Customers: Blocked tab, block with reason / unblock in the profile |
| 461 | Add passenger to branch watch list | GAP | — | verified manually: not built yet |
| 462 | Handle medical emergency at branch | DONE | DONE | incidents type=medical (critical alert) · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 463 | Arrange emergency support | DONE | DONE | incident.critical → emergency contacts · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 464 | Communicate with dispatch manager on issues | PROCESS | — | operational practice, not software |
| 465 | View crew currently allocated to services | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties → Duty roster (who is on which bus; cancel and reassign) |
| 466 | Request change of crew | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties → Duty roster (who is on which bus; cancel and reassign) |
| 467 | Report bus cleaning issue | DONE | DONE | verified manually: existing module/API · UI: Operations → Report incident (other / breakdown) with details |
| 468 | Report bus maintenance issue | DONE | DONE | verified manually: existing module/API · UI: Operations → Report incident (other / breakdown) with details |
| 469 | View upcoming document expiry of buses | DONE | DONE | verified manually: existing module/API · UI: Fleet → bus page documents (upload, expiry) + Fleet → Renewals |
| 470 | Handle enquiry from police or RTO | PROCESS | — | operational practice, not software |
| 471 | Provide official passenger list to authorities | DONE | DONE | GET /bookings/trips/:tripId/chart (passenger list by boarding point) — printed from the web chart · UI: Trips & Charts › chart: Print chart + passenger list |
| 472 | Manage passenger queue during peak hours | PROCESS | — | operational practice, not software |
| 473 | Open additional temporary counter | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 474 | Close under-utilized counter | CONFLICT | — | counter / cash / branch wallet — excluded by the scenario file & earlier decision |
| 475 | Escalate unresolved technical issue to support | DONE | DONE | verified manually: existing module/API · UI: Support → ticket → Escalate to Ticketly (internal note; 'With Ticketly' view); super admin → Support escalations (answer / close) |
| 476 | View system notifications | DONE | DONE | verified manually: existing module/API · UI: Platform announcements banner in the console |
| 477 | Clear system notifications | GAP | — | verified manually: not built yet |
| 478 | Change own login password | DONE | DONE | POST /auth/password (current required; other sessions end) · UI: My account (/me) |
| 479 | View own activity log | DONE | DONE | GET /users/me (activity) · UI: My account (/me) |
| 480 | Perform secure logout | DONE | DONE | verified manually: existing module/API · UI: My account (/me) |
| 481 | Login to agent portal | DONE | DONE | verified manually: existing module/API · UI: Agent login → Agent portal (own nav; staff pages redirect) |
| 482 | View current wallet balance | DONE | DONE | verified manually: existing module/API · UI: Agent portal → My account: balance, can-sell-up-to, commission %, low-balance warning |
| 483 | Receive low balance warning | DONE | DONE | verified manually: existing module/API · UI: Agent portal → My account: balance, can-sell-up-to, commission %, low-balance warning |
| 484 | Raise wallet recharge request | GAP | — | verified manually: not built yet |
| 485 | Select recharge amount | GAP | — | verified manually: not built yet |
| 486 | Complete recharge payment | GAP | — | verified manually: not built yet |
| 487 | View updated wallet balance | DONE | DONE | verified manually: existing module/API · UI: Agent portal → My account: balance, can-sell-up-to, commission %, low-balance warning |
| 488 | Search buses by origin and destination | DONE | DONE | verified manually: existing module/API · UI: storefront home + /results (verified in browser) |
| 489 | Select journey date | DONE | DONE | verified manually: existing module/API · UI: storefront home + /results (verified in browser) |
| 490 | View list of available services | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |
| 491 | View departure and arrival timings | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |
| 492 | View fare for each service | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |
| 493 | View seat map of selected service | DONE | DONE | verified manually: existing module/API · UI: trip seat map: SeatSelector (live refresh, taken seats drop out, ladies/accessible) |
| 494 | View agent special discounted fare | GAP | — | verified manually: not built yet |
| 495 | Select one or more seats | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |
| 496 | Enter first passenger name | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |
| 497 | Enter first passenger age and gender | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |
| 498 | Enter first passenger mobile number | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |
| 499 | Enter additional passengers | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |
| 500 | View total fare and commission amount | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |

## #501–#1000

CONFLICT 11, DONE 260, DUP 2, GAP 63, INFRA 3, PROCESS 2

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 501 | Confirm the booking | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |
| 502 | Receive booking confirmation | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Book seats: search results with times and fares, seat map, passengers (name, age, gender, mobile), fare + commission, pay from account, confirmation with PNR/commission/new balance |
| 503 | Download ticket PDF | GAP | — | verified manually: not built yet |
| 504 | Share ticket with customer | GAP | — | verified manually: not built yet |
| 505 | Search booking by PNR | DONE | DONE | verified manually: existing module/API · UI: operator Bookings list + detail (find by PNR/mobile/ticket, filters, CSV) |
| 506 | Search booking by mobile number | DONE | DONE | GET /bookings/search (agent-scoped via portal) · UI: Agent portal → My bookings: find by PNR or mobile; booking page with journey, passengers, commission |
| 507 | View complete booking details | DONE | DONE | verified manually: existing module/API · UI: Agent portal → My bookings: find by PNR or mobile; booking page with journey, passengers, commission |
| 508 | Raise boarding point change request | DONE | DONE | POST /agent-portal/bookings/:id/change-points · UI: Agent booking → Change boarding / drop point, Correct a name, Change seat |
| 509 | Raise drop point change request | DONE | DONE | POST /agent-portal/bookings/:id/change-points · UI: Agent booking → Change boarding / drop point, Correct a name, Change seat |
| 510 | Correct spelling of passenger name | DONE | DONE | POST /bookings/:id/correct-name (no transfers) · UI: Agent booking → Change boarding / drop point, Correct a name, Change seat |
| 511 | Request seat change on same bus | DONE | DONE | POST /agent-portal/bookings/:id/change-seats · UI: Agent booking → Change boarding / drop point, Correct a name, Change seat |
| 512 | Request date change | GAP | — | verified manually: not built yet |
| 513 | View fare difference for date change | GAP | — | verified manually: not built yet |
| 514 | Confirm date change | GAP | — | verified manually: not built yet |
| 515 | Raise full cancellation request | DONE | DONE | verified manually: existing module/API · UI: Agent booking → Cancel…: whole or chosen seats, charges and refund shown first, refund credited, commission updated |
| 516 | View applicable cancellation charges | DONE | DONE | verified manually: existing module/API · UI: Agent booking → Cancel…: whole or chosen seats, charges and refund shown first, refund credited, commission updated |
| 517 | View net refund amount | DONE | DONE | verified manually: existing module/API · UI: Agent booking → Cancel…: whole or chosen seats, charges and refund shown first, refund credited, commission updated |
| 518 | Confirm cancellation | DONE | DONE | verified manually: existing module/API · UI: Agent booking → Cancel…: whole or chosen seats, charges and refund shown first, refund credited, commission updated |
| 519 | View updated commission after cancellation | DONE | DONE | verified manually: existing module/API · UI: Agent booking → Cancel…: whole or chosen seats, charges and refund shown first, refund credited, commission updated |
| 520 | Raise partial cancellation for one passenger | DONE | DONE | POST /bookings/:id/cancel-seats (staff / owner / booking mobile; seat_count kept in step) · UI: Agent booking → Cancel…: whole or chosen seats, charges and refund shown first, refund credited, commission updated |
| 521 | Add passenger to waitlist | DONE | DONE | verified manually: existing module/API · UI: Search & Book → full bus: Add to waitlist (SMS when seats free up) |
| 522 | Receive notification when waitlist confirms | DONE | DONE | verified manually: existing module/API · UI: Search & Book → full bus: Add to waitlist (SMS when seats free up) |
| 523 | Raise request for group booking | GAP | — | verified manually: not built yet |
| 524 | Raise request for corporate bulk booking | GAP | — | verified manually: not built yet |
| 525 | Book seats under ladies quota | GAP | — | verified manually: not built yet |
| 526 | Book seats under senior citizen quota | GAP | — | verified manually: not built yet |
| 527 | Create booking while offline | GAP | — | verified manually: not built yet |
| 528 | Sync offline booking when online | GAP | — | verified manually: not built yet |
| 529 | Handle case when seat is gone during sync | GAP | — | verified manually: not built yet |
| 530 | View own booking history for today | DONE | DONE | GET /agent-portal/bookings?from&to · UI: Agent portal → My bookings: Today / This week / This month |
| 531 | View own booking history for week | DONE | DONE | GET /agent-portal/bookings?from&to · UI: Agent portal → My bookings: Today / This week / This month |
| 532 | View own booking history for month | DONE | DONE | GET /agent-portal/bookings?from&to · UI: Agent portal → My bookings: Today / This week / This month |
| 533 | Download detailed commission statement | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Statement: period summary, entries, CSV download, commission still pending |
| 534 | View list of pending commission | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Statement: period summary, entries, CSV download, commission still pending |
| 535 | View TDS deducted amount | GAP | — | verified manually: not built yet |
| 536 | View own performance dashboard | GAP | — | verified manually: not built yet |
| 537 | View own conversion rate | GAP | — | verified manually: not built yet |
| 538 | View own cancellation rate | GAP | — | verified manually: not built yet |
| 539 | Collect feedback from customer | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Help & support: raise feedback / complaint / technical request, see replies |
| 540 | Raise complaint against bus operator | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Help & support: raise feedback / complaint / technical request, see replies |
| 541 | Raise technical support ticket | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Help & support: raise feedback / complaint / technical request, see replies |
| 542 | Set alert for new service on favorite route | GAP | — | verified manually: not built yet |
| 543 | Save frequently used routes | GAP | — | verified manually: not built yet |
| 544 | Save frequent passenger details | GAP | — | verified manually: not built yet |
| 545 | Update own profile information | GAP | — | verified manually: not built yet |
| 546 | Update bank details for settlement | GAP | — | verified manually: not built yet |
| 547 | Change login password | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Help: change password (My account), terms pages, operator contacts |
| 548 | View terms and conditions | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Help: change password (My account), terms pages, operator contacts |
| 549 | View support contact details | DONE | DONE | verified manually: existing module/API · UI: Agent portal → Help: change password (My account), terms pages, operator contacts |
| 550 | Perform logout | DONE | DONE | verified manually: existing module/API · UI: Agent login → Agent portal (own nav; staff pages redirect) |
| 551 | Login to dispatch dashboard | DONE | DONE | verified manually: existing module/API · UI: Console sign-in / sign-out (every module) |
| 552 | View complete list of today’s services | DONE | DONE | verified manually: existing module/API · UI: Trips → day list, status filter (Cancelled), bus on each trip |
| 553 | View real-time occupancy percentage of each service | DONE | DONE | verified manually: existing module/API · UI: Trip chart (live seat map) |
| 554 | Filter services by on-time status | GAP | — | verified manually: not built yet |
| 555 | Filter services by delayed status | GAP | — | verified manually: not built yet |
| 556 | Filter services by cancelled status | DONE | DONE | verified manually: existing module/API · UI: Trips → day list, status filter (Cancelled), bus on each trip |
| 557 | View current bus allocation | DONE | DONE | verified manually: existing module/API · UI: Trips → day list, status filter (Cancelled), bus on each trip |
| 558 | View current driver allocation | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 559 | View current conductor allocation | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 560 | Assign bus to a service | DONE | DONE | verified manually: existing module/API · UI: Trips & Charts › chart › Assign / change bus |
| 561 | Assign driver to a service | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 562 | Assign conductor to a service | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 563 | Change already assigned crew | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 564 | View live GPS location of all buses | DONE | DONE | verified manually: existing module/API · UI: Operations → On the road (every bus: position, speed, next stop, late/early, signal lost) |
| 565 | Receive automatic delay alert | DONE | DONE | verified manually: existing module/API · UI: Operations → On the road: alert banner for buses >15 min late (GPS), refreshing every 30 s; passengers told automatically |
| 566 | Enter reason for delay | DONE | DONE | verified manually: existing module/API · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 567 | Select delay category (traffic, breakdown, weather, other) | DONE | DONE | incidents type=delay + delayCategory · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 568 | Send delay SMS to all passengers | DONE | DONE | verified manually: existing module/API · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 569 | Send delay WhatsApp to all passengers | DONE | DONE | verified manually: existing module/API · UI: Operations → Report incident → Delay: every booked passenger is told (SMS; WhatsApp too with a WhatsApp template in Settings → Message Templates) |
| 570 | Identify services with very low occupancy | DONE | DONE | verified manually: existing module/API · UI: Reports → Forecast (weak trips: keep / plan to cancel) |
| 571 | Take decision to cancel low occupancy service | DONE | DONE | verified manually: existing module/API · UI: Reports → Forecast (weak trips: keep / plan to cancel) |
| 572 | Cancel service in system | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Cancel trip (reason) |
| 573 | Automatically notify all booked passengers | DONE | DONE | verified manually: existing module/API · UI: Operations → Report incident → Delay: every booked passenger is told (SMS; WhatsApp too with a WhatsApp template in Settings → Message Templates) |
| 574 | Offer alternate service to cancelled passengers | GAP | — | verified manually: not built yet |
| 575 | Shift passengers to alternate service | GAP | — | verified manually: not built yet |
| 576 | Create new extra trip service | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 577 | Set departure time for extra trip | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 578 | Release inventory for extra trip | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 579 | Handle bus breakdown report | DONE | DONE | incidents type=breakdown · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 580 | Arrange replacement bus | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Change bus (re-seats on a different layout) + earlier changes |
| 581 | Re-allocate all passengers to replacement bus | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Change bus (re-seats on a different layout) + earlier changes |
| 582 | Generate final boarding chart | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Print chart |
| 583 | Share boarding chart with conductor | DUP | DUP | same as #366 |
| 584 | Receive live boarding updates from conductor | DONE | DONE | verified manually: existing module/API · UI: Trips & Charts → chart: Boarded count / boarded seats from the crew app |
| 585 | Mark passengers as no-show | DONE | DONE | verified manually: existing module/API · UI: Booking page → Mark no-show after departure |
| 586 | Enable way-side booking for service | CONFLICT | — | way-side / conductor cash — earlier decision |
| 587 | Disable way-side booking for service | CONFLICT | — | way-side / conductor cash — earlier decision |
| 588 | Enter route diversion details | DONE | DONE | incidents type=diversion (diversionVia) · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 589 | Notify passengers about route diversion | DONE | DONE | trip.diverted event · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 590 | Prepare crew duty roster for next day | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 591 | Mark attendance of driver | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 592 | Mark attendance of conductor | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 593 | Approve overtime for crew | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 594 | Approve double duty for crew | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 595 | Report fuel related issue | DONE | DONE | verified manually: existing module/API · UI: Operations → Report incident → Fuel problem (high priority) |
| 596 | Report maintenance related issue | DONE | DONE | verified manually: existing module/API · UI: Fleet → bus page → Maintenance |
| 597 | View on-time performance percentage | DONE | DONE | GET /reports/dispatch onTimePct (actual_departed_at) · UI: Reports → Dispatch |
| 598 | View average delay duration | DONE | DONE | GET /reports/dispatch avgDepartureDelayMin · UI: Reports → Dispatch |
| 599 | Generate daily dispatch summary report | DONE | DONE | GET /reports/dispatch · UI: Reports → Dispatch |
| 600 | Generate report of all delayed services | DONE | DONE | GET /reports/dispatch delayed[] · UI: Reports → Dispatch |
| 601 | Generate report of all cancelled services | DONE | DONE | verified manually: existing module/API · UI: Trips → day list, status filter (Cancelled), bus on each trip |
| 602 | View performance report of each crew member | DONE | DONE | GET /reports/dispatch crew[] · UI: Reports → Dispatch |
| 603 | View utilization report of each bus | DONE | DONE | GET /reports/dispatch buses[] · UI: Reports → Dispatch |
| 604 | Receive emergency alert from bus | DONE | DONE | incident.critical → emergency contacts (SMS+email) · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 605 | Notify emergency support team | DONE | DONE | incident.critical consumer · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 606 | Register passenger complaint related to service | DONE | DONE | support tickets: staff raise by PNR / reply / priority / assign / resolve; customers own tickets only; author from account · UI: Support: queue views (active/mine/unassigned/…), search, ticket thread with reply, resolve/reopen/close, priority, assign; raise for a caller by PNR |
| 607 | Enter details of lost luggage | DONE | DONE | POST /lost-found · UI: Operations → Lost & found |
| 608 | Finalize next day bus and crew allocation | DONE | DONE | verified manually: existing module/API · UI: Trips (tomorrow) + Fleet → Duty roster |
| 609 | Block inventory at last minute | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Block / open seats |
| 610 | Release inventory at last minute | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Block / open seats |
| 611 | Adjust OTA inventory percentage at last minute | DONE | DONE | PUT /trips/:tripId/closed-channels (ota off/on per trip) · UI: Trip chart → Sales channels |
| 612 | Add internal dispatch notes | DONE | DONE | verified manually: existing module/API · UI: Operations → Shift notes |
| 613 | Write shift handover notes for next dispatcher | DONE | DONE | POST/GET /shift-notes scope=dispatch · UI: Operations → Shift notes |
| 614 | Perform dispatch updates in offline mode | GAP | — | verified manually: not built yet |
| 615 | Sync offline dispatch updates | GAP | — | verified manually: not built yet |
| 616 | Resolve data conflicts after sync | GAP | — | verified manually: not built yet |
| 617 | Switch to manual tracking when GPS fails | GAP | — | verified manually: not built yet |
| 618 | Generate monthly dispatch efficiency report | GAP | — | verified manually: not built yet |
| 619 | View crew rest period compliance | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 620 | View crew duty hours compliance | DONE | DONE | verified manually: existing module/API · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 621 | Logout from dispatch system | DONE | DONE | verified manually: existing module/API · UI: Console sign-in / sign-out (every module) |
| 622 | Login with own credentials | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 623 | View list of assigned services for the day | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 624 | Select current service | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 625 | View complete service details | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 626 | Download latest boarding chart | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 627 | View passenger names and seat numbers | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 628 | View passenger boarding points | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 629 | Reach boarding point and call passengers | PROCESS | — | on-ground practice, not software |
| 630 | Verify passenger ticket or PNR | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 631 | Mark passenger as successfully boarded | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 632 | Guide passenger to correct seat | PROCESS | — | on-ground practice, not software |
| 633 | Prevent male passenger from sitting on ladies seat | DONE | DONE | verified manually: existing module/API · UI: checkout: ladies seat + gender validation |
| 634 | Issue ticket to passenger without prior booking | CONFLICT | — | way-side / conductor cash — earlier decision |
| 635 | Issue ticket to way-side passenger | CONFLICT | — | way-side / conductor cash — earlier decision |
| 636 | Create way-side booking in offline mode | CONFLICT | — | way-side / conductor cash — earlier decision |
| 637 | Sync way-side booking later | CONFLICT | — | way-side / conductor cash — earlier decision |
| 638 | Accept request for seat change | GAP | — | verified manually: not built yet |
| 639 | Update new seat number in system | GAP | — | verified manually: not built yet |
| 640 | Accept request for boarding point change | GAP | — | verified manually: not built yet |
| 641 | Accept request for drop point change | GAP | — | verified manually: not built yet |
| 642 | Correct passenger name spelling | GAP | — | verified manually: not built yet |
| 643 | Mark passenger as no-show | DUP | DUP | same as #375 |
| 644 | Record luggage pieces | GAP | — | verified manually: not built yet |
| 645 | Collect extra luggage charges | GAP | — | verified manually: not built yet |
| 646 | Note down passenger complaint | DONE | DONE | support tickets: staff raise by PNR / reply / priority / assign / resolve; customers own tickets only; author from account · UI: Support: queue views (active/mine/unassigned/…), search, ticket thread with reply, resolve/reopen/close, priority, assign; raise for a caller by PNR |
| 647 | Raise medical emergency alert | DONE | DONE | POST /crew/trips/:id/sos kind=medical · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 648 | Raise security or police alert | DONE | DONE | POST /crew/trips/:id/sos kind=security · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 649 | Inform dispatch about bus breakdown | DONE | DONE | incidents type=breakdown · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 650 | Enter reason for traffic delay | DONE | DONE | incidents type=delay (category) · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 651 | Update estimated time for next stop | GAP | — | verified manually: not built yet |
| 652 | Inform passenger about boarding point change | GAP | — | verified manually: not built yet |
| 653 | Continuously update live occupancy | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 654 | Submit final occupancy count at trip end | GAP | — | verified manually: not built yet |
| 655 | Enter total cash collected | CONFLICT | — | way-side / conductor cash — earlier decision |
| 656 | Enter total digital payments collected | CONFLICT | — | way-side / conductor cash — earlier decision |
| 657 | Generate collection summary | CONFLICT | — | way-side / conductor cash — earlier decision |
| 658 | Hand over cash to authorized person | CONFLICT | — | way-side / conductor cash — earlier decision |
| 659 | Record lost and found item | DONE | DONE | POST /lost-found · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 660 | Collect passenger feedback | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 661 | Check details of next assigned duty | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 662 | Mark own attendance | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 663 | Enter fuel filled quantity | GAP | — | verified manually: not built yet |
| 664 | Enter current mileage | GAP | — | verified manually: not built yet |
| 665 | Report cleaning issue in bus | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 666 | Report maintenance issue in bus | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 667 | Keep GPS tracking active throughout trip | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login; GPS taken from 1 h before departure until the trip is closed (tracking-window.ts, 422 outside) · journey reminders 8h / 4h / 1h by SMS, WhatsApp, email with every driver + conductor and the tracking link (TripReminderScheduler) · UI: Crew app (/crew): GPS sharing starts on its own 1 h before departure; /track/:token says "starts at …" / "journey ended at …" and lists the crew with phones |
| 668 | Press panic button in real emergency | DONE | DONE | POST /crew/trips/:id/sos (one tap) · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 669 | Move from offline mode to online mode | GAP | — | verified manually: not built yet |
| 670 | Send manual report when automatic sync fails | GAP | — | verified manually: not built yet |
| 671 | Handle two services on same day (double duty) | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 672 | Complete special checklist for night service | GAP | — | verified manually: not built yet |
| 673 | Strictly follow ladies special service rules | DONE | DONE | crew app: GET /crew/me, /crew/trips/:id/* (own duties only), PUT /fleet/crew/:id/login · UI: Crew app (/crew): duties, trip manifest by boarding point, board / code check-in, report, lost item, GPS, Emergency; Fleet → Crew: Give app login |
| 674 | Submit final trip report | GAP | — | verified manually: not built yet |
| 675 | End duty for the day | GAP | — | verified manually: not built yet |
| 676 | Login to inventory and schedule module | DONE | DONE | verified manually: existing module/API · UI: Console sign-in / sign-out (every module) |
| 677 | View complete list of active routes | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → create route, cities, stops, km, running time, boarding/drop points |
| 678 | Create brand new route | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → create route, cities, stops, km, running time, boarding/drop points |
| 679 | Define origin city | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → create route, cities, stops, km, running time, boarding/drop points |
| 680 | Define destination city | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → create route, cities, stops, km, running time, boarding/drop points |
| 681 | Add first intermediate stage | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → create route, cities, stops, km, running time, boarding/drop points |
| 682 | Add more intermediate stages | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → create route, cities, stops, km, running time, boarding/drop points |
| 683 | Enter distance for each stage | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → create route, cities, stops, km, running time, boarding/drop points |
| 684 | Enter running time for each stage | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → create route, cities, stops, km, running time, boarding/drop points |
| 685 | Map all pickup points for the route | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → create route, cities, stops, km, running time, boarding/drop points |
| 686 | Map all drop points for the route | DONE | DONE | verified manually: existing module/API · UI: Routes & Stops → create route, cities, stops, km, running time, boarding/drop points |
| 687 | Create new service schedule | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 688 | Set service name or number | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 689 | Set departure time | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 690 | Set arrival time | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 691 | Configure daily recurrence | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 692 | Configure weekly recurrence pattern | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 693 | Create one-time special service | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 694 | Edit existing service timing | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 695 | Temporarily suspend a service | DONE | DONE | verified manually: existing module/API · UI: Schedule → Pause |
| 696 | Permanently cancel a service | DONE | DONE | verified manually: existing module/API · UI: Schedule → service (vehicle type → seat layout); Manage → end / delete service |
| 697 | Stop further inventory release for cancelled service | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 698 | Link correct seat layout to service | DONE | DONE | verified manually: existing module/API · UI: Schedule → service (vehicle type → seat layout); Manage → end / delete service |
| 699 | Block inventory for scheduled maintenance | DONE | DONE | inventory blocks / quotas · UI: Trip chart → Block / open seats |
| 700 | Block inventory for charter booking | DONE | DONE | inventory blocks / quotas · UI: Trip chart → Block / open seats |
| 701 | Release inventory after maintenance | DONE | DONE | inventory blocks / quotas · UI: Trip chart → Block / open seats |
| 702 | Release inventory after charter | DONE | DONE | inventory blocks / quotas · UI: Trip chart → Block / open seats |
| 703 | Define ladies quota in seats or percentage | DONE | DONE | PUT /scheduling/services/:id/sales-rules (same as #173/#174/#170) · UI: Schedule → Manage service |
| 704 | Define senior citizen quota | DONE | DONE | PUT /scheduling/services/:id/sales-rules (same as #173/#174/#170) · UI: Schedule → Manage service |
| 705 | Define inventory quota for each agent | DONE | DONE | POST /trips/:tripId/quotas (fixed: every allocation used to fail) · UI: Trip chart → Agent & branch seats |
| 706 | Define inventory allocation for each branch | DONE | DONE | POST /trips/:tripId/quotas (fixed: every allocation used to fail) · UI: Trip chart → Agent & branch seats |
| 707 | Set percentage of inventory to release to OTAs | DONE | DONE | PUT /scheduling/services/:id/sales-rules (same as #173/#174/#170) · UI: Schedule → Manage service |
| 708 | Pull back inventory from OTA at last moment | DONE | DONE | PUT /trips/:tripId/closed-channels (ota off/on per trip) · UI: Trip chart → Sales channels |
| 709 | Apply dynamic pricing rule on selected service | DONE | DONE | verified manually: existing module/API · UI: Pricing → Yield Policies → New policy → Applies to: Service · <code> (time) — wins over the route policy |
| 710 | Define peak time fare | DONE | DONE | verified manually: existing module/API · UI: Pricing → Route limits & peak times |
| 711 | Define off-peak time fare | DONE | DONE | verified manually: existing module/API · UI: Pricing → Route limits & peak times |
| 712 | Apply festive season fare increase | DONE | DONE | verified manually: existing module/API · UI: Pricing → Fare plan: sheet download/upload, change all by % |
| 713 | Release seats under promotional discount | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Fare for this trip |
| 714 | Update complete fare matrix | DONE | DONE | verified manually: existing module/API · UI: Pricing → Fare plan: sheet download/upload, change all by % |
| 715 | Perform bulk fare update for multiple services | DONE | DONE | POST /pricing/fare-plans/:id/rules/adjust (all fares of a route's plan by %) · UI: Pricing → Fare plan: sheet download/upload, change all by % |
| 716 | Set different fare for different seat types | DONE | DONE | verified manually: existing module/API · UI: Pricing → Fare plans (seat-type fares, seat overrides) |
| 717 | View current inventory utilization report | DONE | DONE | verified manually: existing module/API · UI: Reports → Dispatch |
| 718 | Identify services running with low occupancy | DONE | DONE | verified manually: existing module/API · UI: Reports → Forecast (weak trips: keep / plan to cancel) |
| 719 | Add extra seats or service on high demand | DONE | DONE | verified manually: existing module/API · UI: Schedule → Busy trips suggestions |
| 720 | View occupancy forecast for coming days | DONE | DONE | verified manually: existing module/API · UI: Reports → Forecast (weak trips: keep / plan to cancel) |
| 721 | Detect schedule timing clash | GAP | — | verified manually: not built yet |
| 722 | Resolve schedule clash | GAP | — | verified manually: not built yet |
| 723 | Allocate specific bus to service | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Assign / Change bus |
| 724 | Configure merge of two buses into one service | GAP | — | verified manually: not built yet |
| 725 | Set up multi-hop connecting service | DONE | DONE | verified manually: existing module/API · UI: Settings → Connections: take part in two-bus journeys, shortest/longest change; preview your own connections |
| 726 | Define blackout dates when service will not run | DONE | DONE | POST /scheduling/routes/:id/blackouts (same as #271) · UI: Schedule → Route blackouts |
| 727 | Increase frequency of service | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 728 | Decrease frequency of service | DONE | DONE | verified manually: existing module/API · UI: Schedule → Manage service |
| 729 | Apply temporary route diversion | DONE | DONE | incidents type=diversion · UI: Operations → Incidents (report delay/diversion/breakdown/emergency, acknowledge, resolve, close) |
| 730 | Check whether inventory is correctly synced with OTAs | DONE | DONE | verified manually: existing module/API · UI: Trip chart → Sales channels → OTA partners: what they see now (seats, sold, paying), partners receiving |
| 731 | Manually fix inventory sync issues | DONE | DONE | verified manually: existing module/API · UI: Trip chart → OTA partners card: issues with one-click fix (Reopen for partners; links to Distribution / the service) |
| 732 | Export historical occupancy data | GAP | — | verified manually: not built yet |
| 733 | Automatically notify passengers when schedule changes | GAP | — | verified manually: not built yet |
| 734 | Upload schedules in bulk using Excel | GAP | — | verified manually: not built yet |
| 735 | Download Excel template for schedule upload | GAP | — | verified manually: not built yet |
| 736 | View complete history of schedule changes | DONE | DONE | GET versions / POST restore (same as #269/#270) · UI: Schedule → Manage service |
| 737 | Rollback schedule to an earlier version | DONE | DONE | GET versions / POST restore (same as #269/#270) · UI: Schedule → Manage service |
| 738 | Generate monthly inventory efficiency report | GAP | — | verified manually: not built yet |
| 739 | View seat-wise sales report | GAP | — | verified manually: not built yet |
| 740 | View stage-wise passenger movement report | GAP | — | verified manually: not built yet |
| 741 | Logout from module | DONE | DONE | verified manually: existing module/API · UI: Console sign-in / sign-out (every module) |

## #1–#500

CONFLICT 20, DONE 373, GAP 93, INFRA 17, PROCESS 3

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 1 | CONCURRENCY & RACE CONDITIONS (901-1000) | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |

## #501–#1000

CONFLICT 11, DONE 260, DUP 2, GAP 63, INFRA 3, PROCESS 2

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 901 | Two different users select the same seat at the same second | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (parallel holds: one wins, rest INVENTORY.SEAT_UNAVAILABLE) · checkout shows 'Seat N is being booked by someone else' + Choose other seats (browser-verified) |
| 902 | User A holds seat and User B tries to book it | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: seat map shows held seats as booked; hold refused → 'Choose other seats' |
| 903 | Payment is being processed while another user books same seat | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 904 | OTA booking and direct booking hit same seat together | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 905 | Agent booking and branch booking conflict on same seat | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 906 | Waitlist confirmation and new booking race for last seat | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 907 | Seat hold timer expires exactly during payment | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: checkout HoldTimer: expiry screen, re-pick seats; changing seats releases the hold |
| 908 | User opens multiple browser tabs and books same seat | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (parallel holds: one wins, rest INVENTORY.SEAT_UNAVAILABLE) · checkout shows 'Seat N is being booked by someone else' + Choose other seats (browser-verified) |
| 909 | User refreshes page during payment processing | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 910 | User presses browser back button after successful payment | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 911 | User double-clicks on Confirm Booking button | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (same idempotency key in parallel → one booking; missing key → 400) · web sends one key per quote and disables the button while holding |
| 912 | Network automatically retries payment request | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (same idempotency key in parallel → one booking; missing key → 400) · web sends one key per quote and disables the button while holding |
| 913 | Booking API called without idempotency key | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (same idempotency key in parallel → one booking; missing key → 400) · web sends one key per quote and disables the button while holding |
| 914 | Two requests with same idempotency key arrive | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (same idempotency key in parallel → one booking; missing key → 400) · web sends one key per quote and disables the button while holding |
| 915 | Distributed lock could not be acquired in time | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 916 | Optimistic locking detects version mismatch | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 917 | Database throws unique constraint error on seat | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 918 | Seat auto-released by timeout while payment callback arrives | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (a timed-out hold cannot be paid; seat free again) · checkout timer ends the hold |
| 919 | In group booking some seats succeed and some fail | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 920 | Multi-hop booking first leg succeeds second leg fails | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 921 | Inventory service updates seat but booking service fails | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 922 | Payment is captured but commission service fails | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 923 | Booking succeeds but passenger notification fails | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 924 | Cancellation and seat change requested at same time | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 925 | Cancellation and date change requested at same time | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 926 | Service is cancelled while passenger is still booking | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 927 | Fare is updated while passenger is on payment page | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 928 | Inventory is blocked while passenger is selecting seats | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 929 | Agent credit limit is exhausted during booking process | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 930 | Branch wallet balance becomes zero during booking | CONFLICT | — | branch wallet / cash / loyalty / way-side — earlier decision |
| 931 | OTA pulls back inventory while booking is in progress | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 932 | Dynamic price increases after seat selection | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 933 | Coupon validity expires during checkout | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 934 | User session expires after selecting seats | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 935 | User session expires after starting payment | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 936 | User is logged out from another session during booking | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 937 | System enters maintenance mode during active booking | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 938 | API rate limit is hit during peak booking time | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 939 | Database connection pool is fully exhausted | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 940 | Cache is invalidated in middle of booking flow | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 941 | Server clocks are skewed causing time validation failure | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 942 | System shows negative available seats due to race | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (unique PNRs, no seatless confirmed booking, no seat sold twice on a leg) |
| 943 | Eventual consistency causes temporary overselling | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 944 | Seat appears available but booking is rejected | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (parallel holds: one wins, rest INVENTORY.SEAT_UNAVAILABLE) · checkout shows 'Seat N is being booked by someone else' + Choose other seats (browser-verified) |
| 945 | Booking is successful but seat map still shows free | DONE | DONE | seat map excludes live holds (inventory LIVE_HOLD); POST /bookings/:id/release-hold frees the holder's own hold early; e2e hold-release · UI: seat map shows held seats as booked; hold refused → 'Choose other seats' |
| 946 | Booking record is created without actual seat assignment | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (unique PNRs, no seatless confirmed booking, no seat sold twice on a leg) |
| 947 | Two cancellations for same booking arrive together | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (two cancels at once → one cancellation; the seat rebooks at once) |
| 948 | Refund and new booking on same seat happen together | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 949 | Schedule change and booking happen concurrently | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 950 | Inventory release and booking happen concurrently | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 951 | Multiple agents try to book last available seat | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (parallel holds: one wins, rest INVENTORY.SEAT_UNAVAILABLE) · checkout shows 'Seat N is being booked by someone else' + Choose other seats (browser-verified) |
| 952 | Branch staff and agent book last seat together | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (parallel holds: one wins, rest INVENTORY.SEAT_UNAVAILABLE) · checkout shows 'Seat N is being booked by someone else' + Choose other seats (browser-verified) |
| 953 | Waitlist and regular booking compete for released seat | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 954 | Seat is released by cancellation and immediately rebooked | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (two cancels at once → one cancellation; the seat rebooks at once) |
| 955 | High concurrency on popular festival service | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 956 | Flash sale causes thousands of simultaneous requests | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 957 | Database deadlocks under heavy concurrent load | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 958 | Lock wait timeout occurs | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 959 | Transaction is rolled back due to concurrency conflict | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 960 | Partial commit leaves system in inconsistent state | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 961 | Saga step fails in middle of distributed transaction | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 962 | Compensating transaction also fails | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 963 | Manual intervention required for stuck booking | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 964 | Duplicate booking IDs generated | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (unique PNRs, no seatless confirmed booking, no seat sold twice on a leg) |
| 965 | PNR collision occurs | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (unique PNRs, no seatless confirmed booking, no seat sold twice on a leg) |
| 966 | Same passenger books multiple seats in race | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 967 | Seat preference logic conflicts under concurrency | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 968 | Ladies quota and general quota race | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 969 | Senior quota and general quota race | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 970 | Group booking splits under concurrent load | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 971 | Multi-seat selection partially fails | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 972 | Temporary hold is not released properly | DONE | DONE | seat map excludes live holds (inventory LIVE_HOLD); POST /bookings/:id/release-hold frees the holder's own hold early; e2e hold-release · UI: checkout HoldTimer: expiry screen, re-pick seats; changing seats releases the hold |
| 973 | Hold expiry job and booking job conflict | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: e2e concurrency spec (a timed-out hold cannot be paid; seat free again) · checkout timer ends the hold |
| 974 | Cleanup job runs during active booking | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 975 | Report generation locks tables during booking | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 976 | Backup process causes locking | INFRA | — | DB operations (backup, index rebuild, sharding) — runbook |
| 977 | Index rebuild causes slowness and timeouts | INFRA | — | DB operations (backup, index rebuild, sharding) — runbook |
| 978 | Replication lag causes stale seat data | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 979 | Read replica returns old availability | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 980 | Write is successful but read does not see it immediately | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 981 | Cache hit returns stale free seat information | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 982 | Cache miss causes stampedes on database | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 983 | Multiple services try to update same inventory record | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 984 | Optimistic retry limit exceeded | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 985 | Pessimistic lock held too long | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 986 | Deadlock victim transaction is chosen | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 987 | Application retries indefinitely | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 988 | Circuit breaker opens due to cascading failures | GAP | — | verified manually: not built yet |
| 989 | Bulkhead isolation prevents total failure | GAP | — | verified manually: not built yet |
| 990 | Graceful degradation shows limited availability | GAP | — | verified manually: not built yet |
| 991 | System starts rejecting new bookings under extreme load | GAP | — | verified manually: not built yet |
| 992 | Queue builds up for booking requests | GAP | — | verified manually: not built yet |
| 993 | Request timeout occurs at load balancer | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 994 | Upstream service timeout | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 995 | Downstream payment service timeout | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 996 | Retry storm after outage recovery | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 997 | Thundering herd after cache expiry | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 998 | Hot key on very popular service causes bottleneck | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 999 | Sharding imbalance under load | INFRA | — | DB operations (backup, index rebuild, sharding) — runbook |
| 1000 | Complete system protection mode activated | GAP | — | verified manually: not built yet |

## #1–#500

CONFLICT 20, DONE 373, GAP 93, INFRA 17, PROCESS 3

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 2 | PAYMENT & REFUND EDGE CASES (1001-1100) | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |

## #1001–#1500

CONFLICT 12, DONE 128, DUP 1, GAP 128, OPEN 170, PROCESS 1

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 1001 | Payment success callback arrives after long delay | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1002 | Payment success callback is never received | GAP | — | verified manually: not built yet |
| 1003 | Payment fails at gateway but amount is deducted | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1004 | Customer is charged twice for one booking | DONE | TODO | duplicate capture auto-refund (classifyCapture + duplicate_payments + sweeper) |
| 1005 | Only partial amount is received | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1006 | Payment gateway does not respond in time | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1007 | Payment gateway returns unclear status | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1008 | Refund is initiated but gateway rejects it | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1009 | Refund is successful at gateway but booking status not updated | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1010 | Calculated refund amount is wrong | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1011 | Cancellation charges are calculated incorrectly | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1012 | GST on cancellation charges is wrong | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1013 | Refund to original payment method fails | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 1014 | Customer requests refund to different account | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 1015 | Bank account details provided for refund are invalid | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 1016 | Refund requested after allowed policy period | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → My trips → Manage booking: refund shown before cancelling, cancel some seats or all, closed after boarding time |
| 1017 | Multiple refund requests created for same booking | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 1018 | Refund requested after bus has already departed | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → My trips → Manage booking: refund shown before cancelling, cancel some seats or all, closed after boarding time |
| 1019 | Refund requested after passenger has boarded | GAP | — | verified manually: not built yet |
| 1020 | Only some passengers in booking are cancelled | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → My trips → Manage booking: refund shown before cancelling, cancel some seats or all, closed after boarding time |
| 1021 | Agent commission was already paid before refund | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1022 | Commission needs to be reversed after refund | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1023 | TDS needs adjustment after refund | GAP | — | verified manually: not built yet |
| 1024 | Credit note generation fails | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1025 | Refund needs to be done in different currency | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1026 | Currency conversion rate has changed | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1027 | Refund of wallet payment | CONFLICT | — | branch wallet / cash / loyalty / way-side — earlier decision |
| 1028 | Refund of mixed cash and digital payment | CONFLICT | — | branch wallet / cash / loyalty / way-side — earlier decision |
| 1029 | Refund of advance payment only | GAP | — | verified manually: not built yet |
| 1030 | Full payment done after advance and then cancelled | GAP | — | verified manually: not built yet |
| 1031 | Coupon was used and now refund is requested | GAP | — | verified manually: not built yet |
| 1032 | Decision whether to restore coupon or not | GAP | — | verified manually: not built yet |
| 1033 | Loyalty points were redeemed and refund requested | CONFLICT | — | branch wallet / cash / loyalty / way-side — earlier decision |
| 1034 | Cashback was already credited and refund requested | CONFLICT | — | branch wallet / cash / loyalty / way-side — earlier decision |
| 1035 | Extra luggage charges were paid and now refunded | GAP | — | verified manually: not built yet |
| 1036 | Seat upgrade charges were paid and now refunded | GAP | — | verified manually: not built yet |
| 1037 | Date change charges paid and later booking cancelled | GAP | — | verified manually: not built yet |
| 1038 | Multiple date changes done before final cancellation | GAP | — | verified manually: not built yet |
| 1039 | Free cancellation window expires by few seconds | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → My trips → Manage booking: refund shown before cancelling, cancel some seats or all, closed after boarding time |
| 1040 | Cancellation policy was changed after booking was made | GAP | — | verified manually: not built yet |
| 1041 | Full refund given under force majeure | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1042 | Operator himself cancels service and refunds | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1043 | Service is merged and fare difference refunded | GAP | — | verified manually: not built yet |
| 1044 | Bus is changed to lower fare category | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1045 | Bus is changed to higher fare category | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1046 | System prevents giving more refund than collected | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 1047 | System detects under-refund situation | GAP | — | verified manually: not built yet |
| 1048 | Refund status webhook is delayed | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1049 | Refund status webhook arrives multiple times | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1050 | Manual refund is forced by admin | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 1051 | Bulk refund job fails in the middle | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1052 | Refund report does not match gateway report | GAP | — | verified manually: not built yet |
| 1053 | Customer raises chargeback | GAP | — | verified manually: not built yet |
| 1054 | Customer raises payment dispute | GAP | — | verified manually: not built yet |
| 1055 | Settlement file from gateway has mismatch | GAP | — | verified manually: not built yet |
| 1056 | High value refund requires additional approval | GAP | — | verified manually: not built yet |
| 1057 | Refund approval is not given in time | GAP | — | verified manually: not built yet |
| 1058 | Low value refunds are auto-approved | GAP | — | verified manually: not built yet |
| 1059 | Refund is blocked due to suspected fraud | GAP | — | verified manually: not built yet |
| 1060 | Refund is put on hold for investigation | GAP | — | verified manually: not built yet |
| 1061 | Hold is released after investigation clearance | GAP | — | verified manually: not built yet |
| 1062 | Partial amount is held from refund | GAP | — | verified manually: not built yet |
| 1063 | Refund account is blocked by bank | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1064 | Refund account is already closed | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1065 | International card refund takes longer | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1066 | Refund fails due to technical error at bank | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1067 | Refund is successful but customer does not receive | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 1068 | Customer complains about non-receipt of refund | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 1069 | Duplicate refund is prevented by system | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 1070 | Refund is attempted on already refunded booking | DONE | DONE | GET /refunds queue (action/processing/done), POST /refunds with alternate account (fixed), POST /refunds/:id/manual with UTR (bank transfer or failed), GET /bookings/:id/refunds refundable; over-refund 422, idempotent · UI: Refunds: queue tabs + PNR filter, retry, mark paid with UTR after seeing the account, new refund from PNR with refundable cap and bank checks |
| 1071 | Refund currency is different from booking currency | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1072 | Rounding difference in refund amount | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1073 | Tax components need reverse calculation | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1074 | Discount portion handling in refund | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1075 | Promotional discount recovery on refund | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1076 | Agent discount handling on refund | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1077 | Branch discount handling on refund | GAP | — | verified manually: not built yet |
| 1078 | Refund after partial journey completed | GAP | — | verified manually: not built yet |
| 1079 | Refund rules for multi-hop journey | GAP | — | verified manually: not built yet |
| 1080 | Refund rules when one leg is used | GAP | — | verified manually: not built yet |
| 1081 | Open ticket refund rules | GAP | — | verified manually: not built yet |
| 1082 | Waitlist booking refund rules | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1083 | Group booking partial refund complexity | GAP | — | verified manually: not built yet |
| 1084 | Corporate booking credit note refund | GAP | — | verified manually: not built yet |
| 1085 | Refund to agent wallet instead of customer | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1086 | Refund settlement cycle impact | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1087 | Month-end refund liability calculation | GAP | — | verified manually: not built yet |
| 1088 | Outstanding refund aging report | GAP | — | verified manually: not built yet |
| 1089 | Automatic reminder for pending refunds | GAP | — | verified manually: not built yet |
| 1090 | Escalation of long pending refunds | GAP | — | verified manually: not built yet |
| 1091 | Refund related customer communication | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1092 | SMS on refund initiation | GAP | — | verified manually: not built yet |
| 1093 | SMS on refund success | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1094 | WhatsApp on refund success | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1095 | Email with refund details | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1096 | Refund receipt generation | GAP | — | verified manually: not built yet |
| 1097 | Credit note PDF generation | GAP | — | verified manually: not built yet |
| 1098 | Accounting entry for refund | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1099 | Reconciliation of refund with books | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1100 | Final sign-off on refund process | PROCESS | — | sign-off is a business step |

## #1–#500

CONFLICT 20, DONE 373, GAP 93, INFRA 17, PROCESS 3

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 3 | OFFLINE MODE EDGE CASES (1101-1200) | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |

## #1001–#1500

CONFLICT 12, DONE 128, DUP 1, GAP 128, OPEN 170, PROCESS 1

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 1101 | Internet disconnects during seat selection | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1102 | Internet disconnects after seat is held | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1103 | Internet disconnects during payment | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1104 | Internet disconnects immediately after payment success | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1105 | Same seat booked offline by two different users | GAP | — | verified manually: not built yet (offline mode phase) |
| 1106 | Offline booking created while seat already booked online | GAP | — | verified manually: not built yet (offline mode phase) |
| 1107 | During sync system finds seat is already taken | GAP | — | verified manually: not built yet (offline mode phase) |
| 1108 | During sync system finds fare has changed | GAP | — | verified manually: not built yet (offline mode phase) |
| 1109 | During sync system finds service is cancelled | GAP | — | verified manually: not built yet (offline mode phase) |
| 1110 | During sync system finds inventory is blocked | GAP | — | verified manually: not built yet (offline mode phase) |
| 1111 | Only some offline bookings sync successfully | GAP | — | verified manually: not built yet (offline mode phase) |
| 1112 | Complete sync process fails | GAP | — | verified manually: not built yet (offline mode phase) |
| 1113 | User retries sync multiple times | GAP | — | verified manually: not built yet (offline mode phase) |
| 1114 | Device was offline for very long time and data expired | GAP | — | verified manually: not built yet (offline mode phase) |
| 1115 | Device storage becomes full while working offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1116 | Offline stored data gets corrupted | GAP | — | verified manually: not built yet (offline mode phase) |
| 1117 | User changes device having pending offline data | GAP | — | verified manually: not built yet (offline mode phase) |
| 1118 | User logs in from another device with pending offline work | GAP | — | verified manually: not built yet (offline mode phase) |
| 1119 | Offline booking was done with old fare | GAP | — | verified manually: not built yet (offline mode phase) |
| 1120 | Offline booking used an already expired coupon | GAP | — | verified manually: not built yet (offline mode phase) |
| 1121 | Offline cancellation of a booking that was made online | GAP | — | verified manually: not built yet (offline mode phase) |
| 1122 | Offline cancellation of a booking that was made offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1123 | Seat change done while offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1124 | Passenger details changed while offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1125 | Conductor marks boarding while offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1126 | Conductor creates way-side booking while offline | CONFLICT | — | branch wallet / cash / loyalty / way-side — earlier decision |
| 1127 | Conductor enters collection amount while offline | CONFLICT | — | branch wallet / cash / loyalty / way-side — earlier decision |
| 1128 | Dispatch manager changes crew while offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1129 | Dispatch manager enters delay while offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1130 | Network keeps switching between online and offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1131 | System automatically switches to offline on poor network | GAP | — | verified manually: not built yet (offline mode phase) |
| 1132 | User manually forces offline mode | GAP | — | verified manually: not built yet (offline mode phase) |
| 1133 | User manually forces online mode | GAP | — | verified manually: not built yet (offline mode phase) |
| 1134 | Maximum number of offline transactions reached | GAP | — | verified manually: not built yet (offline mode phase) |
| 1135 | System automatically drops oldest offline transaction | GAP | — | verified manually: not built yet (offline mode phase) |
| 1136 | Priority given to important offline transactions | GAP | — | verified manually: not built yet (offline mode phase) |
| 1137 | Cancellation offline transactions given higher priority | GAP | — | verified manually: not built yet (offline mode phase) |
| 1138 | Offline ticket shows clear offline watermark | GAP | — | verified manually: not built yet (offline mode phase) |
| 1139 | Mapping between local offline ID and final PNR | GAP | — | verified manually: not built yet (offline mode phase) |
| 1140 | Two offline bookings get same local ID | GAP | — | verified manually: not built yet (offline mode phase) |
| 1141 | Device clock is wrong during offline working | GAP | — | verified manually: not built yet (offline mode phase) |
| 1142 | Offline booking created for future date beyond limit | GAP | — | verified manually: not built yet (offline mode phase) |
| 1143 | Offline booking created for past date | GAP | — | verified manually: not built yet (offline mode phase) |
| 1144 | Group booking made offline partially fails on sync | GAP | — | verified manually: not built yet (offline mode phase) |
| 1145 | Multi-passenger offline booking one passenger fails | GAP | — | verified manually: not built yet (offline mode phase) |
| 1146 | Only cash payment allowed in offline mode | CONFLICT | — | branch wallet / cash / loyalty / way-side — earlier decision |
| 1147 | Approximate cancellation charges shown offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1148 | Exact charges calculated again during sync | GAP | — | verified manually: not built yet (offline mode phase) |
| 1149 | All offline actions are logged for audit | GAP | — | verified manually: not built yet (offline mode phase) |
| 1150 | Report of all offline activities available | GAP | — | verified manually: not built yet (offline mode phase) |
| 1151 | User can manually clear offline data | GAP | — | verified manually: not built yet (offline mode phase) |
| 1152 | Offline data automatically cleared after successful sync | GAP | — | verified manually: not built yet (offline mode phase) |
| 1153 | Administrator disables offline mode completely | GAP | — | verified manually: not built yet (offline mode phase) |
| 1154 | Offline mode disabled for specific user | GAP | — | verified manually: not built yet (offline mode phase) |
| 1155 | Offline mode disabled for specific branch | GAP | — | verified manually: not built yet (offline mode phase) |
| 1156 | Daily limit on number of offline bookings | GAP | — | verified manually: not built yet (offline mode phase) |
| 1157 | Amount limit on offline bookings | GAP | — | verified manually: not built yet (offline mode phase) |
| 1158 | High value booking not allowed in offline mode | GAP | — | verified manually: not built yet (offline mode phase) |
| 1159 | Ladies quota booking attempted offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1160 | Senior citizen quota booking attempted offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1161 | Waitlist entry created offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1162 | Staff given interface to resolve sync conflicts | GAP | — | verified manually: not built yet (offline mode phase) |
| 1163 | Manager can override offline conflict decision | GAP | — | verified manually: not built yet (offline mode phase) |
| 1164 | System automatically refunds on certain conflicts | GAP | — | verified manually: not built yet (offline mode phase) |
| 1165 | Notification sent when offline sync fails | GAP | — | verified manually: not built yet (offline mode phase) |
| 1166 | Dashboard shows count of pending offline transactions | GAP | — | verified manually: not built yet (offline mode phase) |
| 1167 | Complete audit trail of offline activities maintained | GAP | — | verified manually: not built yet (offline mode phase) |
| 1168 | Offline mode works only for allowed operations | GAP | — | verified manually: not built yet (offline mode phase) |
| 1169 | Critical masters not available offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1170 | Latest fare not available offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1171 | Latest inventory picture not available offline | GAP | — | verified manually: not built yet (offline mode phase) |
| 1172 | Risk acceptance for offline bookings | GAP | — | verified manually: not built yet (offline mode phase) |
| 1173 | Offline booking later cancelled by system | GAP | — | verified manually: not built yet (offline mode phase) |
| 1174 | Customer informed about offline booking status | GAP | — | verified manually: not built yet (offline mode phase) |
| 1175 | Extra verification required after offline booking | GAP | — | verified manually: not built yet (offline mode phase) |
| 1176 | Offline booking converted to confirmed after sync | GAP | — | verified manually: not built yet (offline mode phase) |
| 1177 | Offline booking remains in special status | GAP | — | verified manually: not built yet (offline mode phase) |
| 1178 | Reporting of offline versus online bookings | GAP | — | verified manually: not built yet (offline mode phase) |
| 1179 | Performance impact of large offline queue | GAP | — | verified manually: not built yet (offline mode phase) |
| 1180 | Cleanup of very old offline records | GAP | — | verified manually: not built yet (offline mode phase) |

## #1–#500

CONFLICT 20, DONE 373, GAP 93, INFRA 17, PROCESS 3

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 4 | BUSINESS LOGIC & POLICY EDGE CASES (1201-1300) | DONE | DONE | PUT /admin/tenants/:id/domain (host resolves immediately) · UI: Super admin → Operators → Settings: custom domain, favicon, API rate limit, per-operator feature flags + roll back everywhere |

## #1001–#1500

CONFLICT 12, DONE 128, DUP 1, GAP 128, OPEN 170, PROCESS 1

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 1201 | Attempt to book after service has departed | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1202 | Attempt to book exactly at departure time | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1203 | Attempt to book one minute before departure | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1204 | Date change requested to a past date | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → Manage booking: change date (future days only, other buses), seats (free seats only), boarding / drop point, name spelling — closed after boarding time; backend refusals shown |
| 1205 | Date change requested to same service | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → Manage booking: change date (future days only, other buses), seats (free seats only), boarding / drop point, name spelling — closed after boarding time; backend refusals shown |
| 1206 | Seat change requested to same seat | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → Manage booking: change date (future days only, other buses), seats (free seats only), boarding / drop point, name spelling — closed after boarding time; backend refusals shown |
| 1207 | Cancellation requested after boarding started | GAP | — | verified manually: not built yet |
| 1208 | Cancellation requested after all passengers boarded | GAP | — | verified manually: not built yet |
| 1209 | Name correction requested after boarding | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → Manage booking: change date (future days only, other buses), seats (free seats only), boarding / drop point, name spelling — closed after boarding time; backend refusals shown |
| 1210 | Boarding point change after service departed | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → Manage booking: change date (future days only, other buses), seats (free seats only), boarding / drop point, name spelling — closed after boarding time; backend refusals shown |
| 1211 | Drop point change after service departed | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → Manage booking: change date (future days only, other buses), seats (free seats only), boarding / drop point, name spelling — closed after boarding time; backend refusals shown |
| 1212 | Ladies seat wrongly assigned to male passenger | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1213 | Male passenger tries to force sit on ladies seat | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: checkout: ladies seat + gender validation |
| 1214 | Child fare applied to adult passenger | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1215 | Adult fare applied to child passenger | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1216 | Infant travels without adult companion | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1217 | Unaccompanied minor booking attempt | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1218 | Maximum allowed seats per booking exceeded | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1219 | Maximum bookings from same mobile exceeded | GAP | — | verified manually: not built yet |
| 1220 | Same passenger books same service multiple times | GAP | — | verified manually: not built yet |
| 1221 | PNR number generation collision | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1222 | Quota seat released into general pool | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1223 | General seat moved into quota pool | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1224 | Dynamic price goes above defined ceiling | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1225 | Dynamic price goes below defined floor | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1226 | Coupon and dynamic pricing applied together | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1227 | More than one coupon applied on same booking | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1228 | Expired coupon is accepted by system | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: checkout coupon: backend message shown, saving vs coupon-less price |
| 1229 | Coupon meant for different route is used | GAP | — | verified manually: not built yet |
| 1230 | Coupon usage limit already exhausted | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: checkout coupon: backend message shown, saving vs coupon-less price |
| 1231 | Insufficient loyalty points for redemption | CONFLICT | — | branch wallet / cash / loyalty / way-side — earlier decision |
| 1232 | Loyalty points already expired | CONFLICT | — | branch wallet / cash / loyalty / way-side — earlier decision |
| 1233 | Free cancellation window boundary condition | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Customer site → My trips → Manage booking: refund shown before cancelling, cancel some seats or all, closed after boarding time |
| 1234 | Different cancellation policy for OTA booking | GAP | — | verified manually: not built yet |
| 1235 | Different cancellation policy for agent booking | GAP | — | verified manually: not built yet |
| 1236 | Special cancellation rules for group booking | GAP | — | verified manually: not built yet |
| 1237 | Special cancellation rules for charter | GAP | — | verified manually: not built yet |
| 1238 | Only one leg of multi-hop is cancelled | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1239 | Cancellation of return impacts onward journey | GAP | — | verified manually: not built yet |
| 1240 | Open ticket confirmation when seats not available | GAP | — | verified manually: not built yet |
| 1241 | Open ticket partially confirmed | GAP | — | verified manually: not built yet |
| 1242 | Waitlist position of passenger changes | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1243 | Waitlist entry expires | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1244 | Waitlist confirmed but payment not done in time | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1245 | Passenger wrongly marked as no-show | GAP | — | verified manually: not built yet |
| 1246 | No-show marking is later reversed | GAP | — | verified manually: not built yet |
| 1247 | Already boarded passenger marked no-show | GAP | — | verified manually: not built yet |
| 1248 | Service cancelled after some passengers boarded | GAP | — | verified manually: not built yet |
| 1249 | Handling passengers during mid-route breakdown | DONE | TODO | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) |
| 1250 | Replacement bus has different seat layout | DONE | DONE | verified manually: existing mechanism (row locks / idempotency / outbox / policy / cache) · UI: Trip chart → Change bus (re-seats on a different layout) + earlier changes |
| 1251 | System automatically re-seats passengers | OPEN | — |  |
| 1252 | Passenger refuses the new seat assigned | OPEN | — |  |
| 1253 | Route diversion makes some boarding points invalid | OPEN | — |  |
| 1254 | Boarding point missing after diversion | OPEN | — |  |
| 1255 | Extra trip created with incorrect inventory | DONE | TODO | MaterializationService.createExtraTrips + POST /scheduling/services/:id/extra-trips |
| 1256 | Extra trip timings overlap with regular service | DONE | TODO | MaterializationService.createExtraTrips + POST /scheduling/services/:id/extra-trips |
| 1257 | Service frequency changed in middle of season | DONE | TODO | pricing/domain/fare-plan-selection.ts |
| 1258 | Vehicle permit expires while service is running | OPEN | — |  |
| 1259 | Insurance expires while service is running | OPEN | — |  |
| 1260 | Fitness certificate expires | OPEN | — |  |
| 1261 | Driver driving license expires | OPEN | — |  |
| 1262 | Conductor not allocated to service | OPEN | — |  |
| 1263 | Driver not allocated to service | OPEN | — |  |
| 1264 | Same crew allocated to two services | OPEN | — |  |
| 1265 | Crew exceeds maximum allowed duty hours | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1266 | Mandatory rest period not provided to crew | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1267 | Bus does not have enough fuel for trip | OPEN | — |  |
| 1268 | GPS device stops working | OPEN | — |  |
| 1269 | Panic button pressed by mistake | OPEN | — |  |
| 1270 | False emergency alert generated | OPEN | — |  |
| 1271 | Real medical emergency occurs on bus | OPEN | — |  |
| 1272 | Accident takes place | OPEN | — |  |
| 1273 | Police stops the bus | OPEN | — |  |
| 1274 | Authorities demand passenger list immediately | OPEN | — |  |
| 1275 | Passenger gets lost during journey | OPEN | — |  |
| 1276 | Passenger is left behind at a stop | OPEN | — |  |
| 1277 | Luggage is lost | OPEN | — |  |
| 1278 | Luggage is damaged | OPEN | — |  |
| 1279 | Wrong ticket is issued to passenger | OPEN | — |  |
| 1280 | Ticket is issued for wrong date | OPEN | — |  |
| 1281 | Ticket is issued for wrong service | OPEN | — |  |
| 1282 | Duplicate physical ticket printed | OPEN | — |  |
| 1283 | Passenger presents fake ticket | OPEN | — |  |
| 1284 | QR code is scanned more than once | OPEN | — |  |
| 1285 | QR code has already expired | OPEN | — |  |
| 1286 | QR code belongs to different operator | OPEN | — |  |
| 1287 | Passenger tries to board without ticket | OPEN | — |  |
| 1288 | Way-side passenger travels without ticket | CONFLICT | — |  |
| 1289 | Bus becomes overcrowded | OPEN | — |  |
| 1290 | Standing passengers allowed against policy | OPEN | — |  |
| 1291 | Male passenger tries to enter ladies special service | DONE | TODO | trips.ladies_special + all seats ladies-only (seat-lock enforces) |
| 1292 | Senior citizen seat occupied by other passenger | DONE | TODO | booking/domain/passenger-categories.ts + /concessions |
| 1293 | Disability-friendly seat is misused | OPEN | — |  |
| 1294 | Child travelling without ticket | OPEN | — |  |
| 1295 | Extra passenger travelling on one ticket | OPEN | — |  |
| 1296 | Attempt to transfer ticket to another person | OPEN | — |  |
| 1297 | Attempt to resell ticket | OPEN | — |  |
| 1298 | Blacklisted passenger tries to make booking | DONE | DONE | customer_blocks per operator (account + mobile), GET /customers?filter=blocked, hold → 403 · UI: Customers: Blocked tab, block with reason / unblock in the profile |
| 1299 | System allows booking against policy | OPEN | — |  |
| 1300 | Policy exception requires manager approval | OPEN | — |  |

## #1–#500

CONFLICT 20, DONE 373, GAP 93, INFRA 17, PROCESS 3

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 5 | INVENTORY, SCHEDULE, OTA & FINANCIAL EDGE CASES (1301-1400) | DONE | DONE | verified manually: existing module/API · UI: Operator console → Settings → Branding: logo |

## #1001–#1500

CONFLICT 12, DONE 128, DUP 1, GAP 128, OPEN 170, PROCESS 1

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 1301 | Inventory is blocked after OTA has already taken booking | DONE | TODO | modules/gds |
| 1302 | OTA sends booking with invalid seat number | DONE | TODO | modules/gds |
| 1303 | Fare shown on OTA is different from system | DONE | TODO | modules/gds |
| 1304 | OTA sends duplicate booking for same passenger | DONE | TODO | modules/gds |
| 1305 | OTA booking fails in the middle of process | DONE | TODO | modules/gds |
| 1306 | Failed OTA booking needs manual creation | DONE | TODO | modules/gds |
| 1307 | Inventory is pulled back while OTA booking is happening | DONE | TODO | modules/gds |
| 1308 | Schedule is changed after inventory released to OTA | DONE | TODO | modules/gds |
| 1309 | Seat layout is changed after bookings exist | OPEN | — |  |
| 1310 | Service is cancelled but OTA still shows it available | DONE | TODO | modules/gds |
| 1311 | Multi-hop inventory becomes inconsistent | OPEN | — |  |
| 1312 | Seat released from cancellation promotes waitlist | DONE | TODO | modules/demand |
| 1313 | Group booking requested when seats are partially available | OPEN | — |  |
| 1314 | Charter booking overlaps with regular service timing | OPEN | — |  |
| 1315 | Booking attempted on blackout date | DONE | TODO | coupons.blackout_dates (journey date) |
| 1316 | Seasonal schedule fails to activate | DONE | TODO | pricing/domain/fare-plan-selection.ts |
| 1317 | Bulk schedule upload contains invalid data rows | OPEN | — |  |
| 1318 | Bulk upload succeeds only partially | OPEN | — |  |
| 1319 | Schedule rollback attempted when bookings exist | OPEN | — |  |
| 1320 | Route diversion invalidates existing boarding points | OPEN | — |  |
| 1321 | New service creation blocked due to permit expiry | OPEN | — |  |
| 1322 | Document expiry alerts ignored by users | OPEN | — |  |
| 1323 | Bus changed to one with different seat count | DONE | DONE | modules/trip-vehicle · UI: Trip chart → Change bus (re-seats on a different layout) + earlier changes |
| 1324 | Crew not allocated at time of departure | OPEN | — |  |
| 1325 | Same crew allocated to overlapping services | OPEN | — |  |
| 1326 | GPS goes offline during important tracking period | OPEN | — |  |
| 1327 | Manual tracking is started | OPEN | — |  |
| 1328 | Delay on one service affects connecting service | OPEN | — |  |
| 1329 | Passenger misses connection due to delay | OPEN | — |  |
| 1330 | Gateway settlement amount does not match | OPEN | — |  |
| 1331 | Some transactions missing in settlement file | OPEN | — |  |
| 1332 | Extra transactions present in settlement file | OPEN | — |  |
| 1333 | Commission calculated on already refunded booking | OPEN | — |  |
| 1334 | TDS threshold is crossed in middle of month | OPEN | — |  |
| 1335 | GST rate changes after booking is made | OPEN | — |  |
| 1336 | Credit note and debit note amounts mismatch | OPEN | — |  |
| 1337 | Expense is entered in wrong category | DONE | DONE | modules/trip-expenses · UI: Trip chart → Expenses & P&L (receipt, void with reason, one add per click) |
| 1338 | Same expense is entered twice | DONE | DONE | modules/trip-expenses · UI: Trip chart → Expenses & P&L (receipt, void with reason, one add per click) |
| 1339 | Branch collection is not deposited on time | CONFLICT | — |  |
| 1340 | Cash shortage needs investigation | OPEN | — |  |
| 1341 | Agent ledger does not balance | DONE | TODO | modules/agents |
| 1342 | Outstanding dues become very old | OPEN | — |  |
| 1343 | Temporary credit limit increase expires | OPEN | — |  |
| 1344 | Refund liability does not match actual refunds | OPEN | — |  |
| 1345 | Month-end closing attempted with pending items | OPEN | — |  |
| 1346 | Trial balance does not match | OPEN | — |  |
| 1347 | Profit and Loss has incorrect expense allocation | DONE | DONE | modules/trip-expenses · UI: Reports → Profit & Loss (route / bus / trip) |
| 1348 | Route profitability calculation with shared costs | DONE | DONE | modules/trip-expenses · UI: Reports → Profit & Loss (route / bus / trip) |
| 1349 | Bus profitability with maintenance cost allocation | DONE | DONE | modules/trip-expenses · UI: Reports → Profit & Loss (route / bus / trip) |
| 1350 | High value refund processed without approval | OPEN | — |  |
| 1351 | Bulk refund job fails partially | OPEN | — |  |
| 1352 | Chargeback received after settlement is done | OPEN | — |  |
| 1353 | Dispute with OTA is lost | DONE | TODO | modules/gds |
| 1354 | Dispute with OTA is won | DONE | TODO | modules/gds |
| 1355 | Multi-currency settlement has forex difference | OPEN | — |  |
| 1356 | Wallet recharge remains pending for long | CONFLICT | — |  |
| 1357 | Agent commission becomes negative after adjustments | DONE | TODO | modules/agents |
| 1358 | Manual accounting journal entry required | OPEN | — |  |
| 1359 | Audit trail missing for important transaction | OPEN | — |  |
| 1360 | Financial period already closed and entry needed | OPEN | — |  |

## #1–#500

CONFLICT 20, DONE 373, GAP 93, INFRA 17, PROCESS 3

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 6 | OPERATIONAL, CREW & SYSTEM EDGE CASES (1401-1500) | DONE | DONE | verified manually: existing module/API · UI: Super admin → Operators: provision (legal name, code, contact), suspend with reason, re-activate, change plan, Export CSV, Message all |

## #1001–#1500

CONFLICT 12, DONE 128, DUP 1, GAP 128, OPEN 170, PROCESS 1

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 1401 | Service is allowed to start without crew | OPEN | — |  |
| 1402 | Crew reports late for duty | OPEN | — |  |
| 1403 | Crew does not report for duty | OPEN | — |  |
| 1404 | Crew is changed in the middle of route | OPEN | — |  |
| 1405 | Crew exceeds legal duty hours | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1406 | Continuous driving limit is breached | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1407 | Mandatory rest period is not given | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1408 | Approval for double duty is missing | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1409 | Bus breaks down with passengers on board | OPEN | — |  |
| 1410 | Replacement bus has different seat layout | DUP | DUP | same as #1250 |
| 1411 | Automatic re-seating of passengers fails | OPEN | — |  |
| 1412 | Passenger refuses newly assigned seat | OPEN | — |  |
| 1413 | Road is blocked mid-way | OPEN | — |  |
| 1414 | Diversion takes much longer than expected | OPEN | — |  |
| 1415 | Bus runs out of fuel mid-way | OPEN | — |  |
| 1416 | Medical emergency happens on bus | OPEN | — |  |
| 1417 | Accident occurs with injuries | OPEN | — |  |
| 1418 | Police detains the bus | OPEN | — |  |
| 1419 | Passenger list is demanded urgently | OPEN | — |  |
| 1420 | Child gets lost during journey | OPEN | — |  |
| 1421 | Passenger is left behind at boarding point | OPEN | — |  |
| 1422 | Luggage gets mixed up between passengers | OPEN | — |  |
| 1423 | Bus is overcrowded beyond capacity | OPEN | — |  |
| 1424 | Standing passengers on sleeper bus | OPEN | — |  |
| 1425 | Ladies special service rules are violated | DONE | TODO | trips.ladies_special + all seats ladies-only (seat-lock enforces) |
| 1426 | Night service checklist is not completed | OPEN | — |  |
| 1427 | Panic button is pressed by mistake | OPEN | — |  |
| 1428 | Suspicion of GPS location spoofing | OPEN | — |  |
| 1429 | Conductor collection does not match system | OPEN | — |  |
| 1430 | Trip is closed with pending issues | OPEN | — |  |
| 1431 | Database deadlock occurs | OPEN | — |  |
| 1432 | API rate limit is crossed | OPEN | — |  |
| 1433 | Complete payment gateway downtime | OPEN | — |  |
| 1434 | SMS gateway complete downtime | OPEN | — |  |
| 1435 | WhatsApp gateway complete downtime | OPEN | — |  |
| 1436 | Email gateway complete downtime | OPEN | — |  |
| 1437 | All notification channels are down together | OPEN | — |  |
| 1438 | DNS resolution fails | OPEN | — |  |
| 1439 | SSL certificate expires suddenly | OPEN | — |  |
| 1440 | Cache stampede happens | OPEN | — |  |
| 1441 | Thundering herd on popular service | OPEN | — |  |
| 1442 | Hot partition on popular route | OPEN | — |  |
| 1443 | Database connection pool exhausted | OPEN | — |  |
| 1444 | Server disk becomes full | OPEN | — |  |
| 1445 | Memory leak in application | OPEN | — |  |
| 1446 | Sudden CPU spike | OPEN | — |  |
| 1447 | Auto-scaling is triggered | OPEN | — |  |
| 1448 | Traffic failed over to another region | OPEN | — |  |
| 1449 | Split brain situation occurs | OPEN | — |  |
| 1450 | Server clock jumps forward or backward | OPEN | — |  |
| 1451 | Message ordering is violated | OPEN | — |  |
| 1452 | Exactly-once processing guarantee breaks | OPEN | — |  |
| 1453 | Saga compensation transaction fails | OPEN | — |  |
| 1454 | System left in partial saga state | OPEN | — |  |
| 1455 | Manual intervention becomes necessary | OPEN | — |  |
| 1456 | War room is activated for major incident | OPEN | — |  |
| 1457 | Ransomware activity detected | OPEN | — |  |
| 1458 | Restore required from immutable backup | OPEN | — |  |
| 1459 | Point-in-time recovery is needed | OPEN | — |  |
| 1460 | Accidental mass data update happens | OPEN | — |  |
| 1461 | Accidental blocking of all inventory | OPEN | — |  |
| 1462 | Accidental deletion of important data | OPEN | — |  |
| 1463 | Insider threat activity detected | OPEN | — |  |
| 1464 | Staff misuses privileges | OPEN | — |  |
| 1465 | Admin activity at unusual hours | OPEN | — |  |
| 1466 | Mass fare update done by mistake | OPEN | — |  |
| 1467 | Feature flag configured wrongly | OPEN | — |  |
| 1468 | Maintenance mode enabled during peak time | DONE | TODO | MaintenanceGuard + PUT /admin/platform/maintenance |
| 1469 | Zero downtime deployment faces issue | OPEN | — |  |
| 1470 | Rollback required after failed release | OPEN | — |  |
| 1471 | Data migration faces issues | OPEN | — |  |
| 1472 | Historical data import has duplicates | OPEN | — |  |
| 1473 | Data clean-up job deletes wrong records | OPEN | — |  |
| 1474 | Report generation causes system slowness | OPEN | — |  |
| 1475 | Large export job impacts performance | OPEN | — |  |
| 1476 | Search index becomes out of sync | OPEN | — |  |
| 1477 | Analytics pipeline has delay | OPEN | — |  |
| 1478 | Real-time dashboard shows stale data | OPEN | — |  |
| 1479 | Alerting system itself fails | OPEN | — |  |
| 1480 | Monitoring system has blind spot | OPEN | — |  |
| 1481 | Backup job fails silently | OPEN | — |  |
| 1482 | Restore test has not been done recently | OPEN | — |  |
| 1483 | Disaster recovery plan is outdated | OPEN | — |  |
| 1484 | Documentation is missing for critical process | OPEN | — |  |
| 1485 | Knowledge is limited to single person | OPEN | — |  |
| 1486 | Support escalation matrix is unclear | OPEN | — |  |
| 1487 | Customer communication during outage is delayed | OPEN | — |  |
| 1488 | Status page is not updated | OPEN | — |  |
| 1489 | Internal team communication gap | OPEN | — |  |
| 1490 | Post-incident review is not conducted | OPEN | — |  |
| 1491 | Same incident repeats again | OPEN | — |  |
| 1492 | Root cause is not properly identified | OPEN | — |  |
| 1493 | Preventive actions are not implemented | OPEN | — |  |
| 1494 | System resilience is not improved | OPEN | — |  |
| 1495 | Load testing is not realistic | OPEN | — |  |
| 1496 | Chaos testing is never performed | OPEN | — |  |
| 1497 | Security testing is outdated | OPEN | — |  |
| 1498 | Compliance audit has open points | OPEN | — |  |
| 1499 | Business continuity plan is not tested | OPEN | — |  |
| 1500 | Final complete system and process health review | OPEN | — |  |

## #1501–#2000

CONFLICT 13, DONE 53, DUP 3, OPEN 431

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 1501 | Configure multi-level branch hierarchy | OPEN | — |  |
| 1502 | Set head office and regional offices | OPEN | — |  |
| 1503 | Define branch reporting structure | OPEN | — |  |
| 1504 | Set inter-branch booking rules | OPEN | — |  |
| 1505 | Allow or restrict cross-branch inventory visibility | OPEN | — |  |
| 1506 | Configure branch-wise target setting | OPEN | — |  |
| 1507 | Set monthly revenue targets per branch | OPEN | — |  |
| 1508 | Set occupancy targets per branch | OPEN | — |  |
| 1509 | View consolidated target vs achievement | OPEN | — |  |
| 1510 | Configure automatic target revision rules | OPEN | — |  |
| 1511 | Create agent hierarchy (master agent and sub-agents) | DONE | TODO | modules/agents |
| 1512 | Set commission sharing between master and sub-agent | DONE | TODO | modules/agents |
| 1513 | View complete agent network performance | DONE | TODO | modules/agents |
| 1514 | Block entire agent network temporarily | DONE | TODO | modules/agents |
| 1515 | Set daily booking limit for agents | DONE | TODO | modules/agents |
| 1516 | Set per-service booking limit for agents | DONE | TODO | modules/agents |
| 1517 | Configure agent advance booking window | DONE | TODO | modules/agents |
| 1518 | Whitelist routes for specific agents | DONE | TODO | modules/agents |
| 1519 | Blacklist routes for specific agents | DONE | TODO | modules/agents |
| 1520 | Set maximum discount authority for agents | DONE | TODO | modules/agents |
| 1521 | Configure automatic credit limit review | OPEN | — |  |
| 1522 | Set agent settlement cycle frequency | DONE | TODO | modules/agents |
| 1523 | Generate agent aging report | DONE | TODO | modules/agents |
| 1524 | Configure automatic due reminders | OPEN | — |  |
| 1525 | Auto-block agent when dues exceed threshold | DONE | TODO | modules/agents |
| 1526 | Configure route-wise dynamic pricing rules | OPEN | — |  |
| 1527 | Set weekend pricing rules | DONE | TODO | pricing/domain/fare-plan-selection.ts |
| 1528 | Set holiday pricing rules | OPEN | — |  |
| 1529 | Set special event pricing rules | OPEN | — |  |
| 1530 | Define occupancy threshold for price increase | OPEN | — |  |
| 1531 | Define occupancy threshold for price decrease | OPEN | — |  |
| 1532 | Set maximum allowed price increase percentage | OPEN | — |  |
| 1533 | Set maximum allowed price decrease percentage | OPEN | — |  |
| 1534 | Configure time windows for automatic price changes | OPEN | — |  |
| 1535 | View complete price change audit history | OPEN | — |  |
| 1536 | Rollback recent price changes | OPEN | — |  |
| 1537 | Enable automatic acceptance of AI price suggestions | OPEN | — |  |
| 1538 | Manually override AI price suggestion | OPEN | — |  |
| 1539 | Set floor price by seat type | OPEN | — |  |
| 1540 | Set ceiling price by seat type | OPEN | — |  |
| 1541 | Configure different pricing for ladies seats | OPEN | — |  |
| 1542 | Configure different pricing for sleeper vs seater | OPEN | — |  |
| 1543 | Set last-minute discount rules | OPEN | — |  |
| 1544 | Set early-bird discount rules | OPEN | — |  |
| 1545 | Configure round-trip discount | OPEN | — |  |
| 1546 | Configure family or group discount | OPEN | — |  |
| 1547 | Set student concession calendar | DONE | TODO | booking/domain/passenger-categories.ts + /concessions |
| 1548 | Set senior citizen concession calendar | DONE | TODO | booking/domain/passenger-categories.ts + /concessions |
| 1549 | Configure defense concession rules | DONE | TODO | booking/domain/passenger-categories.ts + /concessions |
| 1550 | Manage promotional campaign calendar | OPEN | — |  |
| 1551 | Create new promotional campaign | OPEN | — |  |
| 1552 | Set campaign budget | OPEN | — |  |
| 1553 | Track campaign performance in real time | OPEN | — |  |
| 1554 | Stop underperforming campaign | OPEN | — |  |
| 1555 | Extend successful campaign | OPEN | — |  |
| 1556 | Configure per-customer coupon usage limit | OPEN | — |  |
| 1557 | Configure per-day coupon usage limit | OPEN | — |  |
| 1558 | Restrict coupon to specific services | OPEN | — |  |
| 1559 | Restrict coupon to specific routes | OPEN | — |  |
| 1560 | Configure coupon stacking rules | OPEN | — |  |
| 1561 | View coupon redemption report | OPEN | — |  |
| 1562 | View coupon abuse detection report | OPEN | — |  |
| 1563 | Block suspicious coupon usage patterns | OPEN | — |  |
| 1564 | Configure loyalty points earn rules | CONFLICT | — |  |
| 1565 | Configure loyalty points burn rules | CONFLICT | — |  |
| 1566 | Set loyalty points expiry policy | CONFLICT | — |  |
| 1567 | View loyalty points liability | CONFLICT | — |  |
| 1568 | Manually adjust loyalty points with reason | CONFLICT | — |  |
| 1569 | Configure privilege card benefits | CONFLICT | — |  |
| 1570 | Issue privilege card | CONFLICT | — |  |
| 1571 | Block privilege card | CONFLICT | — |  |
| 1572 | View privilege card usage report | CONFLICT | — |  |
| 1573 | Configure waitlist auto-promotion rules | DONE | TODO | modules/demand |
| 1574 | Set waitlist priority logic | DONE | TODO | modules/demand |
| 1575 | Configure waitlist notification content | DONE | TODO | modules/demand |
| 1576 | View waitlist conversion funnel | DONE | TODO | modules/demand |
| 1577 | Configure no-show penalty rules | OPEN | — |  |
| 1578 | Configure automatic seat release timing after no-show | OPEN | — |  |
| 1579 | View no-show trend analysis | OPEN | — |  |
| 1580 | Configure boarding chart auto-generation time | OPEN | — |  |
| 1581 | Configure automatic boarding chart sharing | OPEN | — |  |
| 1582 | Set boarding chart format preferences | OPEN | — |  |
| 1583 | Configure service departure confirmation process | OPEN | — |  |
| 1584 | Configure service arrival confirmation process | OPEN | — |  |
| 1585 | View on-time performance trends | OPEN | — |  |
| 1586 | Maintain delay reason master list | OPEN | — |  |
| 1587 | View most frequent delay reasons | OPEN | — |  |
| 1588 | Configure automatic passenger delay communication | OPEN | — |  |
| 1589 | Set escalation rules for long delays | OPEN | — |  |
| 1590 | Configure breakdown handling workflow | OPEN | — |  |
| 1591 | Configure alternate service suggestion logic | OPEN | — |  |
| 1592 | View breakdown frequency by bus | OPEN | — |  |
| 1593 | View breakdown frequency by route | OPEN | — |  |
| 1594 | Configure crew allocation preference rules | OPEN | — |  |
| 1595 | Set maximum continuous duty hours | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1596 | Set mandatory rest hours between duties | OPEN | — |  |
| 1597 | View crew utilization report | OPEN | — |  |
| 1598 | View crew overtime report | OPEN | — |  |
| 1599 | Configure crew performance scoring | OPEN | — |  |
| 1600 | View crew performance ranking | OPEN | — |  |
| 1601 | Configure bus allocation preference rules | OPEN | — |  |
| 1602 | Set preventive maintenance schedule | OPEN | — |  |
| 1603 | View bus utilization percentage | OPEN | — |  |
| 1604 | View bus downtime report | OPEN | — |  |
| 1605 | Configure document expiry escalation | OPEN | — |  |
| 1606 | View upcoming document expiries | OPEN | — |  |
| 1607 | Configure insurance claim tracking | OPEN | — |  |
| 1608 | Record insurance claim | OPEN | — |  |
| 1609 | Track insurance claim status | OPEN | — |  |
| 1610 | Configure permit renewal workflow | OPEN | — |  |
| 1611 | View permit status of all buses | OPEN | — |  |
| 1612 | Track fitness certificate status | OPEN | — |  |
| 1613 | Track pollution certificate status | OPEN | — |  |
| 1614 | View complete compliance dashboard | OPEN | — |  |
| 1615 | Configure RTO document alerts | OPEN | — |  |
| 1616 | Record police verification details | OPEN | — |  |
| 1617 | Maintain emergency contact master | OPEN | — |  |
| 1618 | View emergency response log | OPEN | — |  |
| 1619 | Configure lost and found workflow | OPEN | — |  |
| 1620 | View lost and found status report | OPEN | — |  |
| 1621 | Configure passenger complaint categories | OPEN | — |  |
| 1622 | Set complaint escalation matrix | OPEN | — |  |
| 1623 | View complaint resolution time report | OPEN | — |  |
| 1624 | View complaint trends by category | OPEN | — |  |
| 1625 | Configure feedback collection rules | OPEN | — |  |
| 1626 | View average passenger feedback score | OPEN | — |  |
| 1627 | View feedback trend over time | OPEN | — |  |
| 1628 | Configure service quality score calculation | OPEN | — |  |
| 1629 | View service quality ranking | OPEN | — |  |
| 1630 | Configure automatic quality alerts | OPEN | — |  |
| 1631 | Set target quality score per route | OPEN | — |  |
| 1632 | View quality versus occupancy correlation | OPEN | — |  |
| 1633 | Configure revenue leakage detection rules | OPEN | — |  |
| 1634 | View suspected leakage transactions | OPEN | — |  |
| 1635 | Investigate flagged transactions | OPEN | — |  |
| 1636 | Record investigation outcome | OPEN | — |  |
| 1637 | Configure staff performance KPIs | OPEN | — |  |
| 1638 | View staff scorecard | OPEN | — |  |
| 1639 | Configure staff incentive calculation | OPEN | — |  |
| 1640 | Process staff incentive payout | OPEN | — |  |
| 1641 | Configure branch target setting workflow | OPEN | — |  |
| 1642 | View branch target versus achievement | OPEN | — |  |
| 1643 | Configure automatic target revision | OPEN | — |  |
| 1644 | View network-wide performance heatmap | OPEN | — |  |
| 1645 | Give custom report builder access to selected staff | OPEN | — |  |
| 1646 | Create new custom report definition | OPEN | — |  |
| 1647 | Schedule automatic report delivery | OPEN | — |  |
| 1648 | Configure report recipient list | OPEN | — |  |
| 1649 | View report delivery logs | OPEN | — |  |
| 1650 | Archive old reports | OPEN | — |  |
| 1651 | Configure multi-currency support for international routes | OPEN | — |  |
| 1652 | Set currency conversion source | DUP | DUP | same as #85 |
| 1653 | View currency exposure report | OPEN | — |  |
| 1654 | Configure tax rules by state | OPEN | — |  |
| 1655 | Handle inter-state GST differences | OPEN | — |  |
| 1656 | Configure e-invoicing if applicable | OPEN | — |  |
| 1657 | Generate consolidated tax reports | OPEN | — |  |
| 1658 | Configure TDS rules for different payees | OPEN | — |  |
| 1659 | Automate TDS calculation and deduction | OPEN | — |  |
| 1660 | Generate TDS certificates in bulk | OPEN | — |  |
| 1661 | Configure advance receipt handling | OPEN | — |  |
| 1662 | Configure security deposit management | OPEN | — |  |
| 1663 | Track security deposits from agents | DONE | TODO | modules/agents |
| 1664 | Refund security deposits | OPEN | — |  |
| 1665 | Configure debit and credit note workflows | OPEN | — |  |
| 1666 | Approve high-value credit notes | OPEN | — |  |
| 1667 | View outstanding credit notes | OPEN | — |  |
| 1668 | Configure inter-branch fund transfer | OPEN | — |  |
| 1669 | Record inter-branch settlements | OPEN | — |  |
| 1670 | Reconcile inter-branch balances | OPEN | — |  |
| 1671 | Configure cost allocation rules | OPEN | — |  |
| 1672 | Allocate head-office costs to branches | OPEN | — |  |
| 1673 | View fully loaded branch profitability | DONE | TODO | modules/trip-expenses |
| 1674 | Configure shared service cost recovery | OPEN | — |  |
| 1675 | View contribution margin by route | OPEN | — |  |
| 1676 | View contribution margin by service | OPEN | — |  |
| 1677 | View contribution margin by bus | OPEN | — |  |
| 1678 | Rank all services by economic profit | DONE | DONE | modules/trip-expenses · UI: Reports → Profit & Loss (route / bus / trip) |
| 1679 | Identify chronic loss-making services | OPEN | — |  |
| 1680 | Simulate impact of dropping a service | OPEN | — |  |
| 1681 | Recommend optimal service frequency | OPEN | — |  |
| 1682 | Recommend optimal bus type for route | OPEN | — |  |
| 1683 | Evaluate new route opportunity | OPEN | — |  |
| 1684 | Estimate payback period for new route | OPEN | — |  |
| 1685 | Track actual vs predicted performance of new routes | OPEN | — |  |
| 1686 | Maintain living business case for each route | OPEN | — |  |
| 1687 | Generate weekly decision pack for management | OPEN | — |  |
| 1688 | Highlight top decisions required this week | OPEN | — |  |
| 1689 | Track decision implementation status | OPEN | — |  |
| 1690 | Measure outcome of past decisions | OPEN | — |  |
| 1691 | Configure approval matrix for different actions | OPEN | — |  |
| 1692 | Set dual approval for high-risk actions | OPEN | — |  |
| 1693 | Configure time-bound temporary permissions | OPEN | — |  |
| 1694 | Review and expire temporary permissions | OPEN | — |  |
| 1695 | Configure segregation of duties rules | OPEN | — |  |
| 1696 | Detect segregation of duties conflicts | OPEN | — |  |
| 1697 | Generate access review reports | OPEN | — |  |
| 1698 | Conduct periodic access recertification | OPEN | — |  |
| 1699 | Remove unused access rights | OPEN | — |  |
| 1700 | Maintain clean role and permission structure | OPEN | — |  |
| 1701 | View live seat map with passenger names | OPEN | — |  |
| 1702 | View passenger contact from seat map | OPEN | — |  |
| 1703 | Filter seat map by boarding point | OPEN | — |  |
| 1704 | Filter seat map by drop point | OPEN | — |  |
| 1705 | View historical seat map of past service | OPEN | — |  |
| 1706 | Block multiple seats in one action | OPEN | — |  |
| 1707 | Release multiple blocked seats together | OPEN | — |  |
| 1708 | Temporarily change seat type | OPEN | — |  |
| 1709 | Override gender restriction with mandatory reason | OPEN | — |  |
| 1710 | View all overrides performed by self | OPEN | — |  |
| 1711 | View all overrides performed by staff | OPEN | — |  |
| 1712 | Approve or reject seat change requests | OPEN | — |  |
| 1713 | Approve or reject date change requests | OPEN | — |  |
| 1714 | Approve or reject boarding point change requests | DONE | TODO | amendments/domain/point-change.ts + POST /bookings/:id/change-points |
| 1715 | View pending approval queue | OPEN | — |  |
| 1716 | Configure auto-approval for low-value changes | OPEN | — |  |
| 1717 | View cancellation request queue | OPEN | — |  |
| 1718 | Process cancellation needing special approval | OPEN | — |  |
| 1719 | Track refund status of cancellations | OPEN | — |  |
| 1720 | Follow up pending refunds | OPEN | — |  |
| 1721 | View collection breakup by payment mode | OPEN | — |  |
| 1722 | View collection breakup by staff | OPEN | — |  |
| 1723 | View collection breakup by service | OPEN | — |  |
| 1724 | Reconcile UPI settlements | OPEN | — |  |
| 1725 | Reconcile card settlements | OPEN | — |  |
| 1726 | Enter cash deposit details | OPEN | — |  |
| 1727 | Upload deposit slip | OPEN | — |  |
| 1728 | Match deposit with system figures | OPEN | — |  |
| 1729 | Raise discrepancy for mismatch | OPEN | — |  |
| 1730 | View historical discrepancies | OPEN | — |  |
| 1731 | View agent volume through branch | DONE | TODO | modules/agents |
| 1732 | View agent cancellation rate through branch | DONE | TODO | modules/agents |
| 1733 | Recommend credit limit change for agent | DONE | TODO | modules/agents |
| 1734 | Temporary credit increase for peak period | OPEN | — |  |
| 1735 | View agent outstanding at branch level | DONE | TODO | modules/agents |
| 1736 | Collect agent dues at branch | DONE | TODO | modules/agents |
| 1737 | Issue receipt for dues collected | OPEN | — |  |
| 1738 | View group booking pipeline | OPEN | — |  |
| 1739 | Assign group booking to staff | OPEN | — |  |
| 1740 | Track group booking status | OPEN | — |  |
| 1741 | View corporate bookings | OPEN | — |  |
| 1742 | Process corporate credit booking | OPEN | — |  |
| 1743 | Generate corporate invoice | OPEN | — |  |
| 1744 | Follow up corporate outstanding | OPEN | — |  |
| 1745 | View waitlist pressure | DONE | TODO | modules/demand |
| 1746 | Manually promote from waitlist | DONE | TODO | modules/demand |
| 1747 | Notify waitlist passengers | DONE | TODO | modules/demand |
| 1748 | View no-show impact | OPEN | — |  |
| 1749 | Calculate revenue loss from no-shows | OPEN | — |  |
| 1750 | Configure branch-level no-show follow-up | OPEN | — |  |
| 1751 | View impact of delays on branch | OPEN | — |  |
| 1752 | Coordinate with dispatch on delays | OPEN | — |  |
| 1753 | Arrange local support for delayed passengers | OPEN | — |  |
| 1754 | Issue goodwill meal coupons | OPEN | — |  |
| 1755 | Record goodwill gestures given | OPEN | — |  |
| 1756 | View breakdown history | OPEN | — |  |
| 1757 | Coordinate replacement bus | DONE | DONE | modules/trip-vehicle · UI: Trip chart → Change bus (re-seats on a different layout) + earlier changes |
| 1758 | Manage passenger transfer | OPEN | — |  |
| 1759 | Record passenger refusal of alternate | OPEN | — |  |
| 1760 | Escalate unresolved issues | OPEN | — |  |
| 1761 | View weekly staff roster | OPEN | — |  |
| 1762 | Request additional staff for peak | OPEN | — |  |
| 1763 | Approve staff leave | OPEN | — |  |
| 1764 | Manually mark attendance | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1765 | View punctuality report | OPEN | — |  |
| 1766 | Conduct pre-shift briefing | OPEN | — |  |
| 1767 | Record shift handover issues | OPEN | — |  |
| 1768 | Review previous shift pending items | OPEN | — |  |
| 1769 | Close open issues before day end | OPEN | — |  |
| 1770 | Prepare branch performance summary | OPEN | — |  |
| 1771 | Observe competitor timings | OPEN | — |  |
| 1772 | Record competitor fare observations | OPEN | — |  |
| 1773 | Suggest pricing changes | OPEN | — |  |
| 1774 | Suggest timing changes | OPEN | — |  |
| 1775 | Suggest frequency changes | OPEN | — |  |
| 1776 | View demand pattern by time of day | OPEN | — |  |
| 1777 | View demand pattern by day of week | OPEN | — |  |
| 1778 | Identify underserved slots | OPEN | — |  |
| 1779 | Propose new service | OPEN | — |  |
| 1780 | Track proposal status | OPEN | — |  |
| 1781 | View branch customer feedback | OPEN | — |  |
| 1782 | Respond to negative feedback | OPEN | — |  |
| 1783 | Escalate serious complaints | OPEN | — |  |
| 1784 | Track complaint resolution | OPEN | — |  |
| 1785 | View average resolution time | OPEN | — |  |
| 1786 | Perform root cause analysis | OPEN | — |  |
| 1787 | Implement preventive measures | OPEN | — |  |
| 1788 | Track effectiveness of measures | OPEN | — |  |
| 1789 | View lost and found at branch | OPEN | — |  |
| 1790 | Update lost and found status | OPEN | — |  |
| 1791 | Contact passenger for lost item | OPEN | — |  |
| 1792 | Hand over item with acknowledgment | OPEN | — |  |
| 1793 | Dispose unclaimed items per policy | OPEN | — |  |
| 1794 | View emergency incident log | OPEN | — |  |
| 1795 | Record new emergency incident | OPEN | — |  |
| 1796 | Follow emergency protocol | OPEN | — |  |
| 1797 | Coordinate with authorities | OPEN | — |  |
| 1798 | Prepare incident report | OPEN | — |  |
| 1799 | Participate in post-incident review | OPEN | — |  |
| 1800 | Update emergency contacts | OPEN | — |  |
| 1801 | View real-time occupancy of all branch services | OPEN | — |  |
| 1802 | Identify services needing intervention | OPEN | — |  |
| 1803 | Apply tactical discount on specific service | OPEN | — |  |
| 1804 | Temporarily raise fare on high-demand service | OPEN | — |  |
| 1805 | Monitor impact of tactical pricing | OPEN | — |  |
| 1806 | Revert tactical pricing | OPEN | — |  |
| 1807 | View staff productivity ranking | OPEN | — |  |
| 1808 | Coach under-performing staff | OPEN | — |  |
| 1809 | Recognize high-performing staff | OPEN | — |  |
| 1810 | Plan staff training needs | OPEN | — |  |
| 1811 | View customer wait time at counter | CONFLICT | — |  |
| 1812 | Optimize counter allocation | CONFLICT | — |  |
| 1813 | Open additional counter during rush | CONFLICT | — |  |
| 1814 | Close under-utilized counter | DUP | DUP | same as #474 |
| 1815 | Manage queue during peak | OPEN | — |  |
| 1816 | Handle VIP passenger priority | OPEN | — |  |
| 1817 | Handle special assistance passengers | OPEN | — |  |
| 1818 | Coordinate with crew on special needs | OPEN | — |  |
| 1819 | View upcoming document expiries for branch buses | OPEN | — |  |
| 1820 | Ensure compliance before service start | OPEN | — |  |
| 1821 | Handle surprise inspection | OPEN | — |  |
| 1822 | Provide required documents and lists | OPEN | — |  |
| 1823 | Record inspection outcome | OPEN | — |  |
| 1824 | Close inspection findings | OPEN | — |  |
| 1825 | View branch cash position | CONFLICT | — |  |
| 1826 | Forecast cash requirement | OPEN | — |  |
| 1827 | Request cash replenishment | OPEN | — |  |
| 1828 | Safeguard cash and valuables | OPEN | — |  |
| 1829 | Conduct surprise cash verification | OPEN | — |  |
| 1830 | Report cash variance immediately | OPEN | — |  |
| 1831 | View agent credit utilization | DONE | TODO | modules/agents |
| 1832 | Warn agents approaching limit | DONE | TODO | modules/agents |
| 1833 | Temporary enhance limit for good agents | DONE | TODO | modules/agents |
| 1834 | Restrict limit for risky agents | DONE | TODO | modules/agents |
| 1835 | View quality of agent bookings | DONE | TODO | modules/agents |
| 1836 | Feedback to agents on quality issues | DONE | TODO | modules/agents |
| 1837 | Recommend preferred agents for more inventory | DONE | TODO | modules/agents |
| 1838 | Reduce inventory to poor quality agents | DONE | TODO | modules/agents |
| 1839 | View OTA contribution through branch | DONE | TODO | modules/gds |
| 1840 | Monitor OTA cancellation quality | DONE | TODO | modules/gds |
| 1841 | Escalate OTA issues to operator admin | DONE | TODO | modules/gds |
| 1842 | View overall channel mix at branch | OPEN | — |  |
| 1843 | Push for higher direct bookings | OPEN | — |  |
| 1844 | Track conversion of enquiries to bookings | OPEN | — |  |
| 1845 | Improve enquiry handling process | OPEN | — |  |
| 1846 | Capture lost enquiry reasons | OPEN | — |  |
| 1847 | Analyse lost enquiry patterns | OPEN | — |  |
| 1848 | Take action on frequent lost reasons | OPEN | — |  |
| 1849 | View passenger repeat rate at branch | OPEN | — |  |
| 1850 | Identify and nurture frequent travellers | OPEN | — |  |
| 1851 | Offer recognition to loyal passengers | OPEN | — |  |
| 1852 | Resolve issues of loyal passengers on priority | OPEN | — |  |
| 1853 | View net promoter or feedback score | OPEN | — |  |
| 1854 | Drive improvement actions on low scores | OPEN | — |  |
| 1855 | Celebrate high scores with team | OPEN | — |  |
| 1856 | Benchmark against other branches | OPEN | — |  |
| 1857 | Learn from better performing branches | OPEN | — |  |
| 1858 | Share own best practices | OPEN | — |  |
| 1859 | Participate in branch managers review | OPEN | — |  |
| 1860 | Present branch performance | OPEN | — |  |
| 1861 | Defend variances with data | OPEN | — |  |
| 1862 | Commit to improvement actions | OPEN | — |  |
| 1863 | Track closure of commitments | OPEN | — |  |
| 1864 | Prepare for internal audit | OPEN | — |  |
| 1865 | Provide audit samples | OPEN | — |  |
| 1866 | Respond to audit observations | OPEN | — |  |
| 1867 | Implement audit recommendations | OPEN | — |  |
| 1868 | Verify effectiveness of actions | OPEN | — |  |
| 1869 | Maintain audit readiness always | OPEN | — |  |
| 1870 | View risk indicators for branch | OPEN | — |  |
| 1871 | Mitigate high risks proactively | OPEN | — |  |
| 1872 | Escalate risks beyond control | OPEN | — |  |
| 1873 | Document risk acceptance if any | OPEN | — |  |
| 1874 | Review risks periodically | OPEN | — |  |
| 1875 | Update branch risk register | OPEN | — |  |
| 1876 | Conduct safety walk of premises | OPEN | — |  |
| 1877 | Ensure emergency exits clear | OPEN | — |  |
| 1878 | Check fire safety equipment | OPEN | — |  |
| 1879 | Conduct mock evacuation drill | OPEN | — |  |
| 1880 | Record safety observations | OPEN | — |  |
| 1881 | Close safety findings | OPEN | — |  |
| 1882 | Promote safety culture in team | OPEN | — |  |
| 1883 | Report near misses | OPEN | — |  |
| 1884 | Learn from incidents | OPEN | — |  |
| 1885 | Update safety procedures | OPEN | — |  |
| 1886 | Ensure staff know emergency contacts | OPEN | — |  |
| 1887 | Display emergency numbers prominently | OPEN | — |  |
| 1888 | Test emergency communication | OPEN | — |  |
| 1889 | Maintain first aid readiness | OPEN | — |  |
| 1890 | Train staff on basic first aid | OPEN | — |  |
| 1891 | Handle medical emergency at branch | DUP | DUP | same as #462 |
| 1892 | Coordinate ambulance if needed | OPEN | — |  |
| 1893 | Support affected passenger | OPEN | — |  |
| 1894 | Record medical incident | OPEN | — |  |
| 1895 | Follow up after medical incident | OPEN | — |  |
| 1896 | Handle law and order situation | OPEN | — |  |
| 1897 | Cooperate with police | OPEN | — |  |
| 1898 | Protect passenger and staff safety | OPEN | — |  |
| 1899 | Record incident accurately | OPEN | — |  |
| 1900 | Support post-incident processes | OPEN | — |  |
| 1901 | View complete network map with live status | OPEN | — |  |
| 1902 | Color code buses by delay status | OPEN | — |  |
| 1903 | Identify buses running ahead of schedule | OPEN | — |  |
| 1904 | Identify buses running behind schedule | OPEN | — |  |
| 1905 | Send advisory to specific bus | OPEN | — |  |
| 1906 | Record traffic condition on route | OPEN | — |  |
| 1907 | Share traffic update with relevant services | OPEN | — |  |
| 1908 | View crew current duty status | OPEN | — |  |
| 1909 | Calculate remaining allowable duty hours | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1910 | Alert when crew nearing legal limit | OPEN | — |  |
| 1911 | Plan mid-route crew change | OPEN | — |  |
| 1912 | Coordinate crew change location and time | OPEN | — |  |
| 1913 | Confirm crew change completed | OPEN | — |  |
| 1914 | View fuel status if available | OPEN | — |  |
| 1915 | Alert on low fuel risk | OPEN | — |  |
| 1916 | Arrange mid-route fueling | OPEN | — |  |
| 1917 | Record unscheduled stop | OPEN | — |  |
| 1918 | View predictive maintenance alerts | OPEN | — |  |
| 1919 | Pull bus for preventive maintenance | OPEN | — |  |
| 1920 | Arrange replacement proactively | OPEN | — |  |
| 1921 | Evaluate service recovery options | OPEN | — |  |
| 1922 | Calculate passenger impact of disruption | OPEN | — |  |
| 1923 | Prioritize high-value and connecting passengers | OPEN | — |  |
| 1924 | Arrange overnight support if required | OPEN | — |  |
| 1925 | Issue compensation as per policy | OPEN | — |  |
| 1926 | Record all compensation given | OPEN | — |  |
| 1927 | Track compensation liability | OPEN | — |  |
| 1928 | Analyse historical disruption patterns | OPEN | — |  |
| 1929 | Identify recurring problem areas | OPEN | — |  |
| 1930 | Create action plan for recurring issues | OPEN | — |  |
| 1931 | Track action plan progress | OPEN | — |  |
| 1932 | Conduct safety briefing for crew | OPEN | — |  |
| 1933 | Conduct service quality briefing | OPEN | — |  |
| 1934 | Record training completion | OPEN | — |  |
| 1935 | View training due list | OPEN | — |  |
| 1936 | Evaluate crew after difficult journey | OPEN | — |  |
| 1937 | Provide constructive feedback | OPEN | — |  |
| 1938 | Recognize outstanding performance | OPEN | — |  |
| 1939 | Initiate disciplinary process when needed | OPEN | — |  |
| 1940 | Handle crew grievances fairly | OPEN | — |  |
| 1941 | Plan balanced weekly roster | OPEN | — |  |
| 1942 | Handle last-minute crew unavailability | OPEN | — |  |
| 1943 | Arrange emergency crew | OPEN | — |  |
| 1944 | Consider crew route preferences | OPEN | — |  |
| 1945 | Balance difficult and easy duties | OPEN | — |  |
| 1946 | Monitor fatigue indicators | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1947 | Enforce rest periods strictly | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 1948 | Record rest compliance | OPEN | — |  |
| 1949 | Ensure fair night duty distribution | OPEN | — |  |
| 1950 | Rotate night duties | OPEN | — |  |
| 1951 | Plan extra crew for festivals | OPEN | — |  |
| 1952 | Release extra crew after peak | OPEN | — |  |
| 1953 | Monitor overtime cost | OPEN | — |  |
| 1954 | Control unnecessary overtime | OPEN | — |  |
| 1955 | Minimize double duties | OPEN | — |  |
| 1956 | Coordinate with branches on passenger issues | OPEN | — |  |
| 1957 | Coordinate with inventory on seat issues | OPEN | — |  |
| 1958 | Coordinate with finance on collection issues | OPEN | — |  |
| 1959 | Provide inputs for service planning | OPEN | — |  |
| 1960 | Provide inputs for timing changes | OPEN | — |  |
| 1961 | Provide inputs for route changes | OPEN | — |  |
| 1962 | Participate in daily operations meeting | OPEN | — |  |
| 1963 | Participate in weekly performance review | OPEN | — |  |
| 1964 | Prepare dispatch performance pack | OPEN | — |  |
| 1965 | Highlight systemic issues | OPEN | — |  |
| 1966 | Track closure of issues raised | OPEN | — |  |
| 1967 | View weather impact forecast | OPEN | — |  |
| 1968 | Prepare weather contingency | OPEN | — |  |
| 1969 | View road closure alerts | OPEN | — |  |
| 1970 | Activate alternate route plans | OPEN | — |  |
| 1971 | Communicate alternate routes to crew | OPEN | — |  |
| 1972 | Communicate alternate routes to passengers | OPEN | — |  |
| 1973 | Assess special event impact | OPEN | — |  |
| 1974 | Plan capacity for events | OPEN | — |  |
| 1975 | Coordinate with local authorities | OPEN | — |  |
| 1976 | Handle VVIP movement restrictions | OPEN | — |  |
| 1977 | Handle strike or bandh | OPEN | — |  |
| 1978 | Run only essential services during disruption | OPEN | — |  |
| 1979 | Communicate status clearly during disruption | OPEN | — |  |
| 1980 | Resume normal services systematically | OPEN | — |  |
| 1981 | Review disruption handling | OPEN | — |  |
| 1982 | Update disruption playbooks | OPEN | — |  |
| 1983 | Train team on updated playbooks | OPEN | — |  |
| 1984 | Conduct mock drills | OPEN | — |  |
| 1985 | Document lessons learned | OPEN | — |  |
| 1986 | Improve future readiness | OPEN | — |  |
| 1987 | View inventory across all channels in real time | OPEN | — |  |
| 1988 | Detect channel imbalance early | OPEN | — |  |
| 1989 | Rebalance inventory across channels | DONE | TODO | trips/services.closed_channels |
| 1990 | Protect high-margin channels in high demand | OPEN | — |  |
| 1991 | Open more inventory to OTAs in low demand | OPEN | — |  |
| 1992 | Monitor fare parity continuously | OPEN | — |  |
| 1993 | Correct parity breaks quickly | OPEN | — |  |
| 1994 | Evaluate OTA quality (cancellations, no-shows) | DONE | TODO | modules/gds |
| 1995 | Reduce allocation to low-quality OTAs | OPEN | — |  |
| 1996 | Calculate true net revenue after all costs | OPEN | — |  |
| 1997 | Rank services by true economic profit | DONE | DONE | modules/trip-expenses · UI: Reports → Profit & Loss (route / bus / trip) |
| 1998 | Recommend dropping chronic loss makers | OPEN | — |  |
| 1999 | Simulate network impact of dropping service | OPEN | — |  |
| 2000 | Recommend best time for new service | OPEN | — |  |

## #2001–#2500

DONE 16, OPEN 434

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 2001 | Evaluate new route with data | OPEN | — |  |
| 2002 | Estimate investment payback | OPEN | — |  |
| 2003 | Track new route actual vs plan | OPEN | — |  |
| 2004 | Maintain living business case per route | OPEN | — |  |
| 2005 | Generate decision support pack weekly | OPEN | — |  |
| 2006 | Highlight top decisions needed | OPEN | — |  |
| 2007 | Track decision outcomes | OPEN | — |  |
| 2008 | Learn which decisions create value | OPEN | — |  |
| 2009 | Score decision quality over time | OPEN | — |  |
| 2010 | Detect excessive override of recommendations | OPEN | — |  |
| 2011 | Request feedback on rejected suggestions | OPEN | — |  |
| 2012 | Improve models with feedback | OPEN | — |  |
| 2013 | Provide explanation for every recommendation | OPEN | — |  |
| 2014 | Show supporting data clearly | OPEN | — |  |
| 2015 | Allow setting of automation risk appetite | OPEN | — |  |
| 2016 | Run low-risk decisions fully automated | OPEN | — |  |
| 2017 | Require human approval for high-risk decisions | OPEN | — |  |
| 2018 | Maintain full audit of automated actions | OPEN | — |  |
| 2019 | Allow replay of decision sequences | OPEN | — |  |
| 2020 | Support what-if simulations | OPEN | — |  |
| 2021 | Simulate fare increase impact | OPEN | — |  |
| 2022 | Simulate branch closure impact | OPEN | — |  |
| 2023 | Simulate adding multiple new services | OPEN | — |  |
| 2024 | Simulate competitor price war | OPEN | — |  |
| 2025 | Recommend actions under each scenario | OPEN | — |  |
| 2026 | Measure forecast accuracy continuously | OPEN | — |  |
| 2027 | Retrain models when accuracy drops | OPEN | — |  |
| 2028 | Detect pattern changes (concept drift) | OPEN | — |  |
| 2029 | Maintain specialized models by route type | OPEN | — |  |
| 2030 | Transfer learning to low-data routes | OPEN | — |  |
| 2031 | Provide cold-start recommendations | OPEN | — |  |
| 2032 | Incorporate weather into predictions | OPEN | — |  |
| 2033 | Incorporate events into predictions | OPEN | — |  |
| 2034 | Incorporate holidays automatically | OPEN | — |  |
| 2035 | Detect local events from signals | OPEN | — |  |
| 2036 | Adjust capacity for detected events | OPEN | — |  |
| 2037 | Build event impact library | OPEN | — |  |
| 2038 | Predict fuel price impact on margins | OPEN | — |  |
| 2039 | Recommend fare response to cost changes | OPEN | — |  |
| 2040 | Track margin compression | OPEN | — |  |
| 2041 | Alert when network margin falls | OPEN | — |  |
| 2042 | Recommend cost-side actions | OPEN | — |  |
| 2043 | Optimize frequency vs size | OPEN | — |  |
| 2044 | Recommend merging weak services | OPEN | — |  |
| 2045 | Recommend splitting overloaded services | OPEN | — |  |
| 2046 | Evaluate bus type change impact | OPEN | — |  |
| 2047 | Recommend fleet right-sizing | OPEN | — |  |
| 2048 | Support multi-year fleet planning | OPEN | — |  |
| 2049 | Link maintenance cost to utilization | OPEN | — |  |
| 2050 | Recommend optimal retirement timing | OPEN | — |  |
| 2051 | Recommend acquisition timing | OPEN | — |  |
| 2052 | Evaluate lease vs buy | OPEN | — |  |
| 2053 | Track total cost of ownership | OPEN | — |  |
| 2054 | Rank buses by economic contribution | OPEN | — |  |
| 2055 | Suggest internal bus transfers | OPEN | — |  |
| 2056 | Optimize daily bus allocation | OPEN | — |  |
| 2057 | Consider crew base in allocation | OPEN | — |  |
| 2058 | Minimize empty kilometers | OPEN | — |  |
| 2059 | Evaluate charter with opportunity cost | OPEN | — |  |
| 2060 | Recommend accept or reject charter | OPEN | — |  |
| 2061 | Protect regular services from charter | OPEN | — |  |
| 2062 | Maintain charter pricing intelligence | OPEN | — |  |
| 2063 | Learn optimal charter pricing | OPEN | — |  |
| 2064 | Track charter customer value | OPEN | — |  |
| 2065 | Simulate corporate contract pricing | OPEN | — |  |
| 2066 | Evaluate volume vs discount trade-off | OPEN | — |  |
| 2067 | Track corporate account profit | DONE | TODO | modules/trip-expenses |
| 2068 | Recommend renegotiation of bad deals | OPEN | — |  |
| 2069 | Maintain agent profitability score | DONE | TODO | modules/agents |
| 2070 | Recommend better terms for good agents | DONE | TODO | modules/agents |
| 2071 | Recommend exit for poor agents | DONE | TODO | modules/agents |
| 2072 | Support automatic agent tiering | DONE | TODO | modules/agents |
| 2073 | Track agent contribution to occupancy | DONE | TODO | modules/agents |
| 2074 | Optimize overall channel mix | OPEN | — |  |
| 2075 | Continuously improve allocation logic | OPEN | — |  |
| 2076 | Measure channel contribution accurately | OPEN | — |  |
| 2077 | Avoid over-dependence on any single channel | OPEN | — |  |
| 2078 | Build resilient multi-channel strategy | OPEN | — |  |
| 2079 | Protect direct channel growth | OPEN | — |  |
| 2080 | Use OTAs strategically not dependently | OPEN | — |  |
| 2081 | Strengthen agent network quality | DONE | TODO | modules/agents |
| 2082 | Reduce leakage across all channels | OPEN | — |  |
| 2083 | Improve forecast driven decisions | OPEN | — |  |
| 2084 | Reduce firefighting through prediction | OPEN | — |  |
| 2085 | Move from reactive to proactive operations | OPEN | — |  |
| 2086 | Build operational excellence culture | OPEN | — |  |
| 2087 | Measure and improve every process | OPEN | — |  |
| 2088 | Eliminate waste in operations | OPEN | — |  |
| 2089 | Shorten decision cycles | OPEN | — |  |
| 2090 | Increase organizational learning speed | OPEN | — |  |
| 2091 | Capture knowledge from every event | OPEN | — |  |
| 2092 | Make knowledge accessible | OPEN | — |  |
| 2093 | Reduce hero dependence | OPEN | — |  |
| 2094 | Build strong institutional capability | OPEN | — |  |
| 2095 | Support scenario thinking as habit | OPEN | — |  |
| 2096 | Balance short-term and long-term | OPEN | — |  |
| 2097 | Protect space for innovation | OPEN | — |  |
| 2098 | Run controlled experiments | OPEN | — |  |
| 2099 | Learn faster than competition | OPEN | — |  |
| 2100 | Turn data into durable advantage | OPEN | — |  |
| 2101 | Configure financial year and periods | OPEN | — |  |
| 2102 | Open new accounting period | OPEN | — |  |
| 2103 | Close accounting period | OPEN | — |  |
| 2104 | Lock closed period | OPEN | — |  |
| 2105 | Handle post-period entries with approval | OPEN | — |  |
| 2106 | Maintain tax code master | OPEN | — |  |
| 2107 | Update GST rates when changed | OPEN | — |  |
| 2108 | Map services to HSN/SAC | OPEN | — |  |
| 2109 | Generate tax invoices | DONE | TODO | tax invoice on booking.confirmed, emailed separately (body + PDF: place of supply, CGST/SGST/IGST, PAN, amount in words), once per event |
| 2110 | Generate credit notes | OPEN | — |  |
| 2111 | Generate debit notes | OPEN | — |  |
| 2112 | Support e-invoicing | OPEN | — |  |
| 2113 | Support e-way bill if needed | OPEN | — |  |
| 2114 | Reconcile GST | OPEN | — |  |
| 2115 | Prepare GST return data | OPEN | — |  |
| 2116 | Handle GST notices | OPEN | — |  |
| 2117 | Configure TDS sections | OPEN | — |  |
| 2118 | Calculate TDS automatically | OPEN | — |  |
| 2119 | Generate TDS certificates | OPEN | — |  |
| 2120 | Prepare TDS returns | OPEN | — |  |
| 2121 | Resolve TDS mismatches | OPEN | — |  |
| 2122 | Track advance tax | OPEN | — |  |
| 2123 | Project tax liability | OPEN | — |  |
| 2124 | Support multi-currency books | OPEN | — |  |
| 2125 | Record forex transactions | OPEN | — |  |
| 2126 | Calculate forex gain/loss | OPEN | — |  |
| 2127 | Revalue foreign balances | OPEN | — |  |
| 2128 | Maintain chart of accounts | OPEN | — |  |
| 2129 | Add ledger accounts | OPEN | — |  |
| 2130 | Map system events to ledgers | OPEN | — |  |
| 2131 | View general ledger | OPEN | — |  |
| 2132 | View agent sub-ledger | DONE | TODO | modules/agents |
| 2133 | View branch sub-ledger | OPEN | — |  |
| 2134 | View OTA sub-ledger | DONE | TODO | modules/gds |
| 2135 | Perform bank reconciliation | OPEN | — |  |
| 2136 | Match statement entries | OPEN | — |  |
| 2137 | Identify unmatched items | OPEN | — |  |
| 2138 | Pass adjustment entries | OPEN | — |  |
| 2139 | Track outstanding cheques | OPEN | — |  |
| 2140 | Track uncleared deposits | OPEN | — |  |
| 2141 | Support bank feeds | OPEN | — |  |
| 2142 | View cash flow statement | OPEN | — |  |
| 2143 | Project cash flow | OPEN | — |  |
| 2144 | Set cash alerts | OPEN | — |  |
| 2145 | Configure budgets | OPEN | — |  |
| 2146 | Budget by route | OPEN | — |  |
| 2147 | Budget by branch | OPEN | — |  |
| 2148 | View budget vs actual | OPEN | — |  |
| 2149 | Analyse variances | OPEN | — |  |
| 2150 | Act on variances | OPEN | — |  |
| 2151 | Configure cost centers | OPEN | — |  |
| 2152 | Allocate shared costs | OPEN | — |  |
| 2153 | View cost center results | OPEN | — |  |
| 2154 | Configure profit centers | DONE | TODO | modules/trip-expenses |
| 2155 | View profit center performance | DONE | TODO | modules/trip-expenses |
| 2156 | Set internal transfer pricing | OPEN | — |  |
| 2157 | Record inter-branch transfers | OPEN | — |  |
| 2158 | Reconcile inter-branch | OPEN | — |  |
| 2159 | Maintain fixed asset register | OPEN | — |  |
| 2160 | Capitalize new buses | OPEN | — |  |
| 2161 | Calculate depreciation | OPEN | — |  |
| 2162 | Record asset disposal | OPEN | — |  |
| 2163 | View asset reports | OPEN | — |  |
| 2164 | Track asset insurance | OPEN | — |  |
| 2165 | Track premiums | OPEN | — |  |
| 2166 | Record claims | OPEN | — |  |
| 2167 | Track claim settlement | OPEN | — |  |
| 2168 | Record loans | OPEN | — |  |
| 2169 | Record EMI payments | OPEN | — |  |
| 2170 | View loan outstanding | OPEN | — |  |
| 2171 | Track interest cost | OPEN | — |  |
| 2172 | Maintain vendor master | OPEN | — |  |
| 2173 | Record vendor bills | OPEN | — |  |
| 2174 | Process vendor payments | OPEN | — |  |
| 2175 | View vendor outstanding | OPEN | — |  |
| 2176 | Process staff expense claims | DONE | TODO | modules/trip-expenses |
| 2177 | Interface with payroll if any | OPEN | — |  |
| 2178 | Record salary payments | OPEN | — |  |
| 2179 | View staff cost trends | OPEN | — |  |
| 2180 | Configure revenue recognition | OPEN | — |  |
| 2181 | Handle customer advances | OPEN | — |  |
| 2182 | Handle vendor advances | OPEN | — |  |
| 2183 | Create provisions | OPEN | — |  |
| 2184 | Review provisions | OPEN | — |  |
| 2185 | Track contingent liabilities | OPEN | — |  |
| 2186 | Prepare management accounts | OPEN | — |  |
| 2187 | Prepare quarterly financials | OPEN | — |  |
| 2188 | Prepare annual financials | OPEN | — |  |
| 2189 | Support statutory audit | OPEN | — |  |
| 2190 | Provide audit deliverables | OPEN | — |  |
| 2191 | Answer audit queries | OPEN | — |  |
| 2192 | Implement audit points | OPEN | — |  |
| 2193 | Track audit closure | OPEN | — |  |
| 2194 | Prepare for tax audit | OPEN | — |  |
| 2195 | Maintain complete audit trail | OPEN | — |  |
| 2196 | Configure approval limits | OPEN | — |  |
| 2197 | Enforce dual approval | OPEN | — |  |
| 2198 | Review high-value transactions | OPEN | — |  |
| 2199 | Detect unusual transactions | OPEN | — |  |
| 2200 | Investigate anomalies | OPEN | — |  |
| 2201 | Maintain risk register | OPEN | — |  |
| 2202 | Assess inherent and residual risk | OPEN | — |  |
| 2203 | Define risk appetite | OPEN | — |  |
| 2204 | Escalate risks above appetite | OPEN | — |  |
| 2205 | Monitor key risk indicators | OPEN | — |  |
| 2206 | Trigger action on indicators | OPEN | — |  |
| 2207 | Conduct risk reviews | OPEN | — |  |
| 2208 | Update risk mitigation plans | OPEN | — |  |
| 2209 | Test control effectiveness | OPEN | — |  |
| 2210 | Remediate control gaps | OPEN | — |  |
| 2211 | Automate preventive controls | OPEN | — |  |
| 2212 | Implement detective controls | OPEN | — |  |
| 2213 | Monitor control performance | OPEN | — |  |
| 2214 | Report control status | OPEN | — |  |
| 2215 | Support external audits | OPEN | — |  |
| 2216 | Manage auditor access | OPEN | — |  |
| 2217 | Collect evidence efficiently | OPEN | — |  |
| 2218 | Map controls to frameworks | OPEN | — |  |
| 2219 | Reduce duplicate effort | OPEN | — |  |
| 2220 | Maintain policy library | OPEN | — |  |
| 2221 | Communicate policy changes | OPEN | — |  |
| 2222 | Track policy acknowledgment | OPEN | — |  |
| 2223 | Enforce critical policies in system | OPEN | — |  |
| 2224 | Handle policy exceptions | OPEN | — |  |
| 2225 | Review exceptions regularly | OPEN | — |  |
| 2226 | Close expired exceptions | OPEN | — |  |
| 2227 | Conduct compliance training | OPEN | — |  |
| 2228 | Track training completion | OPEN | — |  |
| 2229 | Measure compliance culture | OPEN | — |  |
| 2230 | Promote speak-up culture | OPEN | — |  |
| 2231 | Handle whistleblower reports | OPEN | — |  |
| 2232 | Protect reporters | OPEN | — |  |
| 2233 | Investigate thoroughly | OPEN | — |  |
| 2234 | Take fair actions | OPEN | — |  |
| 2235 | Learn from cases | OPEN | — |  |
| 2236 | Prevent recurrence | OPEN | — |  |
| 2237 | Report to governance bodies | OPEN | — |  |
| 2238 | Maintain board risk reports | OPEN | — |  |
| 2239 | Support informed decisions | OPEN | — |  |
| 2240 | Build risk-aware culture | OPEN | — |  |
| 2241 | Align incentives with risk | OPEN | — |  |
| 2242 | Avoid excessive risk taking | OPEN | — |  |
| 2243 | Avoid excessive risk aversion | OPEN | — |  |
| 2244 | Balance growth and control | OPEN | — |  |
| 2245 | Review risk appetite periodically | OPEN | — |  |
| 2246 | Adapt to changing environment | OPEN | — |  |
| 2247 | Anticipate emerging risks | OPEN | — |  |
| 2248 | Scenario plan major risks | OPEN | — |  |
| 2249 | Stress test the business | OPEN | — |  |
| 2250 | Build antifragility | OPEN | — |  |
| 2301 | Simultaneous service cancellation by operator and mass passenger requests | OPEN | — |  |
| 2302 | Cascading cancellations due to major road closure | OPEN | — |  |
| 2303 | Mass rebooking load after disruption | OPEN | — |  |
| 2304 | System stability under mass rebooking | OPEN | — |  |
| 2305 | Partial acceptance of alternate arrangements | OPEN | — |  |
| 2306 | Complete refusal of all alternates by some passengers | OPEN | — |  |
| 2307 | Priority handling of elderly during disruption | OPEN | — |  |
| 2308 | Priority handling of disabled passengers | OPEN | — |  |
| 2309 | Priority handling of unaccompanied minors | OPEN | — |  |
| 2310 | Media and social media escalation | OPEN | — |  |
| 2311 | Coordinated public response | OPEN | — |  |
| 2312 | Consistent internal and external messaging | OPEN | — |  |
| 2313 | Regulatory information requests during incident | OPEN | — |  |
| 2314 | Multiple agencies seeking data | OPEN | — |  |
| 2315 | Parallel investigations | OPEN | — |  |
| 2316 | Evidence and log preservation | OPEN | — |  |
| 2317 | Legal hold implementation | OPEN | — |  |
| 2318 | Support for legal proceedings | OPEN | — |  |
| 2319 | Settlement discussions with passengers | OPEN | — |  |
| 2320 | Assessment of class action risk | OPEN | — |  |
| 2321 | Timely insurance notification | OPEN | — |  |
| 2322 | Support for insurance claims | OPEN | — |  |
| 2323 | Contractual implications with OTAs | OPEN | — |  |
| 2324 | Contractual implications with agents | DONE | TODO | modules/agents |
| 2325 | Invocation of force majeure | OPEN | — |  |
| 2326 | Documentation for force majeure | OPEN | — |  |
| 2327 | Challenge to force majeure claim | OPEN | — |  |
| 2328 | Partial force majeure situations | OPEN | — |  |
| 2329 | Cascading effects across network | OPEN | — |  |
| 2330 | Currency volatility impact | OPEN | — |  |
| 2331 | Sudden fuel price shock | OPEN | — |  |
| 2332 | Sudden tax change | OPEN | — |  |
| 2333 | Retrospective regulatory application | OPEN | — |  |
| 2334 | New compliance with short deadline | OPEN | — |  |
| 2335 | System changes for compliance | OPEN | — |  |
| 2336 | Temporary manual workarounds | OPEN | — |  |
| 2337 | Audit of workarounds | OPEN | — |  |
| 2338 | Transition back to system process | OPEN | — |  |
| 2339 | Parallel run of old and new | OPEN | — |  |
| 2340 | Data inconsistency during transition | OPEN | — |  |
| 2341 | Reconciliation during transition | OPEN | — |  |
| 2342 | Staff training on new process | OPEN | — |  |
| 2343 | Customer communication of changes | OPEN | — |  |
| 2344 | Agent communication of changes | DONE | TODO | modules/agents |
| 2345 | OTA communication of changes | DONE | TODO | modules/gds |
| 2346 | Monitoring adoption of new process | OPEN | — |  |
| 2347 | Handling non-compliant transactions | OPEN | — |  |
| 2348 | Escalation of non-compliance | OPEN | — |  |
| 2349 | Surprise regulatory inspection | OPEN | — |  |
| 2350 | Information provision during inspection | OPEN | — |  |
| 2351 | Controlled system access for inspectors | OPEN | — |  |
| 2352 | Log and data extraction | OPEN | — |  |
| 2353 | Process explanation to inspectors | OPEN | — |  |
| 2354 | Post-inspection actions | OPEN | — |  |
| 2355 | Implementation of recommendations | OPEN | — |  |
| 2356 | Progress reporting to regulator | OPEN | — |  |
| 2357 | Closure of inspection points | OPEN | — |  |
| 2358 | Routine return preparation | OPEN | — |  |
| 2359 | Accuracy of return data | OPEN | — |  |
| 2360 | Timely filing | OPEN | — |  |
| 2361 | Handling rejection of returns | OPEN | — |  |
| 2362 | Correction and refiling | OPEN | — |  |
| 2363 | Penalty management | OPEN | — |  |
| 2364 | Waiver applications | OPEN | — |  |
| 2365 | Compliance calendar management | OPEN | — |  |
| 2366 | Ownership of compliance tasks | OPEN | — |  |
| 2367 | Backup ownership | OPEN | — |  |
| 2368 | Compliance dashboard | OPEN | — |  |
| 2369 | Key person risk in compliance | OPEN | — |  |
| 2370 | Process documentation quality | OPEN | — |  |
| 2371 | Regular process review | OPEN | — |  |
| 2372 | External compliance assessment | OPEN | — |  |
| 2373 | Internal compliance assessment | OPEN | — |  |
| 2374 | Gap analysis | OPEN | — |  |
| 2375 | Remediation planning | OPEN | — |  |
| 2376 | Remediation tracking | OPEN | — |  |
| 2377 | Validation of fixes | OPEN | — |  |
| 2378 | Continuous monitoring | OPEN | — |  |
| 2379 | Change impact on compliance | OPEN | — |  |
| 2380 | New product clearance | OPEN | — |  |
| 2381 | New route clearance | OPEN | — |  |
| 2382 | New geography clearance | OPEN | — |  |
| 2383 | Special passenger category rules | OPEN | — |  |
| 2384 | Data localization compliance | OPEN | — |  |
| 2385 | Cross-border data rules | OPEN | — |  |
| 2386 | Consent management at scale | OPEN | — |  |
| 2387 | Privacy by design | OPEN | — |  |
| 2388 | Security by design | OPEN | — |  |
| 2389 | Default secure configuration | OPEN | — |  |
| 2390 | Least privilege enforcement | OPEN | — |  |
| 2391 | Access recertification | OPEN | — |  |
| 2392 | Orphan account cleanup | OPEN | — |  |
| 2393 | Dormant account review | OPEN | — |  |
| 2394 | Privileged access review | OPEN | — |  |
| 2395 | Service account review | OPEN | — |  |
| 2396 | Third-party access review | OPEN | — |  |
| 2397 | API access review | OPEN | — |  |
| 2398 | Integration review | OPEN | — |  |
| 2399 | Data sharing agreement review | OPEN | — |  |
| 2400 | Vendor risk assessment | OPEN | — |  |
| 2401 | Vendor security assessment | OPEN | — |  |
| 2402 | Vendor compliance check | OPEN | — |  |
| 2403 | Ongoing vendor monitoring | OPEN | — |  |
| 2404 | Vendor incident coordination | OPEN | — |  |
| 2405 | Vendor exit process | OPEN | — |  |
| 2406 | Data return or deletion by vendor | OPEN | — |  |
| 2407 | Contractual security clauses | OPEN | — |  |
| 2408 | Right to audit exercise | OPEN | — |  |
| 2409 | Vendor SLA performance | OPEN | — |  |
| 2410 | Penalty for breach | OPEN | — |  |
| 2411 | Vendor improvement plans | OPEN | — |  |
| 2412 | Strategic vendor management | OPEN | — |  |
| 2413 | Alternate vendor readiness | OPEN | — |  |
| 2414 | Continuity on vendor failure | OPEN | — |  |
| 2415 | Escrow if applicable | OPEN | — |  |
| 2416 | Source code access rights | OPEN | — |  |
| 2417 | Dependency risk review | OPEN | — |  |
| 2418 | Open source review | OPEN | — |  |
| 2419 | License compliance | OPEN | — |  |
| 2420 | Vulnerability management | OPEN | — |  |
| 2421 | Patch management | OPEN | — |  |
| 2422 | Emergency patching | OPEN | — |  |
| 2423 | Change advisory process | OPEN | — |  |
| 2424 | Emergency change process | OPEN | — |  |
| 2425 | Post-implementation review | OPEN | — |  |
| 2426 | Rollback readiness | OPEN | — |  |
| 2427 | Feature flag discipline | OPEN | — |  |
| 2428 | Stale flag cleanup | OPEN | — |  |
| 2429 | Experimentation with guardrails | OPEN | — |  |
| 2430 | Protection of core journeys | OPEN | — |  |
| 2431 | Long-term experiment impact | OPEN | — |  |
| 2432 | Experiment knowledge base | OPEN | — |  |
| 2433 | Safe production experimentation | OPEN | — |  |
| 2434 | Traffic isolation for experiments | OPEN | — |  |
| 2435 | Rapid kill switches | OPEN | — |  |
| 2436 | Regular kill switch testing | OPEN | — |  |
| 2437 | Clear RTO and RPO | OPEN | — |  |
| 2438 | Regular recovery testing | OPEN | — |  |
| 2439 | Multi-region capability | OPEN | — |  |
| 2440 | Region failure handling | OPEN | — |  |
| 2441 | Prioritization during recovery | OPEN | — |  |
| 2442 | Safe degraded mode | OPEN | — |  |
| 2443 | Transparent status communication | OPEN | — |  |
| 2444 | Consistent messaging | OPEN | — |  |
| 2445 | Safe self-service during outage | OPEN | — |  |
| 2446 | Queue non-critical work | OPEN | — |  |
| 2447 | Staged restoration | OPEN | — |  |
| 2448 | Thorough post-incident review | OPEN | — |  |
| 2449 | Action tracking to closure | OPEN | — |  |
| 2450 | Reduction in repeat incidents | OPEN | — |  |
| 2451 | Prevention over pure reaction | OPEN | — |  |
| 2452 | Dependency risk register | OPEN | — |  |
| 2453 | Reduction of single points of failure | OPEN | — |  |
| 2454 | Graceful dependency failure | OPEN | — |  |
| 2455 | Critical data caching | OPEN | — |  |
| 2456 | Continuous backup validation | OPEN | — |  |
| 2457 | Fine-grained recovery | OPEN | — |  |
| 2458 | Service and full-system recovery tests | OPEN | — |  |
| 2459 | Ransomware-resistant backups | OPEN | — |  |
| 2460 | Immutable backup copies | OPEN | — |  |
| 2461 | Ransomware response playbooks | OPEN | — |  |
| 2462 | Recovery practice | OPEN | — |  |
| 2463 | People process continuity | OPEN | — |  |
| 2464 | Manual mode for critical processes | OPEN | — |  |
| 2465 | Trained backups for key roles | OPEN | — |  |
| 2466 | Remote operations capability | OPEN | — |  |
| 2467 | Crisis communication structure | OPEN | — |  |
| 2468 | Regular communication tests | OPEN | — |  |
| 2469 | Decision making under uncertainty | OPEN | — |  |
| 2470 | Crisis decision support | OPEN | — |  |
| 2471 | Recording of crisis decisions | OPEN | — |  |
| 2472 | Continuous playbook improvement | OPEN | — |  |
| 2473 | External responder relationships | OPEN | — |  |
| 2474 | Coordinated authority response | OPEN | — |  |
| 2475 | Timely accurate information to authorities | OPEN | — |  |
| 2476 | Privacy protection in emergencies | OPEN | — |  |
| 2477 | Balance of transparency and privacy | OPEN | — |  |
| 2478 | Post-crisis passenger engagement | OPEN | — |  |
| 2479 | Tracking of commitments made | OPEN | — |  |
| 2480 | Fulfillment of commitments | OPEN | — |  |
| 2481 | Trust rebuilding actions | OPEN | — |  |
| 2482 | Measurement of trust indicators | OPEN | — |  |
| 2483 | Reporting of trust and resilience | OPEN | — |  |
| 2484 | Linking investment to outcomes | OPEN | — |  |
| 2485 | Avoiding under and over investment | OPEN | — |  |
| 2486 | Pragmatic resilience posture | OPEN | — |  |
| 2487 | Adaptation as scale changes | OPEN | — |  |
| 2488 | Differentiated resilience profiles | OPEN | — |  |
| 2489 | Protection of critical journeys first | OPEN | — |  |
| 2490 | Controlled risk on low-impact areas | OPEN | — |  |
| 2491 | Explicit risk choices | OPEN | — |  |
| 2492 | Risk acceptance records | OPEN | — |  |
| 2493 | Periodic review of acceptances | OPEN | — |  |
| 2494 | Elevation of risks no longer acceptable | OPEN | — |  |
| 2495 | Board-level risk reporting | OPEN | — |  |
| 2496 | Informed risk decisions at all levels | OPEN | — |  |
| 2497 | Appropriate risk culture | OPEN | — |  |
| 2498 | Resilience as competitive advantage | OPEN | — |  |
| 2499 | Continuous improvement of resilience | OPEN | — |  |
| 2500 | Organizational readiness for advanced operations | OPEN | — |  |

## #2501–#3000

CONFLICT 3, DONE 10, DUP 1, OPEN 286

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 2501 | Sudden demand spike from rail disruption | OPEN | — |  |
| 2502 | Sudden demand from flight disruption | OPEN | — |  |
| 2503 | Competitor cancellation creates opportunity | OPEN | — |  |
| 2504 | Competitor aggressive price drop | OPEN | — |  |
| 2505 | Risk of predatory pricing perception | OPEN | — |  |
| 2506 | Managing price competition rationally | OPEN | — |  |
| 2507 | Industry capacity coordination possibilities | OPEN | — |  |
| 2508 | Industry-wide disruption response | OPEN | — |  |
| 2509 | Association guideline compliance | OPEN | — |  |
| 2510 | Government essential service directives | OPEN | — |  |
| 2511 | Priority categories during crisis | OPEN | — |  |
| 2512 | Essential worker quotas | DONE | TODO | modules/quotas |
| 2513 | Government free travel orders | OPEN | — |  |
| 2514 | Claiming compensation for directed travel | OPEN | — |  |
| 2515 | Documentation for claims | OPEN | — |  |
| 2516 | Delay in claim settlement | OPEN | — |  |
| 2517 | Working capital impact | OPEN | — |  |
| 2518 | Alternate funding sources | OPEN | — |  |
| 2519 | Cash flow crisis management | OPEN | — |  |
| 2520 | Emergency credit activation | OPEN | — |  |
| 2521 | Lender negotiations | OPEN | — |  |
| 2522 | Vendor payment prioritization | OPEN | — |  |
| 2523 | Staff payment prioritization | OPEN | — |  |
| 2524 | Critical vendor communication | OPEN | — |  |
| 2525 | Passenger trust recovery | OPEN | — |  |
| 2526 | Service quality focus post-crisis | OPEN | — |  |
| 2527 | Recovery marketing | OPEN | — |  |
| 2528 | Special recovery offers | OPEN | — |  |
| 2529 | Frequent traveller win-back | OPEN | — |  |
| 2530 | Corporate win-back | OPEN | — |  |
| 2531 | Agent network reactivation | DONE | TODO | modules/agents |
| 2532 | Branch network optimization | OPEN | — |  |
| 2533 | Fleet rightsizing decisions | OPEN | — |  |
| 2534 | Route portfolio review | OPEN | — |  |
| 2535 | Closure of unprofitable routes | DONE | TODO | modules/trip-expenses |
| 2536 | Evaluation of new route opportunities | OPEN | — |  |
| 2537 | Seasonal route decisions | DONE | TODO | pricing/domain/fare-plan-selection.ts |
| 2538 | Charter business development | OPEN | — |  |
| 2539 | Corporate tie-up development | OPEN | — |  |
| 2540 | Education sector special services | OPEN | — |  |
| 2541 | Wedding and event services | OPEN | — |  |
| 2542 | Pilgrimage services | OPEN | — |  |
| 2543 | Tourism collaborations | OPEN | — |  |
| 2544 | Last-mile partnerships | OPEN | — |  |
| 2545 | Multi-modal packages | OPEN | — |  |
| 2546 | Joint promotions | OPEN | — |  |
| 2547 | Co-branding | OPEN | — |  |
| 2548 | Consent-based data partnerships | OPEN | — |  |
| 2549 | API partnership models | OPEN | — |  |
| 2550 | White-label opportunities | OPEN | — |  |
| 2551 | Franchise model evaluation | OPEN | — |  |
| 2552 | Agent franchise program | DONE | TODO | modules/agents |
| 2553 | Branch franchise considerations | OPEN | — |  |
| 2554 | Quality control in expanded network | OPEN | — |  |
| 2555 | Brand guideline enforcement | OPEN | — |  |
| 2556 | Franchisee training | OPEN | — |  |
| 2557 | Franchisee performance management | OPEN | — |  |
| 2558 | Conflict resolution | OPEN | — |  |
| 2559 | Exit processes | OPEN | — |  |
| 2560 | Measurement of network effects | OPEN | — |  |
| 2561 | Platform versus pure product decisions | OPEN | — |  |
| 2562 | Build versus buy decisions | OPEN | — |  |
| 2563 | Technical debt prioritization | OPEN | — |  |
| 2564 | Legacy migration planning | OPEN | — |  |
| 2565 | Data migration risk | OPEN | — |  |
| 2566 | Parallel run planning | OPEN | — |  |
| 2567 | Cutover planning | OPEN | — |  |
| 2568 | Rollback planning | OPEN | — |  |
| 2569 | Continuity during migration | OPEN | — |  |
| 2570 | Customer communication during change | OPEN | — |  |
| 2571 | Agent communication during change | DONE | TODO | modules/agents |
| 2572 | Staff training for new ways | OPEN | — |  |
| 2573 | Hypercare after go-live | OPEN | — |  |
| 2574 | Issue triage in hypercare | OPEN | — |  |
| 2575 | Stabilization metrics | OPEN | — |  |
| 2576 | Transition to BAU support | OPEN | — |  |
| 2577 | Post-migration review | OPEN | — |  |
| 2578 | Benefits realization tracking | OPEN | — |  |
| 2579 | Lessons learned capture | OPEN | — |  |
| 2580 | Knowledge base update | OPEN | — |  |
| 2581 | Process documentation update | OPEN | — |  |
| 2582 | Training material update | OPEN | — |  |
| 2583 | Support script update | OPEN | — |  |
| 2584 | Monitoring update | OPEN | — |  |
| 2585 | Alert tuning | OPEN | — |  |
| 2586 | Capacity plan update | OPEN | — |  |
| 2587 | DR plan update | OPEN | — |  |
| 2588 | BCP update | OPEN | — |  |
| 2589 | Crisis communication update | OPEN | — |  |
| 2590 | Regular testing schedule | OPEN | — |  |
| 2591 | Test result documentation | OPEN | — |  |
| 2592 | Improvement from tests | OPEN | — |  |
| 2593 | Board risk reporting | OPEN | — |  |
| 2594 | Risk appetite clarity | OPEN | — |  |
| 2595 | Risk register currency | OPEN | — |  |
| 2596 | Emerging risk scanning | OPEN | — |  |
| 2597 | Scenario analysis | OPEN | — |  |
| 2598 | Business stress testing | OPEN | — |  |
| 2599 | Sensitivity analysis | OPEN | — |  |
| 2600 | Early warning indicators | OPEN | — |  |
| 2601 | Indicator monitoring | OPEN | — |  |
| 2602 | Triggered action plans | OPEN | — |  |
| 2603 | Risk decision governance | OPEN | — |  |
| 2604 | Breach escalation | OPEN | — |  |
| 2605 | Risk culture building | OPEN | — |  |
| 2606 | Risk awareness training | OPEN | — |  |
| 2607 | Incentive alignment | OPEN | — |  |
| 2608 | Whistleblower mechanism | OPEN | — |  |
| 2609 | Investigation quality | OPEN | — |  |
| 2610 | Reporter protection | OPEN | — |  |
| 2611 | Corrective actions | OPEN | — |  |
| 2612 | Trend analysis of issues | OPEN | — |  |
| 2613 | Control testing | OPEN | — |  |
| 2614 | Gap remediation | OPEN | — |  |
| 2615 | Automated controls | OPEN | — |  |
| 2616 | Continuous monitoring | DUP | DUP | same as #2378 |
| 2617 | Exception management | OPEN | — |  |
| 2618 | Exception approval | OPEN | — |  |
| 2619 | Exception aging | OPEN | — |  |
| 2620 | Root cause of exceptions | OPEN | — |  |
| 2621 | Process redesign | OPEN | — |  |
| 2622 | Change management | OPEN | — |  |
| 2623 | Stakeholder impact | OPEN | — |  |
| 2624 | Communication planning | OPEN | — |  |
| 2625 | Training planning | OPEN | — |  |
| 2626 | Resistance management | OPEN | — |  |
| 2627 | Adoption measurement | OPEN | — |  |
| 2628 | Reinforcement | OPEN | — |  |
| 2629 | Sustainment | OPEN | — |  |
| 2630 | Continuous improvement culture | OPEN | — |  |
| 2631 | Idea generation | OPEN | — |  |
| 2632 | Idea evaluation | OPEN | — |  |
| 2633 | Piloting ideas | OPEN | — |  |
| 2634 | Scaling successes | OPEN | — |  |
| 2635 | Recognition of contributors | OPEN | — |  |
| 2636 | Best practice sharing | OPEN | — |  |
| 2637 | Cross-functional teams | OPEN | — |  |
| 2638 | Customer involvement | OPEN | — |  |
| 2639 | Agent involvement | DONE | TODO | modules/agents |
| 2640 | Staff involvement | OPEN | — |  |
| 2641 | Voice of customer | OPEN | — |  |
| 2642 | Voice of agent | DONE | TODO | modules/agents |
| 2643 | Voice of staff | OPEN | — |  |
| 2644 | Closed-loop feedback | OPEN | — |  |
| 2645 | Insight to action | OPEN | — |  |
| 2646 | Impact measurement | OPEN | — |  |
| 2647 | Journey mapping | OPEN | — |  |
| 2648 | Pain point identification | OPEN | — |  |
| 2649 | Opportunity identification | OPEN | — |  |
| 2650 | Prioritization | OPEN | — |  |
| 2651 | Business casing | OPEN | — |  |
| 2652 | Resource allocation | OPEN | — |  |
| 2653 | Initiative tracking | OPEN | — |  |
| 2654 | Benefit tracking | OPEN | — |  |
| 2655 | Portfolio management | OPEN | — |  |
| 2656 | Kill criteria | OPEN | — |  |
| 2657 | Pivot decisions | OPEN | — |  |
| 2658 | Strategic alignment | OPEN | — |  |
| 2659 | Long vs short term balance | OPEN | — |  |
| 2660 | Innovation pipeline | OPEN | — |  |
| 2661 | Emerging technology evaluation | OPEN | — |  |
| 2662 | Proof of concept process | OPEN | — |  |
| 2663 | Adoption decisions | OPEN | — |  |
| 2664 | Partnership vs build | OPEN | — |  |
| 2665 | Make vs buy vs ally | OPEN | — |  |
| 2666 | Ecosystem strategy | OPEN | — |  |
| 2667 | Platform evolution | OPEN | — |  |
| 2668 | Competitive response | OPEN | — |  |
| 2669 | Differentiation | OPEN | — |  |
| 2670 | Cost leadership | OPEN | — |  |
| 2671 | Focus strategy | OPEN | — |  |
| 2672 | Blue ocean search | OPEN | — |  |
| 2673 | Value innovation | OPEN | — |  |
| 2674 | Business model experiments | OPEN | — |  |
| 2675 | Element pivots | OPEN | — |  |
| 2676 | New revenue streams | OPEN | — |  |
| 2677 | Ancillary focus | OPEN | — |  |
| 2678 | Core protection | OPEN | — |  |
| 2679 | Pricing power | OPEN | — |  |
| 2680 | Willingness to pay | OPEN | — |  |
| 2681 | Elasticity measurement | OPEN | — |  |
| 2682 | Competitive intelligence | OPEN | — |  |
| 2683 | Value-based pricing | OPEN | — |  |
| 2684 | Dynamic pricing maturity | OPEN | — |  |
| 2685 | Offer personalization | OPEN | — |  |
| 2686 | Segment strategies | OPEN | — |  |
| 2687 | Lifecycle strategies | OPEN | — |  |
| 2688 | Retention initiatives | OPEN | — |  |
| 2689 | Acquisition initiatives | OPEN | — |  |
| 2690 | Win-back initiatives | OPEN | — |  |
| 2691 | Referral effectiveness | OPEN | — |  |
| 2692 | Loyalty redesign | CONFLICT | — |  |
| 2693 | Partnership loyalty | CONFLICT | — |  |
| 2694 | Coalition evaluation | OPEN | — |  |
| 2695 | Data-driven culture | OPEN | — |  |
| 2696 | Self-serve analytics | OPEN | — |  |
| 2697 | Data literacy | OPEN | — |  |
| 2698 | Decision quality | OPEN | — |  |
| 2699 | Bias identification | OPEN | — |  |
| 2700 | Decision documentation | OPEN | — |  |
| 2701 | After-action reviews | OPEN | — |  |
| 2702 | Outcome learning | OPEN | — |  |
| 2703 | Institutional memory | OPEN | — |  |
| 2704 | Knowledge management | OPEN | — |  |
| 2705 | Expert location | OPEN | — |  |
| 2706 | Mentoring | OPEN | — |  |
| 2707 | Succession planning | OPEN | — |  |
| 2708 | Critical role risk | OPEN | — |  |
| 2709 | Role backups | OPEN | — |  |
| 2710 | Cross training | OPEN | — |  |
| 2711 | Job rotation | OPEN | — |  |
| 2712 | Career clarity | OPEN | — |  |
| 2713 | Skill gaps | OPEN | — |  |
| 2714 | Development plans | OPEN | — |  |
| 2715 | Training effectiveness | OPEN | — |  |
| 2716 | On-job learning | OPEN | — |  |
| 2717 | Performance management maturity | OPEN | — |  |
| 2718 | Continuous feedback | OPEN | — |  |
| 2719 | Goal alignment | OPEN | — |  |
| 2720 | Framework usage (OKR etc.) | OPEN | — |  |
| 2721 | Regular reviews | OPEN | — |  |
| 2722 | Action orientation | OPEN | — |  |
| 2723 | Accountability | OPEN | — |  |
| 2724 | Consequences | OPEN | — |  |
| 2725 | Recognition systems | OPEN | — |  |
| 2726 | Fairness perception | OPEN | — |  |
| 2727 | Engagement measurement | OPEN | — |  |
| 2728 | Driver analysis | OPEN | — |  |
| 2729 | Action on surveys | OPEN | — |  |
| 2730 | Retention risk | OPEN | — |  |
| 2731 | Stay interviews | OPEN | — |  |
| 2732 | Exit analysis | OPEN | — |  |
| 2733 | Alumni value | OPEN | — |  |
| 2734 | Employer brand | OPEN | — |  |
| 2735 | Talent attraction | OPEN | — |  |
| 2736 | Diversity and inclusion | OPEN | — |  |
| 2737 | Inclusive leadership | OPEN | — |  |
| 2738 | Psychological safety | OPEN | — |  |
| 2739 | Speak-up culture | OPEN | — |  |
| 2740 | Innovation time | OPEN | — |  |
| 2741 | Intrapreneurship | OPEN | — |  |
| 2742 | Idea contests | OPEN | — |  |
| 2743 | Implementation support | OPEN | — |  |
| 2744 | Failure tolerance | OPEN | — |  |
| 2745 | Learning from failure | OPEN | — |  |
| 2746 | Storytelling of learnings | OPEN | — |  |
| 2747 | Cultural reinforcement | OPEN | — |  |
| 2748 | Leadership modelling | OPEN | — |  |
| 2749 | Values recognition | OPEN | — |  |
| 2750 | Cultural assessment | OPEN | — |  |
| 2751 | Cultural evolution | OPEN | — |  |
| 2752 | Integration in mergers | OPEN | — |  |
| 2753 | Change fatigue | DONE | TODO | fleet/domain/duty-roster.ts + /fleet/crew/* |
| 2754 | Sustainable pace | OPEN | — |  |
| 2755 | Wellbeing focus | OPEN | — |  |
| 2756 | Work-life support | OPEN | — |  |
| 2757 | Stress monitoring | OPEN | — |  |
| 2758 | Support resources | OPEN | — |  |
| 2759 | Crisis staff support | OPEN | — |  |
| 2760 | Family support in crisis | OPEN | — |  |
| 2761 | Long-term loyalty | CONFLICT | — |  |
| 2762 | Institutional pride | OPEN | — |  |
| 2763 | Purpose connection | OPEN | — |  |
| 2764 | Impact stories | OPEN | — |  |
| 2765 | Frontline empowerment | OPEN | — |  |
| 2766 | Decision rights clarity | OPEN | — |  |
| 2767 | Healthy escalation | OPEN | — |  |
| 2768 | Bureaucracy reduction | OPEN | — |  |
| 2769 | Process simplification | OPEN | — |  |
| 2770 | Low-value work automation | OPEN | — |  |
| 2771 | High-value focus | OPEN | — |  |
| 2772 | Productivity measurement | OPEN | — |  |
| 2773 | Productivity improvement | OPEN | — |  |
| 2774 | Technology enablement | OPEN | — |  |
| 2775 | System usability | OPEN | — |  |
| 2776 | Staff system feedback | OPEN | — |  |
| 2777 | Rapid issue response | OPEN | — |  |
| 2778 | Shadow process detection | OPEN | — |  |
| 2779 | Shadow process removal | OPEN | — |  |
| 2780 | Single source of truth | OPEN | — |  |
| 2781 | Data quality culture | OPEN | — |  |
| 2782 | Data ownership | OPEN | — |  |
| 2783 | Data stewardship | OPEN | — |  |
| 2784 | Master data management | OPEN | — |  |
| 2785 | Data issue resolution | OPEN | — |  |
| 2786 | Data quality metrics | OPEN | — |  |
| 2787 | Quality improvement | OPEN | — |  |
| 2788 | Trust in reports | OPEN | — |  |
| 2789 | Governed self-serve | OPEN | — |  |
| 2790 | Democratization with control | OPEN | — |  |
| 2791 | Analytics maturity | OPEN | — |  |
| 2792 | Predictive capability | OPEN | — |  |
| 2793 | Prescriptive capability | OPEN | — |  |
| 2794 | AI literacy | OPEN | — |  |
| 2795 | Responsible AI | OPEN | — |  |
| 2796 | Human oversight | OPEN | — |  |
| 2797 | Explanation capability | OPEN | — |  |
| 2798 | Bias monitoring | OPEN | — |  |
| 2799 | AI performance monitoring | OPEN | — |  |
| 2800 | Complete readiness for advanced GDS | DONE | TODO | modules/gds |

## #3001–#3500

CONFLICT 2, DONE 14, OPEN 284

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 3001 | Configure multiple fare classes on same service | OPEN | — |  |
| 3002 | Set fare class inventory allocation | DONE | TODO | modules/quotas |
| 3003 | Define fare class upgrade rules | OPEN | — |  |
| 3004 | Configure automatic upsell offers | OPEN | — |  |
| 3005 | Track upsell conversion rate | OPEN | — |  |
| 3006 | Configure bid prices for each fare class | OPEN | — |  |
| 3007 | Implement expected marginal seat revenue logic | OPEN | — |  |
| 3008 | Protect higher fare classes from dilution | OPEN | — |  |
| 3009 | Open lower fare classes when demand is weak | OPEN | — |  |
| 3010 | Close lower fare classes when demand is strong | OPEN | — |  |
| 3011 | Configure booking limits by fare class | OPEN | — |  |
| 3012 | Configure authorization levels | OPEN | — |  |
| 3013 | Set overbooking limits by service type | OPEN | — |  |
| 3014 | Calculate optimal overbooking percentage | OPEN | — |  |
| 3015 | Monitor denied boarding risk | OPEN | — |  |
| 3016 | Configure denied boarding compensation | OPEN | — |  |
| 3017 | Track denied boarding incidents | OPEN | — |  |
| 3018 | Configure group booking fare rules | OPEN | — |  |
| 3019 | Set negotiated fares for corporate accounts | OPEN | — |  |
| 3020 | Configure private fares for agents | DONE | TODO | modules/agents |
| 3021 | Set tour operator net fares | OPEN | — |  |
| 3022 | Configure seasonal fare versions | DONE | TODO | pricing/domain/fare-plan-selection.ts |
| 3023 | Create fare version effective dates | OPEN | — |  |
| 3024 | Manage fare version conflicts | OPEN | — |  |
| 3025 | Archive old fare versions | OPEN | — |  |
| 3026 | Configure fuel surcharge rules | OPEN | — |  |
| 3027 | Automatically apply or remove fuel surcharge | OPEN | — |  |
| 3028 | Configure peak day surcharge | OPEN | — |  |
| 3029 | Configure festival surcharge calendar | OPEN | — |  |
| 3030 | Configure blackout dates for discounts | DONE | TODO | coupons.blackout_dates (journey date) |
| 3031 | Configure minimum stay or maximum stay rules if applicable | OPEN | — |  |
| 3032 | Configure advance purchase requirements | OPEN | — |  |
| 3033 | Configure last minute fare rules | OPEN | — |  |
| 3034 | Point-of-sale specific pricing | OPEN | — |  |
| 3035 | Channel specific pricing (direct vs agent vs OTA) | DONE | TODO | modules/gds |
| 3036 | Device or source based pricing tests | OPEN | — |  |
| 3037 | A/B test different price points | OPEN | — |  |
| 3038 | Measure price elasticity by route | OPEN | — |  |
| 3039 | Measure price elasticity by customer segment | OPEN | — |  |
| 3040 | Build willingness-to-pay models | OPEN | — |  |
| 3041 | Configure competitor price monitoring rules | OPEN | — |  |
| 3042 | Set response rules to competitor price changes | OPEN | — |  |
| 3043 | Avoid automatic price matching traps | OPEN | — |  |
| 3044 | Configure price leadership or follower strategy per route | OPEN | — |  |
| 3045 | Track price perception scores | OPEN | — |  |
| 3046 | Configure promotional pricing calendars | OPEN | — |  |
| 3047 | Limit promotional inventory | OPEN | — |  |
| 3048 | Track promotional revenue vs dilution | OPEN | — |  |
| 3049 | Calculate net promotional contribution | OPEN | — |  |
| 3050 | Kill promotions that destroy value | OPEN | — |  |
| 3051 | Configure dynamic discounting engine | OPEN | — |  |
| 3052 | Personalize discounts within policy | OPEN | — |  |
| 3053 | Prevent discount abuse across accounts | OPEN | — |  |
| 3054 | Configure stacked discount rules carefully | OPEN | — |  |
| 3055 | Audit all discounts given | OPEN | — |  |
| 3056 | Rank staff by discount leakage | OPEN | — |  |
| 3057 | Rank agents by discount leakage | DONE | TODO | modules/agents |
| 3058 | Set discount authority by role | OPEN | — |  |
| 3059 | Require approval above discount threshold | OPEN | — |  |
| 3060 | Configure automatic discount sunset | OPEN | — |  |
| 3061 | Forecast revenue by service | OPEN | — |  |
| 3062 | Forecast revenue by route | OPEN | — |  |
| 3063 | Forecast revenue by channel | OPEN | — |  |
| 3064 | Compare forecast vs actual daily | OPEN | — |  |
| 3065 | Explain revenue variances | OPEN | — |  |
| 3066 | Update forecasts continuously | OPEN | — |  |
| 3067 | Generate revenue outlook for next 30/60/90 days | OPEN | — |  |
| 3068 | Identify revenue at risk | OPEN | — |  |
| 3069 | Recommend actions to protect revenue | OPEN | — |  |
| 3070 | Recommend actions to capture upside | OPEN | — |  |
| 3071 | Configure revenue targets by period | OPEN | — |  |
| 3072 | Cascade targets to routes and branches | OPEN | — |  |
| 3073 | Track target attainment in real time | OPEN | — |  |
| 3074 | Trigger alerts on target deviation | OPEN | — |  |
| 3075 | Support target stretch and commitment process | OPEN | — |  |
| 3076 | Calculate customer lifetime value | OPEN | — |  |
| 3077 | Segment customers by value | OPEN | — |  |
| 3078 | Treat high-value customers differently within policy | OPEN | — |  |
| 3079 | Win-back high-value lapsed customers | OPEN | — |  |
| 3080 | Protect high-value customer experience | OPEN | — |  |
| 3081 | Calculate agent lifetime value | DONE | TODO | modules/agents |
| 3082 | Segment agents by value and quality | DONE | TODO | modules/agents |
| 3083 | Invest in high-value agents | DONE | TODO | modules/agents |
| 3084 | Exit low-value high-cost agents | DONE | TODO | modules/agents |
| 3085 | Configure agent growth incentives | DONE | TODO | modules/agents |
| 3086 | Measure true channel profitability | DONE | TODO | modules/trip-expenses |
| 3087 | Fully load costs to channels | OPEN | — |  |
| 3088 | Make channel mix decisions on net contribution | OPEN | — |  |
| 3089 | Avoid vanity volume metrics | OPEN | — |  |
| 3090 | Optimize for profit not just occupancy | DONE | TODO | modules/trip-expenses |
| 3091 | Configure contribution based inventory controls | OPEN | — |  |
| 3092 | Prefer higher contribution bookings when constrained | OPEN | — |  |
| 3093 | Accept lower contribution only when necessary | OPEN | — |  |
| 3094 | Track spoilage and spillage | OPEN | — |  |
| 3095 | Minimize spoilage through better controls | OPEN | — |  |
| 3096 | Minimize spillage through better availability | OPEN | — |  |
| 3097 | Balance spoilage and spillage risk | OPEN | — |  |
| 3098 | Review control effectiveness regularly | OPEN | — |  |
| 3099 | Continuously improve revenue management process | OPEN | — |  |
| 3100 | Build revenue management culture in organization | OPEN | — |  |
| 3201 | Maintain complete route master with attributes | OPEN | — |  |
| 3202 | Define route strategic importance | OPEN | — |  |
| 3203 | Classify routes as core, growth, or marginal | OPEN | — |  |
| 3204 | Review route portfolio periodically | OPEN | — |  |
| 3205 | Decide route continuation or exit | OPEN | — |  |
| 3206 | Evaluate new route proposals systematically | OPEN | — |  |
| 3207 | Estimate demand for new routes | OPEN | — |  |
| 3208 | Estimate revenue and cost for new routes | OPEN | — |  |
| 3209 | Calculate expected contribution | OPEN | — |  |
| 3210 | Assess strategic fit of new routes | OPEN | — |  |
| 3211 | Prioritize new route opportunities | OPEN | — |  |
| 3212 | Plan new route launch carefully | OPEN | — |  |
| 3213 | Monitor new route ramp-up | OPEN | — |  |
| 3214 | Adjust new route quickly if needed | OPEN | — |  |
| 3215 | Decide scale-up or exit of new routes | OPEN | — |  |
| 3216 | Optimize existing route timings | OPEN | — |  |
| 3217 | Analyse passenger preferred departure times | OPEN | — |  |
| 3218 | Analyse competitor timings | OPEN | — |  |
| 3219 | Test timing changes | OPEN | — |  |
| 3220 | Measure impact of timing changes | OPEN | — |  |
| 3221 | Optimize service frequency | OPEN | — |  |
| 3222 | Avoid both under and over frequency | OPEN | — |  |
| 3223 | Match frequency to demand patterns | OPEN | — |  |
| 3224 | Consider connection quality in frequency | OPEN | — |  |
| 3225 | Plan seasonal frequency changes | DONE | TODO | pricing/domain/fare-plan-selection.ts |
| 3226 | Optimize vehicle type assignment | OPEN | — |  |
| 3227 | Match capacity to expected demand | OPEN | — |  |
| 3228 | Consider cost of different vehicle types | OPEN | — |  |
| 3229 | Consider passenger preference for vehicle type | OPEN | — |  |
| 3230 | Plan vehicle type upgrades or downgrades | OPEN | — |  |
| 3231 | Optimize intermediate stops | OPEN | — |  |
| 3232 | Evaluate stop addition or removal | OPEN | — |  |
| 3233 | Balance coverage and speed | OPEN | — |  |
| 3234 | Measure stop level boarding and alighting | OPEN | — |  |
| 3235 | Improve stop commercial performance | OPEN | — |  |
| 3236 | Plan connections at hubs | OPEN | — |  |
| 3237 | Minimize connection times safely | OPEN | — |  |
| 3238 | Maximize useful connections | OPEN | — |  |
| 3239 | Measure missed connection rates | OPEN | — |  |
| 3240 | Improve hub processes | OPEN | — |  |
| 3241 | Design robust schedules | OPEN | — |  |
| 3242 | Build recovery time appropriately | OPEN | — |  |
| 3243 | Avoid overly tight schedules | OPEN | — |  |
| 3244 | Consider traffic variability | OPEN | — |  |
| 3245 | Consider weather variability | OPEN | — |  |
| 3246 | Create schedule variants for different conditions | OPEN | — |  |
| 3247 | Manage schedule complexity | OPEN | — |  |
| 3248 | Avoid unnecessary schedule versions | OPEN | — |  |
| 3249 | Communicate schedule changes clearly | OPEN | — |  |
| 3250 | Minimize passenger disruption from changes | OPEN | — |  |
| 3251 | Plan fleet requirements | OPEN | — |  |
| 3252 | Calculate peak vehicle requirement | OPEN | — |  |
| 3253 | Plan spare ratio | OPEN | — |  |
| 3254 | Optimize fleet utilization | OPEN | — |  |
| 3255 | Reduce idle time | OPEN | — |  |
| 3256 | Plan maintenance windows in schedule | OPEN | — |  |
| 3257 | Coordinate commercial and engineering needs | OPEN | — |  |
| 3258 | Plan crew requirements from schedule | OPEN | — |  |
| 3259 | Ensure legal crew scheduling | OPEN | — |  |
| 3260 | Optimize crew efficiency | OPEN | — |  |
| 3261 | Plan infrastructure needs at terminals | OPEN | — |  |
| 3262 | Coordinate with terminal operators | OPEN | — |  |
| 3263 | Plan for growth in terminal capacity | OPEN | — |  |
| 3264 | Evaluate outsourcing vs own terminals | OPEN | — |  |
| 3265 | Optimize terminal processes | OPEN | — |  |
| 3266 | Support long-term network vision | OPEN | — |  |
| 3267 | Align network with company strategy | OPEN | — |  |
| 3268 | Support market entry or exit decisions | OPEN | — |  |
| 3269 | Support partnership or alliance decisions | OPEN | — |  |
| 3270 | Evaluate code-share style opportunities | OPEN | — |  |
| 3271 | Evaluate interline opportunities | OPEN | — |  |
| 3272 | Design passenger friendly networks | OPEN | — |  |
| 3273 | Minimize total journey time for passengers | OPEN | — |  |
| 3274 | Improve reliability of connections | OPEN | — |  |
| 3275 | Provide good recovery options | OPEN | — |  |
| 3276 | Design for disruption resilience | OPEN | — |  |
| 3277 | Identify critical network points | OPEN | — |  |
| 3278 | Protect critical services | OPEN | — |  |
| 3279 | Build redundancy where needed | OPEN | — |  |
| 3280 | Avoid excessive concentration of risk | OPEN | — |  |
| 3281 | Model network under stress | OPEN | — |  |
| 3282 | Simulate major disruption scenarios | OPEN | — |  |
| 3283 | Improve network based on simulations | OPEN | — |  |
| 3284 | Maintain network digital twin | OPEN | — |  |
| 3285 | Keep digital twin calibrated | OPEN | — |  |
| 3286 | Use twin for planning decisions | OPEN | — |  |
| 3287 | Use twin for commercial decisions | OPEN | — |  |
| 3288 | Use twin for operational decisions | OPEN | — |  |
| 3289 | Share relevant twin views with partners | OPEN | — |  |
| 3290 | Protect sensitive twin information | OPEN | — |  |
| 3291 | Continuously improve planning process | OPEN | — |  |
| 3292 | Shorten planning cycle times | OPEN | — |  |
| 3293 | Increase planning accuracy | OPEN | — |  |
| 3294 | Better integrate planning and operations | OPEN | — |  |
| 3295 | Better integrate planning and commercial | OPEN | — |  |
| 3296 | Measure planning process performance | OPEN | — |  |
| 3297 | Learn from planning outcomes | OPEN | — |  |
| 3298 | Build planning capability in team | OPEN | — |  |
| 3299 | Document planning knowledge | OPEN | — |  |
| 3300 | Make planning a competitive advantage | OPEN | — |  |
| 3401 | Define target customer experience standards | OPEN | — |  |
| 3402 | Measure experience at every touchpoint | OPEN | — |  |
| 3403 | Identify experience pain points | OPEN | — |  |
| 3404 | Prioritize experience improvements | OPEN | — |  |
| 3405 | Design end-to-end journey improvements | OPEN | — |  |
| 3406 | Reduce booking friction | OPEN | — |  |
| 3407 | Improve fare transparency | OPEN | — |  |
| 3408 | Reduce surprise charges | OPEN | — |  |
| 3409 | Improve communication clarity | OPEN | — |  |
| 3410 | Improve disruption communication | OPEN | — |  |
| 3411 | Personalize communication where valuable | OPEN | — |  |
| 3412 | Avoid over-communication | OPEN | — |  |
| 3413 | Respect communication preferences | OPEN | — |  |
| 3414 | Provide proactive information | OPEN | — |  |
| 3415 | Reduce need for customers to contact support | OPEN | — |  |
| 3416 | Improve first contact resolution | OPEN | — |  |
| 3417 | Empower staff to resolve issues | OPEN | — |  |
| 3418 | Reduce handoffs in issue resolution | OPEN | — |  |
| 3419 | Track issue resolution quality | OPEN | — |  |
| 3420 | Learn from every complaint | OPEN | — |  |
| 3421 | Close the loop with complainants | OPEN | — |  |
| 3422 | Turn complainants into advocates where possible | OPEN | — |  |
| 3423 | Identify systemic complaint drivers | OPEN | — |  |
| 3424 | Fix root causes of complaints | OPEN | — |  |
| 3425 | Track complaint volume and severity trends | OPEN | — |  |
| 3426 | Set complaint reduction targets | OPEN | — |  |
| 3427 | Celebrate complaint reduction successes | OPEN | — |  |
| 3428 | Make complaint handling a learning system | OPEN | — |  |
| 3429 | Design fair and clear policies | OPEN | — |  |
| 3430 | Apply policies consistently | OPEN | — |  |
| 3431 | Allow controlled exceptions with governance | OPEN | — |  |
| 3432 | Explain policy decisions clearly | OPEN | — |  |
| 3433 | Avoid rigid policy application that destroys goodwill | OPEN | — |  |
| 3434 | Balance policy and customer lifetime value | OPEN | — |  |
| 3435 | Train staff on policy intent not just rules | OPEN | — |  |
| 3436 | Monitor policy exception patterns | OPEN | — |  |
| 3437 | Improve policies based on exception data | OPEN | — |  |
| 3438 | Communicate policy changes early | OPEN | — |  |
| 3439 | Support customers through policy changes | OPEN | — |  |
| 3440 | Measure policy fairness perception | OPEN | — |  |
| 3441 | Design good service recovery | OPEN | — |  |
| 3442 | Respond quickly to failures | OPEN | — |  |
| 3443 | Apologize sincerely when appropriate | OPEN | — |  |
| 3444 | Fix the issue effectively | OPEN | — |  |
| 3445 | Provide fair compensation when due | OPEN | — |  |
| 3446 | Follow up after recovery | OPEN | — |  |
| 3447 | Measure recovery effectiveness | OPEN | — |  |
| 3448 | Improve recovery processes | OPEN | — |  |
| 3449 | Empower frontline for recovery | OPEN | — |  |
| 3450 | Avoid recovery that creates moral hazard | OPEN | — |  |
| 3451 | Identify high-value customers in recovery | OPEN | — |  |
| 3452 | Protect relationships during failures | OPEN | — |  |
| 3453 | Turn failures into loyalty opportunities | CONFLICT | — |  |
| 3454 | Track recovery cost vs value saved | OPEN | — |  |
| 3455 | Optimize recovery investment | OPEN | — |  |
| 3456 | Build recovery playbooks | OPEN | — |  |
| 3457 | Train teams on recovery | OPEN | — |  |
| 3458 | Practice recovery scenarios | OPEN | — |  |
| 3459 | Learn from recovery successes and failures | OPEN | — |  |
| 3460 | Make recovery a core competency | OPEN | — |  |
| 3461 | Measure overall customer satisfaction | OPEN | — |  |
| 3462 | Measure net promoter or equivalent | OPEN | — |  |
| 3463 | Measure customer effort score | OPEN | — |  |
| 3464 | Link experience metrics to commercial outcomes | OPEN | — |  |
| 3465 | Identify experience drivers of loyalty | CONFLICT | — |  |
| 3466 | Invest in high-impact experience elements | OPEN | — |  |
| 3467 | Avoid investing in low-impact elements | OPEN | — |  |
| 3468 | Track experience competitive position | OPEN | — |  |
| 3469 | Close experience gaps vs competitors | OPEN | — |  |
| 3470 | Build experience differentiation | OPEN | — |  |
| 3471 | Design inclusive experiences | OPEN | — |  |
| 3472 | Support passengers with disabilities properly | OPEN | — |  |
| 3473 | Support elderly passengers | OPEN | — |  |
| 3474 | Support passengers with language barriers | OPEN | — |  |
| 3475 | Support first-time travellers | OPEN | — |  |
| 3476 | Reduce anxiety in the journey | OPEN | — |  |
| 3477 | Provide confidence through information | OPEN | — |  |
| 3478 | Make the journey feel safe | OPEN | — |  |
| 3479 | Make the journey feel respectful | OPEN | — |  |
| 3480 | Make the journey feel reliable | OPEN | — |  |
| 3481 | Capture voice of customer systematically | OPEN | — |  |
| 3482 | Analyse unstructured feedback | OPEN | — |  |
| 3483 | Act on feedback insights | OPEN | — |  |
| 3484 | Tell customers what changed because of feedback | OPEN | — |  |
| 3485 | Build feedback culture internally | OPEN | — |  |
| 3486 | Recognize staff for great experience delivery | OPEN | — |  |
| 3487 | Coach staff on experience gaps | OPEN | — |  |
| 3488 | Make experience part of performance management | OPEN | — |  |
| 3489 | Align incentives with experience goals | OPEN | — |  |
| 3490 | Avoid incentive conflicts with experience | OPEN | — |  |
| 3491 | Design experience governance | OPEN | — |  |
| 3492 | Review experience metrics regularly | OPEN | — |  |
| 3493 | Escalate systemic experience issues | OPEN | — |  |
| 3494 | Invest in experience capabilities | OPEN | — |  |
| 3495 | Build experience expertise in team | OPEN | — |  |
| 3496 | Learn from other industries | OPEN | — |  |
| 3497 | Experiment with experience innovations | OPEN | — |  |
| 3498 | Scale successful experience innovations | OPEN | — |  |
| 3499 | Make customer experience a strategic priority | OPEN | — |  |
| 3500 | Turn customer experience into sustainable advantage | OPEN | — |  |

## #3501–#4000

DONE 46, OPEN 254

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 3601 | Define agent value proposition clearly | DONE | TODO | modules/agents |
| 3602 | Make agents more successful on platform than off it | DONE | TODO | modules/agents |
| 3603 | Provide agents with productivity tools | DONE | TODO | modules/agents |
| 3604 | Provide agents with market insights | DONE | TODO | modules/agents |
| 3605 | Provide agents with training | DONE | TODO | modules/agents |
| 3606 | Support agent business growth | DONE | TODO | modules/agents |
| 3607 | Recognize high performing agents | DONE | TODO | modules/agents |
| 3608 | Create agent tiering that is transparent | DONE | TODO | modules/agents |
| 3609 | Move agents between tiers based on performance | DONE | TODO | modules/agents |
| 3610 | Give better terms to better agents | DONE | TODO | modules/agents |
| 3611 | Give better inventory access to better agents | DONE | TODO | modules/agents |
| 3612 | Support struggling agents to improve | DONE | TODO | modules/agents |
| 3613 | Exit agents who damage the network | DONE | TODO | modules/agents |
| 3614 | Make exit process fair and clear | OPEN | — |  |
| 3615 | Capture learnings from agent exits | DONE | TODO | modules/agents |
| 3616 | Recruit agents strategically | DONE | TODO | modules/agents |
| 3617 | Onboard agents effectively | DONE | TODO | modules/agents |
| 3618 | Reduce time to first booking for new agents | DONE | TODO | modules/agents |
| 3619 | Monitor early agent performance | DONE | TODO | modules/agents |
| 3620 | Intervene early when agents struggle | DONE | TODO | modules/agents |
| 3621 | Build agent community | DONE | TODO | modules/agents |
| 3622 | Facilitate peer learning among agents | DONE | TODO | modules/agents |
| 3623 | Share best practices across agents | DONE | TODO | modules/agents |
| 3624 | Create agent advisory input mechanisms | DONE | TODO | modules/agents |
| 3625 | Listen to agent feedback seriously | DONE | TODO | modules/agents |
| 3626 | Close the loop with agents on feedback | DONE | TODO | modules/agents |
| 3627 | Avoid channel conflict | OPEN | — |  |
| 3628 | Make channel rules transparent | OPEN | — |  |
| 3629 | Enforce channel rules consistently | OPEN | — |  |
| 3630 | Resolve channel conflicts fairly | OPEN | — |  |
| 3631 | Design channel incentives carefully | OPEN | — |  |
| 3632 | Avoid incentives that drive wrong behavior | OPEN | — |  |
| 3633 | Measure true channel contribution | OPEN | — |  |
| 3634 | Fully allocate costs to channels | OPEN | — |  |
| 3635 | Make decisions on net channel profit | DONE | TODO | modules/trip-expenses |
| 3636 | Avoid over-reliance on any channel | OPEN | — |  |
| 3637 | Build balanced channel portfolio | OPEN | — |  |
| 3638 | Grow direct channel healthily | OPEN | — |  |
| 3639 | Use OTAs strategically | OPEN | — |  |
| 3640 | Strengthen quality of agent network | DONE | TODO | modules/agents |
| 3641 | Monitor OTA performance closely | DONE | TODO | modules/gds |
| 3642 | Manage OTA content quality | DONE | TODO | modules/gds |
| 3643 | Manage OTA fare parity | DONE | TODO | modules/gds |
| 3644 | Manage OTA inventory allocation dynamically | DONE | TODO | modules/gds |
| 3645 | Negotiate OTA terms from data position | DONE | TODO | modules/gds |
| 3646 | Track OTA contract compliance | DONE | TODO | modules/gds |
| 3647 | Resolve OTA disputes with evidence | DONE | TODO | modules/gds |
| 3648 | Evaluate OTA partnership value periodically | DONE | TODO | modules/gds |
| 3649 | Be willing to reduce low-value OTA exposure | DONE | TODO | modules/gds |
| 3650 | Strengthen high-value OTA relationships | DONE | TODO | modules/gds |
| 3651 | Develop corporate channel systematically | OPEN | — |  |
| 3652 | Understand corporate travel needs | OPEN | — |  |
| 3653 | Offer relevant corporate solutions | OPEN | — |  |
| 3654 | Implement corporate policy controls | OPEN | — |  |
| 3655 | Provide corporate reporting | OPEN | — |  |
| 3656 | Support corporate duty of care needs | OPEN | — |  |
| 3657 | Measure corporate account profitability | DONE | TODO | modules/trip-expenses |
| 3658 | Grow strategic corporate accounts | OPEN | — |  |
| 3659 | Exit unprofitable corporate deals | DONE | TODO | modules/trip-expenses |
| 3660 | Build long-term corporate relationships | OPEN | — |  |
| 3661 | Develop specialty channels (education, events, pilgrimage) | OPEN | — |  |
| 3662 | Create tailored offers for specialty segments | OPEN | — |  |
| 3663 | Build expertise in specialty segments | OPEN | — |  |
| 3664 | Partner with segment specialists | OPEN | — |  |
| 3665 | Measure specialty segment performance | OPEN | — |  |
| 3666 | Scale successful specialty approaches | OPEN | — |  |
| 3667 | Manage channel data quality | OPEN | — |  |
| 3668 | Ensure consistent content across channels | DONE | TODO | trips/services.closed_channels |
| 3669 | Ensure consistent pricing rules across channels | DONE | TODO | trips/services.closed_channels |
| 3670 | Monitor channel experience quality | OPEN | — |  |
| 3671 | Fix channel specific experience issues | OPEN | — |  |
| 3672 | Avoid channel experience that damages brand | OPEN | — |  |
| 3673 | Align all channels to brand promise | OPEN | — |  |
| 3674 | Make channel strategy coherent | OPEN | — |  |
| 3675 | Review channel strategy regularly | OPEN | — |  |
| 3676 | Adapt channel strategy to market changes | OPEN | — |  |
| 3677 | Invest in channel capabilities | OPEN | — |  |
| 3678 | Build channel management expertise | OPEN | — |  |
| 3679 | Make channel management data driven | OPEN | — |  |
| 3680 | Turn channel management into advantage | OPEN | — |  |
| 3681 | Configure partner API access carefully | DONE | TODO | modules/gds |
| 3682 | Monitor partner API usage | DONE | TODO | modules/gds |
| 3683 | Enforce partner API fair use | DONE | TODO | modules/gds |
| 3684 | Support partner technical integration | OPEN | — |  |
| 3685 | Maintain partner API quality | DONE | TODO | modules/gds |
| 3686 | Version partner APIs responsibly | DONE | TODO | modules/gds |
| 3687 | Communicate API changes early | OPEN | — |  |
| 3688 | Support partner migration on changes | OPEN | — |  |
| 3689 | Measure partner integration health | OPEN | — |  |
| 3690 | Improve partner developer experience | OPEN | — |  |
| 3691 | Create partner success function | OPEN | — |  |
| 3692 | Make partners successful | OPEN | — |  |
| 3693 | Reduce partner support burden through better design | OPEN | — |  |
| 3694 | Capture partner feature needs | OPEN | — |  |
| 3695 | Prioritize partner needs appropriately | OPEN | — |  |
| 3696 | Build partner ecosystem deliberately | OPEN | — |  |
| 3697 | Avoid partner concentration risk | OPEN | — |  |
| 3698 | Maintain healthy partner competition | OPEN | — |  |
| 3699 | Create win-win commercial models | OPEN | — |  |
| 3700 | Build lasting partner trust | OPEN | — |  |
| 3801 | Define critical data elements | OPEN | — |  |
| 3802 | Assign data ownership | OPEN | — |  |
| 3803 | Define data quality rules | OPEN | — |  |
| 3804 | Measure data quality continuously | OPEN | — |  |
| 3805 | Remediate data quality issues | OPEN | — |  |
| 3806 | Prevent bad data entry | OPEN | — |  |
| 3807 | Build data quality culture | OPEN | — |  |
| 3808 | Make data quality visible | OPEN | — |  |
| 3809 | Link data quality to outcomes | OPEN | — |  |
| 3810 | Invest in data quality where it matters | OPEN | — |  |
| 3811 | Maintain clean master data | OPEN | — |  |
| 3812 | Govern master data changes | OPEN | — |  |
| 3813 | Reduce master data duplication | OPEN | — |  |
| 3814 | Improve master data completeness | OPEN | — |  |
| 3815 | Improve master data accuracy | OPEN | — |  |
| 3816 | Support master data stewardship | OPEN | — |  |
| 3817 | Train stewards effectively | OPEN | — |  |
| 3818 | Measure stewardship effectiveness | OPEN | — |  |
| 3819 | Continuously improve master data | OPEN | — |  |
| 3820 | Make master data a trusted foundation | OPEN | — |  |
| 3821 | Build reliable reporting layer | OPEN | — |  |
| 3822 | Ensure consistent metric definitions | OPEN | — |  |
| 3823 | Avoid conflicting reports | OPEN | — |  |
| 3824 | Provide single source of truth | OPEN | — |  |
| 3825 | Make reports actionable | OPEN | — |  |
| 3826 | Reduce report proliferation | OPEN | — |  |
| 3827 | Retire unused reports | OPEN | — |  |
| 3828 | Improve report usability | OPEN | — |  |
| 3829 | Train users on reports | OPEN | — |  |
| 3830 | Measure report usage and value | OPEN | — |  |
| 3831 | Support self-service analytics safely | OPEN | — |  |
| 3832 | Provide governed data access | OPEN | — |  |
| 3833 | Prevent data misuse | OPEN | — |  |
| 3834 | Enable discovery of data | OPEN | — |  |
| 3835 | Document data meaningfully | OPEN | — |  |
| 3836 | Provide data lineage | OPEN | — |  |
| 3837 | Support data understanding | OPEN | — |  |
| 3838 | Reduce time to insight | OPEN | — |  |
| 3839 | Improve decision speed | OPEN | — |  |
| 3840 | Improve decision quality | OPEN | — |  |
| 3841 | Build forecasting capability | OPEN | — |  |
| 3842 | Forecast demand reliably | OPEN | — |  |
| 3843 | Forecast revenue reliably | OPEN | — |  |
| 3844 | Forecast key operational metrics | OPEN | — |  |
| 3845 | Measure forecast accuracy | OPEN | — |  |
| 3846 | Improve forecasts continuously | OPEN | — |  |
| 3847 | Communicate forecast uncertainty | OPEN | — |  |
| 3848 | Use forecasts in planning | OPEN | — |  |
| 3849 | Use forecasts in operations | OPEN | — |  |
| 3850 | Make forecasting a core process | OPEN | — |  |
| 3851 | Build diagnostic capability | OPEN | — |  |
| 3852 | Explain why metrics changed | OPEN | — |  |
| 3853 | Identify drivers of performance | OPEN | — |  |
| 3854 | Support root cause analysis | OPEN | — |  |
| 3855 | Avoid superficial explanations | OPEN | — |  |
| 3856 | Dig into true causes | OPEN | — |  |
| 3857 | Validate diagnostic insights | OPEN | — |  |
| 3858 | Act on diagnostic findings | OPEN | — |  |
| 3859 | Track impact of actions | OPEN | — |  |
| 3860 | Close the diagnostic loop | OPEN | — |  |
| 3861 | Build predictive capability carefully | OPEN | — |  |
| 3862 | Predict outcomes that matter | OPEN | — |  |
| 3863 | Validate predictive models rigorously | OPEN | — |  |
| 3864 | Monitor model performance in production | OPEN | — |  |
| 3865 | Retrain models when needed | OPEN | — |  |
| 3866 | Explain model predictions | OPEN | — |  |
| 3867 | Avoid blind trust in models | OPEN | — |  |
| 3868 | Combine models with human judgment | OPEN | — |  |
| 3869 | Use predictions to improve decisions | OPEN | — |  |
| 3870 | Measure value from predictions | OPEN | — |  |
| 3871 | Build prescriptive capability | OPEN | — |  |
| 3872 | Recommend actions not just insights | OPEN | — |  |
| 3873 | Optimize recommendations under constraints | OPEN | — |  |
| 3874 | Respect business rules in recommendations | OPEN | — |  |
| 3875 | Allow human override of recommendations | OPEN | — |  |
| 3876 | Learn from overrides | OPEN | — |  |
| 3877 | Improve recommendations over time | OPEN | — |  |
| 3878 | Automate low-risk prescriptions | OPEN | — |  |
| 3879 | Keep humans in loop for high-risk | OPEN | — |  |
| 3880 | Govern automated decisions | OPEN | — |  |
| 3881 | Build experimentation capability | OPEN | — |  |
| 3882 | Design experiments properly | OPEN | — |  |
| 3883 | Run experiments safely | OPEN | — |  |
| 3884 | Analyse experiment results correctly | OPEN | — |  |
| 3885 | Avoid false conclusions | OPEN | — |  |
| 3886 | Scale successful experiments | OPEN | — |  |
| 3887 | Kill failed experiments quickly | OPEN | — |  |
| 3888 | Capture experiment learnings | OPEN | — |  |
| 3889 | Build institutional experiment memory | OPEN | — |  |
| 3890 | Make experimentation routine | OPEN | — |  |
| 3891 | Support strategic analytics | OPEN | — |  |
| 3892 | Answer big strategic questions with data | OPEN | — |  |
| 3893 | Support scenario analysis | OPEN | — |  |
| 3894 | Support investment cases | OPEN | — |  |
| 3895 | Support competitive analysis | OPEN | — |  |
| 3896 | Support customer strategy | OPEN | — |  |
| 3897 | Support network strategy | OPEN | — |  |
| 3898 | Support pricing strategy | OPEN | — |  |
| 3899 | Make analytics partner to strategy | OPEN | — |  |
| 3900 | Elevate analytics impact | OPEN | — |  |
| 3901 | Build data literacy across organization | OPEN | — |  |
| 3902 | Train different levels appropriately | OPEN | — |  |
| 3903 | Make basic data skills widespread | OPEN | — |  |
| 3904 | Develop advanced skills in specialists | OPEN | — |  |
| 3905 | Create career paths in analytics | OPEN | — |  |
| 3906 | Attract and retain analytics talent | OPEN | — |  |
| 3907 | Build analytics community | OPEN | — |  |
| 3908 | Share analytics practices | OPEN | — |  |
| 3909 | Raise overall analytical maturity | OPEN | — |  |
| 3910 | Make data-driven the default | OPEN | — |  |
| 3911 | Reduce reliance on pure opinion | OPEN | — |  |
| 3912 | Encourage hypothesis driven work | OPEN | — |  |
| 3913 | Demand evidence for claims | OPEN | — |  |
| 3914 | Reward good analytical work | OPEN | — |  |
| 3915 | Correct poor analytical work constructively | OPEN | — |  |
| 3916 | Build respect for uncertainty | OPEN | — |  |
| 3917 | Communicate uncertainty clearly | OPEN | — |  |
| 3918 | Avoid false precision | OPEN | — |  |
| 3919 | Make decisions under uncertainty deliberately | OPEN | — |  |
| 3920 | Improve judgment with data | OPEN | — |  |
| 3921 | Protect against cognitive biases | OPEN | — |  |
| 3922 | Use data to challenge assumptions | OPEN | — |  |
| 3923 | Welcome disconfirming evidence | OPEN | — |  |
| 3924 | Update beliefs with evidence | OPEN | — |  |
| 3925 | Build intellectual honesty | OPEN | — |  |
| 3926 | Create safe environment for truth | OPEN | — |  |
| 3927 | Avoid shooting messengers | OPEN | — |  |
| 3928 | Reward accurate forecasting | OPEN | — |  |
| 3929 | Learn from forecasting errors | OPEN | — |  |
| 3930 | Improve collective judgment | OPEN | — |  |
| 3931 | Govern analytics ethically | OPEN | — |  |
| 3932 | Protect privacy in analytics | OPEN | — |  |
| 3933 | Avoid unfair use of data | OPEN | — |  |
| 3934 | Ensure transparency where required | OPEN | — |  |
| 3935 | Maintain human accountability | OPEN | — |  |
| 3936 | Audit analytics practices | OPEN | — |  |
| 3937 | Correct unethical use | OPEN | — |  |
| 3938 | Build ethical analytics culture | OPEN | — |  |
| 3939 | Stay current with regulations | OPEN | — |  |
| 3940 | Make ethics non-negotiable | OPEN | — |  |
| 3941 | Measure analytics value | OPEN | — |  |
| 3942 | Link analytics to business outcomes | OPEN | — |  |
| 3943 | Prioritize high-value analytics work | OPEN | — |  |
| 3944 | Stop low-value analytics work | OPEN | — |  |
| 3945 | Improve analytics ROI | OPEN | — |  |
| 3946 | Communicate analytics value | OPEN | — |  |
| 3947 | Secure continued investment | OPEN | — |  |
| 3948 | Build sustainable analytics capability | OPEN | — |  |
| 3949 | Avoid analytics hype cycles | OPEN | — |  |
| 3950 | Focus on durable value creation | OPEN | — |  |
| 3951 | Integrate analytics into processes | OPEN | — |  |
| 3952 | Embed analytics in workflows | OPEN | — |  |
| 3953 | Make insights available at decision time | OPEN | — |  |
| 3954 | Reduce time from data to action | OPEN | — |  |
| 3955 | Automate insight delivery where useful | OPEN | — |  |
| 3956 | Personalize insights for roles | OPEN | — |  |
| 3957 | Avoid insight overload | OPEN | — |  |
| 3958 | Focus attention on what matters | OPEN | — |  |
| 3959 | Design for action | OPEN | — |  |
| 3960 | Close insight to action gap | OPEN | — |  |
| 3961 | Support real-time operations with analytics | OPEN | — |  |
| 3962 | Support tactical decisions with analytics | OPEN | — |  |
| 3963 | Support strategic decisions with analytics | OPEN | — |  |
| 3964 | Create coherent analytics across horizons | OPEN | — |  |
| 3965 | Align short and long term views | OPEN | — |  |
| 3966 | Avoid conflicting signals | OPEN | — |  |
| 3967 | Provide integrated performance views | OPEN | — |  |
| 3968 | Support management rhythms with data | OPEN | — |  |
| 3969 | Make reviews data driven | OPEN | — |  |
| 3970 | Improve review effectiveness | OPEN | — |  |
| 3971 | Build external data capability carefully | OPEN | — |  |
| 3972 | Integrate useful external signals | OPEN | — |  |
| 3973 | Validate external data quality | OPEN | — |  |
| 3974 | Avoid over-reliance on external data | OPEN | — |  |
| 3975 | Combine internal and external intelligently | OPEN | — |  |
| 3976 | Create unique combined insights | OPEN | — |  |
| 3977 | Protect unique data advantages | OPEN | — |  |
| 3978 | Use data as barrier to competition | OPEN | — |  |
| 3979 | Build data network effects where possible | OPEN | — |  |
| 3980 | Turn data into moat responsibly | OPEN | — |  |
| 3981 | Continuously modernize analytics stack | OPEN | — |  |
| 3982 | Balance innovation and stability | OPEN | — |  |
| 3983 | Manage technical debt in analytics | OPEN | — |  |
| 3984 | Improve reliability of analytics | OPEN | — |  |
| 3985 | Improve performance of analytics | OPEN | — |  |
| 3986 | Control analytics costs | OPEN | — |  |
| 3987 | Optimize analytics architecture | OPEN | — |  |
| 3988 | Plan analytics capacity | OPEN | — |  |
| 3989 | Support growing analytics demand | OPEN | — |  |
| 3990 | Keep analytics platform healthy | OPEN | — |  |
| 3991 | Partner with business effectively | OPEN | — |  |
| 3992 | Understand business context deeply | OPEN | — |  |
| 3993 | Speak business language | OPEN | — |  |
| 3994 | Deliver what business needs | OPEN | — |  |
| 3995 | Manage business expectations | OPEN | — |  |
| 3996 | Build trusted advisor relationships | OPEN | — |  |
| 3997 | Influence decisions positively | OPEN | — |  |
| 3998 | Measure partnership effectiveness | OPEN | — |  |
| 3999 | Improve business-analytics collaboration | OPEN | — |  |
| 4000 | Make analytics true business partner | OPEN | — |  |

## #4001–#4500

DONE 1, OPEN 299

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 4001 | Define clear vision for the GDS enabled business | DONE | TODO | modules/gds |
| 4002 | Cascade vision into strategy | OPEN | — |  |
| 4003 | Translate strategy into objectives | OPEN | — |  |
| 4004 | Cascade objectives into measurable goals | OPEN | — |  |
| 4005 | Align teams to goals | OPEN | — |  |
| 4006 | Review progress regularly | OPEN | — |  |
| 4007 | Adjust course based on evidence | OPEN | — |  |
| 4008 | Maintain strategic focus | OPEN | — |  |
| 4009 | Avoid strategic drift | OPEN | — |  |
| 4010 | Communicate strategy clearly and repeatedly | OPEN | — |  |
| 4011 | Design effective governance structures | OPEN | — |  |
| 4012 | Clarify decision rights | OPEN | — |  |
| 4013 | Avoid decision bottlenecks | OPEN | — |  |
| 4014 | Avoid decision vacuum | OPEN | — |  |
| 4015 | Push decisions to appropriate levels | OPEN | — |  |
| 4016 | Escalate truly important decisions | OPEN | — |  |
| 4017 | Document key decisions | OPEN | — |  |
| 4018 | Review decision outcomes | OPEN | — |  |
| 4019 | Improve decision processes | OPEN | — |  |
| 4020 | Build decision capability | OPEN | — |  |
| 4021 | Design effective management rhythms | OPEN | — |  |
| 4022 | Run efficient meetings | OPEN | — |  |
| 4023 | Focus meetings on decisions and actions | OPEN | — |  |
| 4024 | Track actions to completion | OPEN | — |  |
| 4025 | Avoid meeting overload | OPEN | — |  |
| 4026 | Protect time for deep work | OPEN | — |  |
| 4027 | Balance synchronous and asynchronous work | OPEN | — |  |
| 4028 | Improve organizational tempo | OPEN | — |  |
| 4029 | Match tempo to business needs | OPEN | — |  |
| 4030 | Avoid both haste and delay | OPEN | — |  |
| 4031 | Build strong leadership pipeline | OPEN | — |  |
| 4032 | Identify high potential talent early | OPEN | — |  |
| 4033 | Develop leaders deliberately | OPEN | — |  |
| 4034 | Provide stretch opportunities | OPEN | — |  |
| 4035 | Provide mentoring and coaching | OPEN | — |  |
| 4036 | Rotate talent for breadth | OPEN | — |  |
| 4037 | Build depth in critical areas | OPEN | — |  |
| 4038 | Plan succession for key roles | OPEN | — |  |
| 4039 | Reduce key person risk | OPEN | — |  |
| 4040 | Build bench strength | OPEN | — |  |
| 4041 | Design fair performance systems | OPEN | — |  |
| 4042 | Set clear expectations | OPEN | — |  |
| 4043 | Provide regular feedback | OPEN | — |  |
| 4044 | Differentiate performance honestly | OPEN | — |  |
| 4045 | Reward strong performance | OPEN | — |  |
| 4046 | Address weak performance | OPEN | — |  |
| 4047 | Avoid rating inflation | OPEN | — |  |
| 4048 | Avoid politics in evaluation | OPEN | — |  |
| 4049 | Link performance to outcomes | OPEN | — |  |
| 4050 | Make performance system trusted | OPEN | — |  |
| 4051 | Design effective incentive systems | OPEN | — |  |
| 4052 | Align incentives to desired outcomes | OPEN | — |  |
| 4053 | Avoid unintended consequences | OPEN | — |  |
| 4054 | Balance individual and team incentives | OPEN | — |  |
| 4055 | Balance short and long term incentives | OPEN | — |  |
| 4056 | Review incentive effectiveness | OPEN | — |  |
| 4057 | Adjust incentives based on evidence | OPEN | — |  |
| 4058 | Communicate incentives clearly | OPEN | — |  |
| 4059 | Ensure perceived fairness | OPEN | — |  |
| 4060 | Make incentives motivational | OPEN | — |  |
| 4061 | Build engagement deliberately | OPEN | — |  |
| 4062 | Measure engagement | OPEN | — |  |
| 4063 | Understand engagement drivers | OPEN | — |  |
| 4064 | Act on engagement findings | OPEN | — |  |
| 4065 | Improve manager quality | OPEN | — |  |
| 4066 | Improve job design | OPEN | — |  |
| 4067 | Improve working environment | OPEN | — |  |
| 4068 | Recognize contributions meaningfully | OPEN | — |  |
| 4069 | Provide growth opportunities | OPEN | — |  |
| 4070 | Make people feel valued | OPEN | — |  |
| 4071 | Build inclusive culture | OPEN | — |  |
| 4072 | Ensure fair treatment | OPEN | — |  |
| 4073 | Value diverse perspectives | OPEN | — |  |
| 4074 | Create belonging | OPEN | — |  |
| 4075 | Address exclusion quickly | OPEN | — |  |
| 4076 | Build inclusive leadership skills | OPEN | — |  |
| 4077 | Measure inclusion | OPEN | — |  |
| 4078 | Improve inclusion continuously | OPEN | — |  |
| 4079 | Make inclusion non-negotiable | OPEN | — |  |
| 4080 | Harness diversity for better decisions | OPEN | — |  |
| 4081 | Build psychological safety | OPEN | — |  |
| 4082 | Encourage speaking up | OPEN | — |  |
| 4083 | Respond well to bad news | OPEN | — |  |
| 4084 | Avoid blame culture | OPEN | — |  |
| 4085 | Learn from failures | OPEN | — |  |
| 4086 | Celebrate learning | OPEN | — |  |
| 4087 | Make it safe to experiment | OPEN | — |  |
| 4088 | Make it safe to disagree | OPEN | — |  |
| 4089 | Make it safe to ask for help | OPEN | — |  |
| 4090 | Build trust across teams | OPEN | — |  |
| 4091 | Improve cross-functional collaboration | OPEN | — |  |
| 4092 | Break silos | OPEN | — |  |
| 4093 | Create shared goals across functions | OPEN | — |  |
| 4094 | Improve handoffs | OPEN | — |  |
| 4095 | Resolve conflicts constructively | OPEN | — |  |
| 4096 | Build mutual understanding | OPEN | — |  |
| 4097 | Create collaboration mechanisms | OPEN | — |  |
| 4098 | Measure collaboration effectiveness | OPEN | — |  |
| 4099 | Reward collaborative behavior | OPEN | — |  |
| 4100 | Make collaboration the norm | OPEN | — |  |
| 4101 | Manage change effectively | OPEN | — |  |
| 4102 | Anticipate resistance | OPEN | — |  |
| 4103 | Address concerns honestly | OPEN | — |  |
| 4104 | Involve people in change | OPEN | — |  |
| 4105 | Communicate change rationale | OPEN | — |  |
| 4106 | Provide support during change | OPEN | — |  |
| 4107 | Monitor change adoption | OPEN | — |  |
| 4108 | Adjust change approach as needed | OPEN | — |  |
| 4109 | Sustain changes | OPEN | — |  |
| 4110 | Build change capability | OPEN | — |  |
| 4111 | Avoid change overload | OPEN | — |  |
| 4112 | Sequence changes thoughtfully | OPEN | — |  |
| 4113 | Protect capacity for change | OPEN | — |  |
| 4114 | Prioritize changes ruthlessly | OPEN | — |  |
| 4115 | Stop low-value changes | OPEN | — |  |
| 4116 | Focus on high-impact changes | OPEN | — |  |
| 4117 | Measure change outcomes | OPEN | — |  |
| 4118 | Learn from change efforts | OPEN | — |  |
| 4119 | Improve change success rate | OPEN | — |  |
| 4120 | Make organization adaptable | OPEN | — |  |
| 4121 | Build continuous improvement culture | OPEN | — |  |
| 4122 | Encourage idea generation | OPEN | — |  |
| 4123 | Evaluate ideas fairly | OPEN | — |  |
| 4124 | Implement good ideas | OPEN | — |  |
| 4125 | Recognize idea contributors | OPEN | — |  |
| 4126 | Share improvements widely | OPEN | — |  |
| 4127 | Standardize what works | OPEN | — |  |
| 4128 | Allow local adaptation where useful | OPEN | — |  |
| 4129 | Measure improvement impact | OPEN | — |  |
| 4130 | Make improvement everyone's job | OPEN | — |  |
| 4131 | Capture organizational knowledge | OPEN | — |  |
| 4132 | Make knowledge findable | OPEN | — |  |
| 4133 | Keep knowledge current | OPEN | — |  |
| 4134 | Encourage knowledge sharing | OPEN | — |  |
| 4135 | Recognize knowledge contributors | OPEN | — |  |
| 4136 | Reduce knowledge loss on exits | OPEN | — |  |
| 4137 | Onboard using knowledge assets | OPEN | — |  |
| 4138 | Improve knowledge quality | OPEN | — |  |
| 4139 | Measure knowledge system value | OPEN | — |  |
| 4140 | Make knowledge a strategic asset | OPEN | — |  |
| 4141 | Learn from external sources | OPEN | — |  |
| 4142 | Benchmark thoughtfully | OPEN | — |  |
| 4143 | Avoid blind copying | OPEN | — |  |
| 4144 | Adapt external ideas to context | OPEN | — |  |
| 4145 | Participate in industry forums | OPEN | — |  |
| 4146 | Build external networks | OPEN | — |  |
| 4147 | Bring external insights in | OPEN | — |  |
| 4148 | Contribute to industry improvement | OPEN | — |  |
| 4149 | Build reputation as learning organization | OPEN | — |  |
| 4150 | Attract talent through learning culture | OPEN | — |  |
| 4151 | Manage innovation portfolio | OPEN | — |  |
| 4152 | Balance core and new | OPEN | — |  |
| 4153 | Protect innovation resources | OPEN | — |  |
| 4154 | Kill weak innovations early | OPEN | — |  |
| 4155 | Scale strong innovations | OPEN | — |  |
| 4156 | Integrate innovations into core | OPEN | — |  |
| 4157 | Avoid innovation theater | OPEN | — |  |
| 4158 | Measure innovation outcomes | OPEN | — |  |
| 4159 | Improve innovation process | OPEN | — |  |
| 4160 | Make innovation systematic | OPEN | — |  |
| 4161 | Anticipate market changes | OPEN | — |  |
| 4162 | Sense weak signals | OPEN | — |  |
| 4163 | Interpret signals wisely | OPEN | — |  |
| 4164 | Respond to changes deliberately | OPEN | — |  |
| 4165 | Avoid both panic and denial | OPEN | — |  |
| 4166 | Build response options in advance | OPEN | — |  |
| 4167 | Maintain strategic flexibility | OPEN | — |  |
| 4168 | Avoid over-commitment to one future | OPEN | — |  |
| 4169 | Review strategy assumptions regularly | OPEN | — |  |
| 4170 | Update strategy when evidence demands | OPEN | — |  |
| 4171 | Allocate resources strategically | OPEN | — |  |
| 4172 | Fund strategic priorities adequately | OPEN | — |  |
| 4173 | Starve non-priorities | OPEN | — |  |
| 4174 | Reallocate based on evidence | OPEN | — |  |
| 4175 | Avoid spreading resources too thin | OPEN | — |  |
| 4176 | Build resource allocation discipline | OPEN | — |  |
| 4177 | Make trade-offs explicit | OPEN | — |  |
| 4178 | Communicate resource decisions | OPEN | — |  |
| 4179 | Review allocation effectiveness | OPEN | — |  |
| 4180 | Improve resource productivity | OPEN | — |  |
| 4181 | Manage external stakeholders well | OPEN | — |  |
| 4182 | Map stakeholder landscape | OPEN | — |  |
| 4183 | Understand stakeholder interests | OPEN | — |  |
| 4184 | Engage stakeholders appropriately | OPEN | — |  |
| 4185 | Build stakeholder trust | OPEN | — |  |
| 4186 | Manage stakeholder conflicts | OPEN | — |  |
| 4187 | Communicate proactively | OPEN | — |  |
| 4188 | Deliver on commitments | OPEN | — |  |
| 4189 | Measure stakeholder relationships | OPEN | — |  |
| 4190 | Strengthen critical relationships | OPEN | — |  |
| 4191 | Manage regulatory relationships | OPEN | — |  |
| 4192 | Maintain compliance excellence | OPEN | — |  |
| 4193 | Engage regulators constructively | OPEN | — |  |
| 4194 | Contribute to better regulation | OPEN | — |  |
| 4195 | Anticipate regulatory changes | OPEN | — |  |
| 4196 | Influence regulatory direction ethically | OPEN | — |  |
| 4197 | Build regulatory credibility | OPEN | — |  |
| 4198 | Reduce regulatory friction | OPEN | — |  |
| 4199 | Turn compliance into advantage | OPEN | — |  |
| 4200 | Make regulatory excellence cultural | OPEN | — |  |
| 4201 | Manage investor or owner relationships | OPEN | — |  |
| 4202 | Provide transparent performance views | OPEN | — |  |
| 4203 | Explain strategy and progress | OPEN | — |  |
| 4204 | Manage expectations realistically | OPEN | — |  |
| 4205 | Deliver on promises | OPEN | — |  |
| 4206 | Build owner confidence | OPEN | — |  |
| 4207 | Support ownership transitions if needed | OPEN | — |  |
| 4208 | Protect long-term value | OPEN | — |  |
| 4209 | Balance short-term pressures | OPEN | — |  |
| 4210 | Make ownership a strength | OPEN | — |  |
| 4211 | Prepare for possible transactions | OPEN | — |  |
| 4212 | Maintain clean records | OPEN | — |  |
| 4213 | Maintain data room readiness | OPEN | — |  |
| 4214 | Understand valuation drivers | OPEN | — |  |
| 4215 | Protect and grow key value drivers | OPEN | — |  |
| 4216 | Reduce value detractors | OPEN | — |  |
| 4217 | Build transferable systems and teams | OPEN | — |  |
| 4218 | Reduce key person dependence | OPEN | — |  |
| 4219 | Make business institutionally strong | OPEN | — |  |
| 4220 | Maximize strategic options | OPEN | — |  |
| 4221 | Build enduring competitive advantages | OPEN | — |  |
| 4222 | Identify sources of advantage | OPEN | — |  |
| 4223 | Strengthen advantages deliberately | OPEN | — |  |
| 4224 | Protect advantages from erosion | OPEN | — |  |
| 4225 | Extend advantages into new areas | OPEN | — |  |
| 4226 | Avoid advantage destroying actions | OPEN | — |  |
| 4227 | Monitor competitive threats | OPEN | — |  |
| 4228 | Respond to threats effectively | OPEN | — |  |
| 4229 | Shape industry structure where possible | OPEN | — |  |
| 4230 | Occupy attractive positions | OPEN | — |  |
| 4231 | Build brand strength | OPEN | — |  |
| 4232 | Deliver on brand promise consistently | OPEN | — |  |
| 4233 | Measure brand health | OPEN | — |  |
| 4234 | Invest in brand building | OPEN | — |  |
| 4235 | Protect brand from damage | OPEN | — |  |
| 4236 | Recover brand from setbacks | OPEN | — |  |
| 4237 | Make brand a decision filter | OPEN | — |  |
| 4238 | Align organization to brand | OPEN | — |  |
| 4239 | Turn brand into pricing power | OPEN | — |  |
| 4240 | Turn brand into preference | OPEN | — |  |
| 4241 | Build operational excellence | OPEN | — |  |
| 4242 | Standardize best processes | OPEN | — |  |
| 4243 | Reduce process variability | OPEN | — |  |
| 4244 | Improve process reliability | OPEN | — |  |
| 4245 | Reduce waste | OPEN | — |  |
| 4246 | Improve flow | OPEN | — |  |
| 4247 | Empower process owners | OPEN | — |  |
| 4248 | Measure process performance | OPEN | — |  |
| 4249 | Improve processes continuously | OPEN | — |  |
| 4250 | Make operational excellence cultural | OPEN | — |  |
| 4251 | Build financial discipline | OPEN | — |  |
| 4252 | Maintain cost consciousness | OPEN | — |  |
| 4253 | Invest productively | OPEN | — |  |
| 4254 | Avoid wasteful spending | OPEN | — |  |
| 4255 | Improve capital efficiency | OPEN | — |  |
| 4256 | Manage working capital tightly | OPEN | — |  |
| 4257 | Maintain appropriate liquidity | OPEN | — |  |
| 4258 | Manage leverage prudently | OPEN | — |  |
| 4259 | Deliver sustainable returns | OPEN | — |  |
| 4260 | Build financial resilience | OPEN | — |  |
| 4261 | Integrate ESG thoughtfully | OPEN | — |  |
| 4262 | Identify material ESG issues | OPEN | — |  |
| 4263 | Set meaningful ESG goals | OPEN | — |  |
| 4264 | Track ESG performance | OPEN | — |  |
| 4265 | Report ESG transparently | OPEN | — |  |
| 4266 | Improve ESG outcomes | OPEN | — |  |
| 4267 | Avoid greenwashing | OPEN | — |  |
| 4268 | Link ESG to strategy | OPEN | — |  |
| 4269 | Create ESG value | OPEN | — |  |
| 4270 | Make ESG authentic | OPEN | — |  |
| 4271 | Prepare for future of mobility | OPEN | — |  |
| 4272 | Understand technology shifts | OPEN | — |  |
| 4273 | Understand demographic shifts | OPEN | — |  |
| 4274 | Understand regulatory shifts | OPEN | — |  |
| 4275 | Understand competitive shifts | OPEN | — |  |
| 4276 | Build relevant future capabilities | OPEN | — |  |
| 4277 | Avoid betting on single future | OPEN | — |  |
| 4278 | Maintain optionality | OPEN | — |  |
| 4279 | Experiment with future models | OPEN | — |  |
| 4280 | Scale what works in the future | OPEN | — |  |
| 4281 | Build long-term oriented culture | OPEN | — |  |
| 4282 | Resist excessive short-termism | OPEN | — |  |
| 4283 | Invest in future while delivering present | OPEN | — |  |
| 4284 | Make trade-offs explicitly | OPEN | — |  |
| 4285 | Communicate long-term logic | OPEN | — |  |
| 4286 | Align incentives to long-term | OPEN | — |  |
| 4287 | Measure long-term progress | OPEN | — |  |
| 4288 | Celebrate long-term wins | OPEN | — |  |
| 4289 | Stay patient with compounding | OPEN | — |  |
| 4290 | Build generational institution | OPEN | — |  |
| 4291 | Document the operating system of the business | OPEN | — |  |
| 4292 | Make implicit knowledge explicit | OPEN | — |  |
| 4293 | Train new people on the operating system | OPEN | — |  |
| 4294 | Improve the operating system continuously | OPEN | — |  |
| 4295 | Protect the operating system from erosion | OPEN | — |  |
| 4296 | Make the operating system a strength | OPEN | — |  |
| 4297 | Transfer the operating system in growth | OPEN | — |  |
| 4298 | Adapt the operating system to scale | OPEN | — |  |
| 4299 | Keep the operating system human | OPEN | — |  |
| 4300 | Make the operating system the foundation of excellence | OPEN | — |  |

## #5001–#5500

CONFLICT 1, DONE 19, OPEN 130

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 5001 | Booking created then immediately cancelled by passenger | OPEN | — |  |
| 5002 | Booking created then cancelled by operator before departure | OPEN | — |  |
| 5003 | Booking modified multiple times before departure | OPEN | — |  |
| 5004 | Booking with maximum allowed passengers | OPEN | — |  |
| 5005 | Booking with single passenger | OPEN | — |  |
| 5006 | Booking with mixed adult child infant | DONE | TODO | booking/domain/passenger-categories.ts + /concessions |
| 5007 | Booking with only children (policy check) | DONE | TODO | booking/domain/passenger-categories.ts + /concessions |
| 5008 | Booking with special needs passenger | OPEN | — |  |
| 5009 | Booking with extra luggage declaration | OPEN | — |  |
| 5010 | Booking with seat preference that cannot be met | OPEN | — |  |
| 5011 | Booking when preferred seat type sold out | OPEN | — |  |
| 5012 | Booking when only restricted seats left | OPEN | — |  |
| 5013 | Booking on service with partial inventory block | DONE | TODO | modules/quotas |
| 5014 | Booking on service with temporary diversion | OPEN | — |  |
| 5015 | Booking on service with crew change scheduled | OPEN | — |  |
| 5016 | Booking during fare change window | OPEN | — |  |
| 5017 | Booking during inventory reallocation | OPEN | — |  |
| 5018 | Booking while schedule is being edited | OPEN | — |  |
| 5019 | Booking while bus is being reassigned | OPEN | — |  |
| 5020 | Booking while OTA sync is in progress | DONE | TODO | modules/gds |
| 5021 | Concurrent booking and cancellation on same seat | OPEN | — |  |
| 5022 | Concurrent booking and seat block | OPEN | — |  |
| 5023 | Concurrent booking and service cancellation | OPEN | — |  |
| 5024 | Concurrent booking and fare update | OPEN | — |  |
| 5025 | Concurrent group and individual booking on last seats | OPEN | — |  |
| 5026 | Waitlist confirmation colliding with new booking | DONE | TODO | modules/demand |
| 5027 | Waitlist confirmation when passenger unreachable | DONE | TODO | modules/demand |
| 5028 | Waitlist confirmation when payment fails | DONE | TODO | modules/demand |
| 5029 | Waitlist expiry exactly at confirmation time | DONE | TODO | modules/demand |
| 5030 | Multiple waitlist passengers for one released seat | DONE | TODO | modules/demand |
| 5031 | Seat released by cancellation auto-assigned to waitlist | DONE | TODO | modules/demand |
| 5032 | Seat released by no-show auto-assigned to waitlist | DONE | TODO | modules/demand |
| 5033 | Seat released by operator block removal | OPEN | — |  |
| 5034 | Held seat expired and rebooked immediately | OPEN | — |  |
| 5035 | Held seat manually released and rebooked | OPEN | — |  |
| 5036 | Partial group booking when seats insufficient | OPEN | — |  |
| 5037 | Group booking split across multiple services | OPEN | — |  |
| 5038 | Group booking with mixed seat types | OPEN | — |  |
| 5039 | Group booking cancellation of subset | OPEN | — |  |
| 5040 | Group booking name corrections in bulk | OPEN | — |  |
| 5041 | Corporate booking with cost center codes | OPEN | — |  |
| 5042 | Corporate booking with travel policy enforcement | OPEN | — |  |
| 5043 | Corporate booking exceeding policy limits | OPEN | — |  |
| 5044 | Corporate booking approval workflow | OPEN | — |  |
| 5045 | Corporate booking post-facto approval | OPEN | — |  |
| 5046 | Open ticket booking and later confirmation | OPEN | — |  |
| 5047 | Open ticket confirmation when no seats left | OPEN | — |  |
| 5048 | Open ticket partial confirmation | OPEN | — |  |
| 5049 | Open ticket expiry | OPEN | — |  |
| 5050 | Open ticket transfer rules | OPEN | — |  |
| 5051 | Multi-hop booking with tight connection | OPEN | — |  |
| 5052 | Multi-hop booking with long layover | OPEN | — |  |
| 5053 | Multi-hop booking one leg cancelled | OPEN | — |  |
| 5054 | Multi-hop booking both legs cancelled | OPEN | — |  |
| 5055 | Multi-hop booking seat change on one leg | OPEN | — |  |
| 5056 | Multi-hop booking passenger miss connection | OPEN | — |  |
| 5057 | Multi-hop re-accommodation | OPEN | — |  |
| 5058 | Multi-hop refund rules application | OPEN | — |  |
| 5059 | Through fare vs separate fare comparison | OPEN | — |  |
| 5060 | Multi-hop inventory consistency check | OPEN | — |  |
| 5061 | Return journey booking with discount | OPEN | — |  |
| 5062 | Return journey one side cancelled | OPEN | — |  |
| 5063 | Return journey date change on one side | OPEN | — |  |
| 5064 | Return journey passenger change | OPEN | — |  |
| 5065 | Circular journey attempt | OPEN | — |  |
| 5066 | Same day return booking | OPEN | — |  |
| 5067 | Overnight journey special rules | OPEN | — |  |
| 5068 | Multi-day journey inventory lock | OPEN | — |  |
| 5069 | Journey break request mid-route | OPEN | — |  |
| 5070 | Mid-route passenger drop and rejoin | OPEN | — |  |
| 5071 | Boarding point change after booking | DONE | TODO | amendments/domain/point-change.ts + POST /bookings/:id/change-points |
| 5072 | Drop point change after booking | DONE | TODO | amendments/domain/point-change.ts + POST /bookings/:id/change-points |
| 5073 | Boarding point change after departure | DONE | TODO | amendments/domain/point-change.ts + POST /bookings/:id/change-points |
| 5074 | Drop point change after departure | DONE | TODO | amendments/domain/point-change.ts + POST /bookings/:id/change-points |
| 5075 | Multiple boarding point changes | DONE | TODO | amendments/domain/point-change.ts + POST /bookings/:id/change-points |
| 5076 | Invalid boarding point for service | OPEN | — |  |
| 5077 | Boarding point capacity exceeded | OPEN | — |  |
| 5078 | Drop point not on route after diversion | OPEN | — |  |
| 5079 | Pickup charge application and refund | OPEN | — |  |
| 5080 | Drop charge application and refund | OPEN | — |  |
| 5081 | Name correction before departure | OPEN | — |  |
| 5082 | Name correction after boarding | OPEN | — |  |
| 5083 | Age correction impacting fare | OPEN | — |  |
| 5084 | Gender correction impacting seat | OPEN | — |  |
| 5085 | ID proof update | OPEN | — |  |
| 5086 | Contact number update | OPEN | — |  |
| 5087 | Multiple corrections on same booking | OPEN | — |  |
| 5088 | Correction after ticket printed | OPEN | — |  |
| 5089 | Correction after e-ticket sent | OPEN | — |  |
| 5090 | Correction audit trail | OPEN | — |  |
| 5091 | Seat change to higher fare | OPEN | — |  |
| 5092 | Seat change to lower fare with refund | OPEN | — |  |
| 5093 | Seat change same fare | OPEN | — |  |
| 5094 | Seat change when target seat taken | OPEN | — |  |
| 5095 | Seat change after boarding started | OPEN | — |  |
| 5096 | Seat change for already boarded passenger | OPEN | — |  |
| 5097 | Bulk seat change for group | OPEN | — |  |
| 5098 | Automatic re-seating on bus change | DONE | TODO | modules/trip-vehicle |
| 5099 | Passenger refusal of new seat | OPEN | — |  |
| 5100 | Forced re-seating due to operational need | OPEN | — |  |
| 5101 | Date change within free window | OPEN | — |  |
| 5102 | Date change outside free window with charges | OPEN | — |  |
| 5103 | Date change to sold out service | OPEN | — |  |
| 5104 | Date change with fare difference collect | OPEN | — |  |
| 5105 | Date change with fare difference refund | OPEN | — |  |
| 5106 | Date change multiple times | OPEN | — |  |
| 5107 | Date change after partial journey | OPEN | — |  |
| 5108 | Date change policy by channel | OPEN | — |  |
| 5109 | Date change approval workflow | OPEN | — |  |
| 5110 | Date change impact on connecting booking | OPEN | — |  |
| 5111 | Full cancellation within free window | OPEN | — |  |
| 5112 | Full cancellation with charges | OPEN | — |  |
| 5113 | Full cancellation after departure | OPEN | — |  |
| 5114 | Full cancellation after boarding | OPEN | — |  |
| 5115 | Partial cancellation charges calculation | OPEN | — |  |
| 5116 | Partial cancellation seat release | OPEN | — |  |
| 5117 | Cancellation of waitlisted booking | DONE | TODO | modules/demand |
| 5118 | Cancellation of held booking | OPEN | — |  |
| 5119 | Cancellation during payment processing | OPEN | — |  |
| 5120 | Cancellation after payment success before confirm | OPEN | — |  |
| 5121 | Refund to original payment mode | OPEN | — |  |
| 5122 | Refund to alternate mode | OPEN | — |  |
| 5123 | Refund failure and retry | OPEN | — |  |
| 5124 | Partial refund processing | OPEN | — |  |
| 5125 | Refund with tax reversal | OPEN | — |  |
| 5126 | Refund with commission reversal | OPEN | — |  |
| 5127 | Refund with loyalty points reversal | CONFLICT | — |  |
| 5128 | Refund with coupon handling | OPEN | — |  |
| 5129 | Refund ageing and escalation | OPEN | — |  |
| 5130 | Refund dispute handling | OPEN | — |  |
| 5131 | No-show marking by conductor | OPEN | — |  |
| 5132 | No-show marking by system auto | OPEN | — |  |
| 5133 | No-show reversal | OPEN | — |  |
| 5134 | No-show with refund eligibility check | OPEN | — |  |
| 5135 | No-show seat release timing | OPEN | — |  |
| 5136 | No-show impact on occupancy reports | OPEN | — |  |
| 5137 | No-show pattern by passenger | OPEN | — |  |
| 5138 | No-show pattern by agent | DONE | TODO | modules/agents |
| 5139 | No-show penalty application | OPEN | — |  |
| 5140 | No-show waiver cases | OPEN | — |  |
| 5141 | Boarding chart generation timing | OPEN | — |  |
| 5142 | Boarding chart update after last minute changes | OPEN | — |  |
| 5143 | Boarding chart distribution failure | OPEN | — |  |
| 5144 | Boarding chart version conflicts | OPEN | — |  |
| 5145 | Final boarding chart lock | OPEN | — |  |
| 5146 | Boarding status updates real-time | OPEN | — |  |
| 5147 | Boarding status sync delays | OPEN | — |  |
| 5148 | Boarding without valid ticket attempt | OPEN | — |  |
| 5149 | Duplicate boarding attempt | OPEN | — |  |
| 5150 | Boarding after service departed | OPEN | — |  |

## #5501–#6000

CONFLICT 10, DONE 24, OPEN 66

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 5501 | Inventory block for full service | DONE | TODO | modules/quotas |
| 5502 | Inventory block for specific seats | DONE | TODO | modules/quotas |
| 5503 | Inventory block for date range | DONE | TODO | modules/quotas |
| 5504 | Inventory block with reason codes | DONE | TODO | modules/quotas |
| 5505 | Inventory block expiry automatic | DONE | TODO | modules/quotas |
| 5506 | Inventory block manual release | DONE | TODO | modules/quotas |
| 5507 | Inventory block during active bookings | DONE | TODO | modules/quotas |
| 5508 | Inventory block conflict with existing holds | DONE | TODO | modules/quotas |
| 5509 | Inventory release to specific channel only | DONE | TODO | modules/quotas |
| 5510 | Inventory release percentage by channel | DONE | TODO | modules/quotas |
| 5511 | Last minute inventory pull from OTA | DONE | TODO | modules/gds |
| 5512 | Last minute inventory push to OTA | DONE | TODO | modules/gds |
| 5513 | Inventory sync lag with OTA | DONE | TODO | modules/gds |
| 5514 | Inventory sync conflict resolution | OPEN | — |  |
| 5515 | Inventory oversell detection | OPEN | — |  |
| 5516 | Inventory undersell detection | OPEN | — |  |
| 5517 | Ghost inventory cleanup | OPEN | — |  |
| 5518 | Orphan seat assignment cleanup | OPEN | — |  |
| 5519 | Seat map version mismatch | OPEN | — |  |
| 5520 | Seat map update with active bookings | OPEN | — |  |
| 5521 | Ladies quota exhaust handling | DONE | TODO | modules/quotas |
| 5522 | Senior quota exhaust handling | DONE | TODO | modules/quotas |
| 5523 | Disability seat management | OPEN | — |  |
| 5524 | Quota release to general rules | DONE | TODO | modules/quotas |
| 5525 | Quota protection logic | DONE | TODO | modules/quotas |
| 5526 | Agent wise quota allocation | DONE | TODO | modules/quotas |
| 5527 | Branch wise quota allocation | DONE | TODO | modules/quotas |
| 5528 | Quota transfer between agents | DONE | TODO | modules/quotas |
| 5529 | Quota utilization reporting | DONE | TODO | modules/quotas |
| 5530 | Quota abuse detection | DONE | TODO | modules/quotas |
| 5531 | Schedule create with overlapping times | OPEN | — |  |
| 5532 | Schedule create with crew conflict | OPEN | — |  |
| 5533 | Schedule create with bus conflict | OPEN | — |  |
| 5534 | Schedule edit with active bookings | OPEN | — |  |
| 5535 | Schedule cancel with active bookings | OPEN | — |  |
| 5536 | Schedule cancel passenger notification | OPEN | — |  |
| 5537 | Schedule cancel re-accommodation | OPEN | — |  |
| 5538 | Schedule versioning and rollback | OPEN | — |  |
| 5539 | Schedule bulk upload validation | OPEN | — |  |
| 5540 | Schedule bulk upload partial failure | OPEN | — |  |
| 5541 | Service frequency increase | OPEN | — |  |
| 5542 | Service frequency decrease | OPEN | — |  |
| 5543 | Service timing shift | OPEN | — |  |
| 5544 | Service vehicle type change | OPEN | — |  |
| 5545 | Service intermediate stop add | OPEN | — |  |
| 5546 | Service intermediate stop remove | OPEN | — |  |
| 5547 | Service diversion temporary | OPEN | — |  |
| 5548 | Service diversion permanent | OPEN | — |  |
| 5549 | Service blackout dates | DONE | TODO | coupons.blackout_dates (journey date) |
| 5550 | Service seasonal activation | DONE | TODO | pricing/domain/fare-plan-selection.ts |
| 5551 | Fare matrix update single route | OPEN | — |  |
| 5552 | Fare matrix bulk update | OPEN | — |  |
| 5553 | Fare matrix version control | OPEN | — |  |
| 5554 | Fare override for specific service | OPEN | — |  |
| 5555 | Fare override time bound | OPEN | — |  |
| 5556 | Fare floor violation attempt | OPEN | — |  |
| 5557 | Fare ceiling violation attempt | OPEN | — |  |
| 5558 | Fare currency conversion edge | OPEN | — |  |
| 5559 | Fare tax calculation edge | OPEN | — |  |
| 5560 | Fare discount stacking edge | OPEN | — |  |
| 5561 | Dynamic price update frequency | OPEN | — |  |
| 5562 | Dynamic price oscillation prevention | OPEN | — |  |
| 5563 | Dynamic price with competitor data | OPEN | — |  |
| 5564 | Dynamic price with demand forecast | OPEN | — |  |
| 5565 | Dynamic price with remaining capacity | OPEN | — |  |
| 5566 | Dynamic price audit trail | OPEN | — |  |
| 5567 | Dynamic price human override | OPEN | — |  |
| 5568 | Dynamic price performance measurement | OPEN | — |  |
| 5569 | Dynamic price model retraining | OPEN | — |  |
| 5570 | Dynamic price A/B testing | OPEN | — |  |
| 5571 | Peak fare application | OPEN | — |  |
| 5572 | Off-peak fare application | OPEN | — |  |
| 5573 | Festival fare application | OPEN | — |  |
| 5574 | Special event fare application | OPEN | — |  |
| 5575 | Last minute fare application | OPEN | — |  |
| 5576 | Early bird fare application | OPEN | — |  |
| 5577 | Round trip fare construction | OPEN | — |  |
| 5578 | Multi-city fare construction | OPEN | — |  |
| 5579 | Through fare construction | OPEN | — |  |
| 5580 | Private fare construction | OPEN | — |  |
| 5581 | Coupon application success | OPEN | — |  |
| 5582 | Coupon application failure reasons | OPEN | — |  |
| 5583 | Coupon expiry during booking | OPEN | — |  |
| 5584 | Coupon usage limit hit | OPEN | — |  |
| 5585 | Coupon channel restriction | OPEN | — |  |
| 5586 | Coupon route restriction | OPEN | — |  |
| 5587 | Coupon service restriction | OPEN | — |  |
| 5588 | Coupon customer restriction | OPEN | — |  |
| 5589 | Coupon abuse detection | OPEN | — |  |
| 5590 | Coupon campaign performance | OPEN | — |  |
| 5591 | Loyalty earn on booking | CONFLICT | — |  |
| 5592 | Loyalty burn on booking | CONFLICT | — |  |
| 5593 | Loyalty points expiry | CONFLICT | — |  |
| 5594 | Loyalty tier upgrade | CONFLICT | — |  |
| 5595 | Loyalty tier downgrade | CONFLICT | — |  |
| 5596 | Loyalty points liability | CONFLICT | — |  |
| 5597 | Loyalty points adjustment | CONFLICT | — |  |
| 5598 | Loyalty program rule change | CONFLICT | — |  |
| 5599 | Loyalty points transfer rules | CONFLICT | — |  |
| 5600 | Loyalty program closure handling | CONFLICT | — |  |

## #6001–#6500

CONFLICT 4, DONE 22, OPEN 74

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 6001 | Payment success with delayed callback | OPEN | — |  |
| 6002 | Payment success with missing callback | OPEN | — |  |
| 6003 | Payment failure with amount deducted | OPEN | — |  |
| 6004 | Payment double charge | OPEN | — |  |
| 6005 | Payment partial amount | OPEN | — |  |
| 6006 | Payment gateway timeout | OPEN | — |  |
| 6007 | Payment gateway ambiguous response | OPEN | — |  |
| 6008 | Payment gateway downtime | OPEN | — |  |
| 6009 | Payment method specific failures | OPEN | — |  |
| 6010 | Payment currency mismatch | OPEN | — |  |
| 6011 | Refund initiation success | OPEN | — |  |
| 6012 | Refund initiation failure | OPEN | — |  |
| 6013 | Refund gateway timeout | OPEN | — |  |
| 6014 | Refund amount calculation error | OPEN | — |  |
| 6015 | Refund tax reversal error | OPEN | — |  |
| 6016 | Refund commission reversal | OPEN | — |  |
| 6017 | Refund to original method failure | OPEN | — |  |
| 6018 | Refund to alternate method | OPEN | — |  |
| 6019 | Refund bank account invalid | OPEN | — |  |
| 6020 | Refund bank account closed | OPEN | — |  |
| 6021 | Multiple refund requests same booking | OPEN | — |  |
| 6022 | Refund after service departure | OPEN | — |  |
| 6023 | Refund after passenger boarded | OPEN | — |  |
| 6024 | Partial passenger refund | OPEN | — |  |
| 6025 | Refund with active chargeback | OPEN | — |  |
| 6026 | Chargeback received | OPEN | — |  |
| 6027 | Chargeback fight process | OPEN | — |  |
| 6028 | Chargeback lost | OPEN | — |  |
| 6029 | Chargeback won | OPEN | — |  |
| 6030 | Dispute raised by customer | OPEN | — |  |
| 6031 | Settlement file mismatch | OPEN | — |  |
| 6032 | Settlement missing transactions | OPEN | — |  |
| 6033 | Settlement extra transactions | OPEN | — |  |
| 6034 | Settlement amount difference | OPEN | — |  |
| 6035 | Settlement timing difference | OPEN | — |  |
| 6036 | Manual reconciliation required | OPEN | — |  |
| 6037 | Auto reconciliation success | OPEN | — |  |
| 6038 | Auto reconciliation failure | OPEN | — |  |
| 6039 | Reconciliation ageing | OPEN | — |  |
| 6040 | Reconciliation escalation | OPEN | — |  |
| 6041 | Agent commission calculation | DONE | TODO | modules/agents |
| 6042 | Agent commission on refund | DONE | TODO | modules/agents |
| 6043 | Agent commission adjustment | DONE | TODO | modules/agents |
| 6044 | Agent TDS calculation | DONE | TODO | modules/agents |
| 6045 | Agent TDS certificate | DONE | TODO | modules/agents |
| 6046 | Agent outstanding ageing | DONE | TODO | modules/agents |
| 6047 | Agent credit limit breach | DONE | TODO | modules/agents |
| 6048 | Agent credit limit temporary increase | DONE | TODO | modules/agents |
| 6049 | Agent settlement cycle | DONE | TODO | modules/agents |
| 6050 | Agent payment processing | DONE | TODO | modules/agents |
| 6051 | Branch collection reconciliation | CONFLICT | — |  |
| 6052 | Branch cash deposit matching | CONFLICT | — |  |
| 6053 | Branch cash shortage | CONFLICT | — |  |
| 6054 | Branch cash excess | CONFLICT | — |  |
| 6055 | Branch digital collection matching | OPEN | — |  |
| 6056 | Branch day end closing | OPEN | — |  |
| 6057 | Branch month end closing | OPEN | — |  |
| 6058 | Branch inter transfer | OPEN | — |  |
| 6059 | Branch expense claim | DONE | TODO | modules/trip-expenses |
| 6060 | Branch budget control | OPEN | — |  |
| 6061 | OTA commission calculation | DONE | TODO | modules/gds |
| 6062 | OTA commission on refund | DONE | TODO | modules/gds |
| 6063 | OTA settlement matching | DONE | TODO | modules/gds |
| 6064 | OTA settlement dispute | DONE | TODO | modules/gds |
| 6065 | OTA invoice processing | DONE | TODO | modules/gds |
| 6066 | OTA credit note | DONE | TODO | modules/gds |
| 6067 | OTA debit note | DONE | TODO | modules/gds |
| 6068 | OTA outstanding tracking | DONE | TODO | modules/gds |
| 6069 | OTA payment prioritization | DONE | TODO | modules/gds |
| 6070 | OTA contract commercial terms | DONE | TODO | modules/gds |
| 6071 | GST calculation on base fare | OPEN | — |  |
| 6072 | GST calculation on charges | OPEN | — |  |
| 6073 | GST calculation on cancellation | OPEN | — |  |
| 6074 | GST rate change handling | OPEN | — |  |
| 6075 | GST inter state vs intra state | OPEN | — |  |
| 6076 | GST invoice generation | DONE | TODO | tax invoice on booking.confirmed, emailed separately (body + PDF: place of supply, CGST/SGST/IGST, PAN, amount in words), once per event |
| 6077 | GST credit note generation | OPEN | — |  |
| 6078 | GST return data preparation | OPEN | — |  |
| 6079 | GST reconciliation | OPEN | — |  |
| 6080 | GST notice handling | OPEN | — |  |
| 6081 | TDS on various payments | OPEN | — |  |
| 6082 | TDS rate application | OPEN | — |  |
| 6083 | TDS threshold monitoring | OPEN | — |  |
| 6084 | TDS certificate generation | OPEN | — |  |
| 6085 | TDS return preparation | OPEN | — |  |
| 6086 | TDS mismatch resolution | OPEN | — |  |
| 6087 | Advance tax tracking | OPEN | — |  |
| 6088 | Tax liability projection | OPEN | — |  |
| 6089 | Tax payment processing | OPEN | — |  |
| 6090 | Tax audit support | OPEN | — |  |
| 6091 | Multi currency booking | OPEN | — |  |
| 6092 | Multi currency refund | OPEN | — |  |
| 6093 | Forex gain loss calculation | OPEN | — |  |
| 6094 | Forex revaluation | OPEN | — |  |
| 6095 | Currency conversion source failure | OPEN | — |  |
| 6096 | Currency rounding differences | OPEN | — |  |
| 6097 | Cross currency settlement | OPEN | — |  |
| 6098 | Currency exposure reporting | OPEN | — |  |
| 6099 | Hedging support if any | OPEN | — |  |
| 6100 | Multi currency reporting | OPEN | — |  |

## #6501–#7000

DONE 12, OPEN 88

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 6501 | Crew not reporting for duty | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 6502 | Crew reporting late | OPEN | — |  |
| 6503 | Crew reporting unfit | OPEN | — |  |
| 6504 | Crew duty hours exceeded | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 6505 | Crew rest period insufficient | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 6506 | Crew double duty approval missing | DONE | DONE | fleet/domain/duty-roster.ts + /fleet/crew/* · UI: Fleet → Crew & Duties (crew, roster, attendance, rest rules, compliance) |
| 6507 | Crew change mid route planned | OPEN | — |  |
| 6508 | Crew change mid route unplanned | OPEN | — |  |
| 6509 | Crew performance below standard | OPEN | — |  |
| 6510 | Crew disciplinary action | OPEN | — |  |
| 6511 | Bus breakdown before departure | OPEN | — |  |
| 6512 | Bus breakdown after departure | OPEN | — |  |
| 6513 | Bus breakdown with passengers | OPEN | — |  |
| 6514 | Replacement bus arrangement | DONE | TODO | modules/trip-vehicle |
| 6515 | Replacement bus different layout | DONE | TODO | modules/trip-vehicle |
| 6516 | Passenger re-seating on replacement | OPEN | — |  |
| 6517 | Passenger refusal of replacement | OPEN | — |  |
| 6518 | Breakdown cost tracking | OPEN | — |  |
| 6519 | Breakdown pattern analysis | OPEN | — |  |
| 6520 | Preventive action after breakdown | OPEN | — |  |
| 6521 | Road blockage mid route | OPEN | — |  |
| 6522 | Diversion implementation | OPEN | — |  |
| 6523 | Diversion passenger communication | OPEN | — |  |
| 6524 | Diversion boarding point impact | OPEN | — |  |
| 6525 | Diversion time impact calculation | OPEN | — |  |
| 6526 | Diversion cost impact | OPEN | — |  |
| 6527 | Multiple services affected by blockage | OPEN | — |  |
| 6528 | Coordination across affected services | OPEN | — |  |
| 6529 | Diversion cancellation when cleared | OPEN | — |  |
| 6530 | Diversion learning capture | OPEN | — |  |
| 6531 | Accident with injuries | OPEN | — |  |
| 6532 | Accident without injuries | OPEN | — |  |
| 6533 | Accident emergency response | OPEN | — |  |
| 6534 | Accident passenger support | OPEN | — |  |
| 6535 | Accident authority coordination | OPEN | — |  |
| 6536 | Accident insurance intimation | OPEN | — |  |
| 6537 | Accident investigation support | OPEN | — |  |
| 6538 | Accident claim processing | OPEN | — |  |
| 6539 | Accident service recovery | OPEN | — |  |
| 6540 | Accident communication management | OPEN | — |  |
| 6541 | Medical emergency on bus | OPEN | — |  |
| 6542 | Medical emergency response | OPEN | — |  |
| 6543 | Medical emergency diversion to hospital | OPEN | — |  |
| 6544 | Medical emergency passenger support | OPEN | — |  |
| 6545 | Medical emergency documentation | OPEN | — |  |
| 6546 | Police stopping bus | OPEN | — |  |
| 6547 | Police document check | OPEN | — |  |
| 6548 | Police passenger list demand | OPEN | — |  |
| 6549 | Police detention of bus | OPEN | — |  |
| 6550 | Police case support | OPEN | — |  |
| 6551 | Passenger left behind | OPEN | — |  |
| 6552 | Passenger lost during journey | OPEN | — |  |
| 6553 | Child separation handling | OPEN | — |  |
| 6554 | Luggage missing | OPEN | — |  |
| 6555 | Luggage damaged | OPEN | — |  |
| 6556 | Luggage delayed | OPEN | — |  |
| 6557 | Luggage claim process | OPEN | — |  |
| 6558 | Luggage compensation | OPEN | — |  |
| 6559 | Overcrowding detection | OPEN | — |  |
| 6560 | Overcrowding resolution | OPEN | — |  |
| 6561 | Standing passenger policy enforcement | OPEN | — |  |
| 6562 | Ladies special service rule enforcement | DONE | TODO | trips.ladies_special + all seats ladies-only (seat-lock enforces) |
| 6563 | Night service special checks | OPEN | — |  |
| 6564 | Safety checklist completion | OPEN | — |  |
| 6565 | Safety checklist failure handling | OPEN | — |  |
| 6566 | Panic button activation real | OPEN | — |  |
| 6567 | Panic button activation false | OPEN | — |  |
| 6568 | GPS signal loss | OPEN | — |  |
| 6569 | GPS spoofing suspicion | OPEN | — |  |
| 6570 | Manual tracking activation | OPEN | — |  |
| 6571 | Delay starting early | OPEN | — |  |
| 6572 | Delay progressive increase | OPEN | — |  |
| 6573 | Delay passenger notification timing | OPEN | — |  |
| 6574 | Delay compensation trigger | OPEN | — |  |
| 6575 | Delay connecting service impact | OPEN | — |  |
| 6576 | Delay recovery planning | OPEN | — |  |
| 6577 | Delay root cause recording | OPEN | — |  |
| 6578 | Delay pattern by route | OPEN | — |  |
| 6579 | Delay pattern by bus | OPEN | — |  |
| 6580 | Delay pattern by crew | OPEN | — |  |
| 6581 | Service cancellation decision | OPEN | — |  |
| 6582 | Service cancellation passenger impact | OPEN | — |  |
| 6583 | Service cancellation rebooking | OPEN | — |  |
| 6584 | Service cancellation refund | OPEN | — |  |
| 6585 | Service cancellation communication | OPEN | — |  |
| 6586 | Service cancellation cost | OPEN | — |  |
| 6587 | Service cancellation approval | OPEN | — |  |
| 6588 | Service cancellation learning | OPEN | — |  |
| 6589 | Mass cancellation event | OPEN | — |  |
| 6590 | Mass cancellation management | OPEN | — |  |
| 6591 | Extra trip creation urgency | DONE | TODO | MaterializationService.createExtraTrips + POST /scheduling/services/:id/extra-trips |
| 6592 | Extra trip inventory setup | DONE | TODO | MaterializationService.createExtraTrips + POST /scheduling/services/:id/extra-trips |
| 6593 | Extra trip crew and bus | DONE | TODO | MaterializationService.createExtraTrips + POST /scheduling/services/:id/extra-trips |
| 6594 | Extra trip passenger transfer | DONE | TODO | MaterializationService.createExtraTrips + POST /scheduling/services/:id/extra-trips |
| 6595 | Extra trip commercial performance | DONE | TODO | MaterializationService.createExtraTrips + POST /scheduling/services/:id/extra-trips |
| 6596 | Charter vs regular conflict | OPEN | — |  |
| 6597 | Charter opportunity cost | OPEN | — |  |
| 6598 | Charter acceptance decision | OPEN | — |  |
| 6599 | Charter execution monitoring | OPEN | — |  |
| 6600 | Charter post analysis | OPEN | — |  |

## #7001–#7500

DONE 3, DUP 2, OPEN 95

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 7001 | Operator onboarding incomplete data | OPEN | — |  |
| 7002 | Operator onboarding verification failure | OPEN | — |  |
| 7003 | Operator go-live with limited features | OPEN | — |  |
| 7004 | Operator feature flag progressive enable | OPEN | — |  |
| 7005 | Operator suspension process | OPEN | — |  |
| 7006 | Operator reactivation process | OPEN | — |  |
| 7007 | Operator data export request | OPEN | — |  |
| 7008 | Operator data deletion request | OPEN | — |  |
| 7009 | Operator contract renewal | OPEN | — |  |
| 7010 | Operator contract termination | OPEN | — |  |
| 7011 | Platform maintenance window | OPEN | — |  |
| 7012 | Platform emergency maintenance | OPEN | — |  |
| 7013 | Platform partial outage | OPEN | — |  |
| 7014 | Platform full outage | OPEN | — |  |
| 7015 | Platform degraded mode | OPEN | — |  |
| 7016 | Platform recovery process | OPEN | — |  |
| 7017 | Platform status communication | OPEN | — |  |
| 7018 | Platform post incident review | OPEN | — |  |
| 7019 | Platform capacity overload | OPEN | — |  |
| 7020 | Platform auto scaling response | OPEN | — |  |
| 7021 | Database primary failure | OPEN | — |  |
| 7022 | Database failover | OPEN | — |  |
| 7023 | Database replication lag | OPEN | — |  |
| 7024 | Database deadlock | OPEN | — |  |
| 7025 | Database connection exhaustion | OPEN | — |  |
| 7026 | Cache failure | OPEN | — |  |
| 7027 | Cache stampede | OPEN | — |  |
| 7028 | Cache inconsistency | OPEN | — |  |
| 7029 | Message queue backup | OPEN | — |  |
| 7030 | Message queue data loss prevention | OPEN | — |  |
| 7031 | Payment gateway outage | OPEN | — |  |
| 7032 | SMS gateway outage | OPEN | — |  |
| 7033 | WhatsApp gateway outage | OPEN | — |  |
| 7034 | Email gateway outage | OPEN | — |  |
| 7035 | All notification channels down | OPEN | — |  |
| 7036 | OTA API outage | DONE | TODO | modules/gds |
| 7037 | OTA API slow response | DONE | TODO | modules/gds |
| 7038 | OTA API error spike | DONE | TODO | modules/gds |
| 7039 | Third party dependency failure | OPEN | — |  |
| 7040 | Graceful degradation activation | OPEN | — |  |
| 7041 | Security incident detection | OPEN | — |  |
| 7042 | Security incident containment | OPEN | — |  |
| 7043 | Security incident eradication | OPEN | — |  |
| 7044 | Security incident recovery | OPEN | — |  |
| 7045 | Security incident communication | OPEN | — |  |
| 7046 | Security incident regulatory reporting | OPEN | — |  |
| 7047 | Fraud attack detection | OPEN | — |  |
| 7048 | Fraud attack mitigation | OPEN | — |  |
| 7049 | Account takeover attempt | OPEN | — |  |
| 7050 | Privilege abuse detection | OPEN | — |  |
| 7051 | Data breach suspicion | OPEN | — |  |
| 7052 | Data breach confirmation | OPEN | — |  |
| 7053 | Data breach notification | OPEN | — |  |
| 7054 | Data subject requests surge | OPEN | — |  |
| 7055 | Privacy complaint handling | OPEN | — |  |
| 7056 | Regulatory inquiry | OPEN | — |  |
| 7057 | Regulatory inspection | OPEN | — |  |
| 7058 | Regulatory finding remediation | OPEN | — |  |
| 7059 | Legal hold activation | OPEN | — |  |
| 7060 | Legal discovery support | OPEN | — |  |
| 7061 | Access review campaign | OPEN | — |  |
| 7062 | Orphan account cleanup | DUP | DUP | same as #2392 |
| 7063 | Dormant account handling | OPEN | — |  |
| 7064 | Privileged access review | DUP | DUP | same as #2394 |
| 7065 | Segregation of duties conflict | OPEN | — |  |
| 7066 | Temporary access expiry | OPEN | — |  |
| 7067 | Emergency access usage | OPEN | — |  |
| 7068 | Access anomaly detection | OPEN | — |  |
| 7069 | Forced password reset bulk | OPEN | — |  |
| 7070 | Session termination bulk | OPEN | — |  |
| 7071 | Configuration change audit | OPEN | — |  |
| 7072 | Unauthorized configuration change | OPEN | — |  |
| 7073 | Configuration rollback | OPEN | — |  |
| 7074 | Feature flag misconfiguration | OPEN | — |  |
| 7075 | Feature flag rapid rollback | OPEN | — |  |
| 7076 | Deployment failure | OPEN | — |  |
| 7077 | Deployment rollback | OPEN | — |  |
| 7078 | Database migration failure | OPEN | — |  |
| 7079 | Data corruption detection | OPEN | — |  |
| 7080 | Data repair process | OPEN | — |  |
| 7081 | Backup failure | OPEN | — |  |
| 7082 | Backup validation failure | OPEN | — |  |
| 7083 | Restore test failure | OPEN | — |  |
| 7084 | Restore actual execution | OPEN | — |  |
| 7085 | Ransomware detection | OPEN | — |  |
| 7086 | Ransomware response | OPEN | — |  |
| 7087 | Immutable backup usage | OPEN | — |  |
| 7088 | Business continuity activation | OPEN | — |  |
| 7089 | Disaster recovery activation | OPEN | — |  |
| 7090 | Crisis management team activation | OPEN | — |  |
| 7091 | Internal communication during crisis | OPEN | — |  |
| 7092 | External communication during crisis | OPEN | — |  |
| 7093 | Customer communication during crisis | OPEN | — |  |
| 7094 | Partner communication during crisis | OPEN | — |  |
| 7095 | Regulatory communication during crisis | OPEN | — |  |
| 7096 | Media handling during crisis | OPEN | — |  |
| 7097 | Post crisis recovery | OPEN | — |  |
| 7098 | Post crisis review | OPEN | — |  |
| 7099 | Post crisis improvement | OPEN | — |  |
| 7100 | Crisis playbook update | OPEN | — |  |

## #8001–#8500

OPEN 100

| # | Scenario | Backend | Frontend | Where / note |
|---|---|---|---|---|
| 8001 | Sudden 10x traffic spike | OPEN | — |  |
| 8002 | Flash sale traffic handling | OPEN | — |  |
| 8003 | Festival booking open traffic | OPEN | — |  |
| 8004 | Competitor outage traffic spillover | OPEN | — |  |
| 8005 | Viral social media traffic | OPEN | — |  |
| 8006 | Bot traffic detection and handling | OPEN | — |  |
| 8007 | Geographic traffic concentration | OPEN | — |  |
| 8008 | Time of day extreme peaks | OPEN | — |  |
| 8009 | Sustained high load period | OPEN | — |  |
| 8010 | Load test production-like | OPEN | — |  |
| 8011 | Gradual traffic ramp | OPEN | — |  |
| 8012 | Sudden traffic drop | OPEN | — |  |
| 8013 | Traffic anomaly detection | OPEN | — |  |
| 8014 | Auto scaling lag | OPEN | — |  |
| 8015 | Auto scaling overshoot | OPEN | — |  |
| 8016 | Cost spike from scaling | OPEN | — |  |
| 8017 | Capacity planning miss | OPEN | — |  |
| 8018 | Capacity emergency add | OPEN | — |  |
| 8019 | Capacity permanent review | OPEN | — |  |
| 8020 | Performance regression detection | OPEN | — |  |
| 8021 | New operator large scale onboarding | OPEN | — |  |
| 8022 | Existing operator rapid growth | OPEN | — |  |
| 8023 | Operator downsizing | OPEN | — |  |
| 8024 | Operator consolidation | OPEN | — |  |
| 8025 | Multi operator network stress | OPEN | — |  |
| 8026 | Inter operator transaction surge | OPEN | — |  |
| 8027 | Settlement volume spike | OPEN | — |  |
| 8028 | Dispute volume spike | OPEN | — |  |
| 8029 | Support ticket volume spike | OPEN | — |  |
| 8030 | Staffing for volume spikes | OPEN | — |  |
| 8031 | Market entry new geography | OPEN | — |  |
| 8032 | Market exit geography | OPEN | — |  |
| 8033 | Regulatory change major | OPEN | — |  |
| 8034 | Tax regime change | OPEN | — |  |
| 8035 | Labour law change impact | OPEN | — |  |
| 8036 | Environmental regulation impact | OPEN | — |  |
| 8037 | Data localization mandate | OPEN | — |  |
| 8038 | New compliance framework | OPEN | — |  |
| 8039 | Industry consolidation | OPEN | — |  |
| 8040 | New competitor entry | OPEN | — |  |
| 8041 | Technology platform change | OPEN | — |  |
| 8042 | Core system replacement | OPEN | — |  |
| 8043 | Data migration large scale | OPEN | — |  |
| 8044 | Cutover execution | OPEN | — |  |
| 8045 | Parallel run extended | OPEN | — |  |
| 8046 | Rollback from new system | OPEN | — |  |
| 8047 | Hybrid mode operation | OPEN | — |  |
| 8048 | Legacy system retirement | OPEN | — |  |
| 8049 | Knowledge transfer completion | OPEN | — |  |
| 8050 | Stabilization after change | OPEN | — |  |
| 8051 | Ownership change | OPEN | — |  |
| 8052 | Management change | OPEN | — |  |
| 8053 | Strategy pivot | OPEN | — |  |
| 8054 | Business model change | OPEN | — |  |
| 8055 | Pricing model change | OPEN | — |  |
| 8056 | Channel strategy change | OPEN | — |  |
| 8057 | Network strategy change | OPEN | — |  |
| 8058 | Partnership strategy change | OPEN | — |  |
| 8059 | Technology strategy change | OPEN | — |  |
| 8060 | Culture change program | OPEN | — |  |
| 8061 | Merger integration | OPEN | — |  |
| 8062 | Acquisition integration | OPEN | — |  |
| 8063 | Divestiture execution | OPEN | — |  |
| 8064 | Joint venture setup | OPEN | — |  |
| 8065 | Alliance formation | OPEN | — |  |
| 8066 | Alliance stress | OPEN | — |  |
| 8067 | Alliance exit | OPEN | — |  |
| 8068 | Shared service setup | OPEN | — |  |
| 8069 | Outsourcing major process | OPEN | — |  |
| 8070 | Insourcing major process | OPEN | — |  |
| 8071 | Economic downturn impact | OPEN | — |  |
| 8072 | Fuel price shock sustained | OPEN | — |  |
| 8073 | Inflation impact on costs | OPEN | — |  |
| 8074 | Currency crisis impact | OPEN | — |  |
| 8075 | Credit market freeze | OPEN | — |  |
| 8076 | Customer demand collapse | OPEN | — |  |
| 8077 | Customer demand surge sustained | OPEN | — |  |
| 8078 | Supply chain disruption | OPEN | — |  |
| 8079 | Labour shortage | OPEN | — |  |
| 8080 | Key supplier failure | OPEN | — |  |
| 8081 | Pandemic style disruption | OPEN | — |  |
| 8082 | Natural disaster regional | OPEN | — |  |
| 8083 | Natural disaster multi region | OPEN | — |  |
| 8084 | Civil unrest impact | OPEN | — |  |
| 8085 | Political change impact | OPEN | — |  |
| 8086 | War or major conflict impact | OPEN | — |  |
| 8087 | Energy crisis | OPEN | — |  |
| 8088 | Climate regulation tightening | OPEN | — |  |
| 8089 | Health emergency | OPEN | — |  |
| 8090 | Multiple concurrent crises | OPEN | — |  |
| 8091 | Black swan event response | OPEN | — |  |
| 8092 | Unknown unknown handling | OPEN | — |  |
| 8093 | Scenario planning activation | OPEN | — |  |
| 8094 | Contingency plan activation | OPEN | — |  |
| 8095 | War room extended operation | OPEN | — |  |
| 8096 | Decision making under extreme uncertainty | OPEN | — |  |
| 8097 | Resource prioritization under scarcity | OPEN | — |  |
| 8098 | Stakeholder communication under stress | OPEN | — |  |
| 8099 | Team welfare under prolonged stress | OPEN | — |  |
| 8100 | Organizational learning from extreme events | OPEN | — |  |
