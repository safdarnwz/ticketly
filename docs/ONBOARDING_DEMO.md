# Operator onboarding — live run 2026-09-25T07:25:17.169Z
API: http://localhost:3100/api/v1

Flow: operator fills the public form → application is **pending** → super admin reviews →
**approve** (operator account + console created) / **hold** (stays pending, reason sent) /
**reject** (reason sent; can be **reopened**). Approval is blocked until KYC and bank details are valid.

## 0. Super admin signs in
_Only a platform admin can review applications._

   ✔ POST /auth/login  →  200  super admin login
      {"accessToken":"eyJhbGciOiJIUzI1…"}

## 1. Sharma Travels — clean application, approved
_Everything valid → approve → the operator signs in to its own console._

   ✔ POST /operators/apply  →  201  application submitted (public form, no login)
      {"applicationId":"01a0d774-4922-7671-9014-aa47f778da8b","status":"pending"}
   ✔ GET /admin/operator-applications/01a0d774-4922-7671-9014-aa47f778da8b  →  200  super admin opens the application
      {"status":"pending"}
      status = pending, company = undefined
   ✔ POST /admin/operator-applications/01a0d774-4922-7671-9014-aa47f778da8b/approve  →  200  approve
      {"tenantId":"01a0d774-4935-7e59-878f-848ca614629f","slug":"sharma-travels-bf5f3c","consoleUrl":"https://app.sharma-travels-bf5f3c.localhost"}
   ✔ POST /auth/login  →  200  operator signs in to its own console
      {"accessToken":"eyJhbGciOiJIUzI1…"}
   ✔ POST /admin/operator-applications/01a0d774-4922-7671-9014-aa47f778da8b/approve  →  422  approve
      “Cannot approve an application that is 'approved'. This operator is already live — suspend the operator instead.”
      ↳ approving twice is refused: an approved application is final.

## 2. Rathore Bus Service — put on hold, then approved
_Admin needs one more document: hold keeps it pending with a reason, later approved._

   ✔ POST /operators/apply  →  201  application submitted
      {"applicationId":"01a0d774-4a32-7b96-8c80-8d4355645290","status":"pending"}
   ✔ POST /admin/operator-applications/01a0d774-4a32-7b96-8c80-8d4355645290/hold  →  400  hold
      “Request validation failed”
      ↳ a hold / reject / reopen reason must be at least 10 characters.
   ✔ POST /admin/operator-applications/01a0d774-4a32-7b96-8c80-8d4355645290/hold  →  200  hold
      {"ok":true}
   ✔ GET /admin/operator-applications/01a0d774-4a32-7b96-8c80-8d4355645290  →  200  status after hold
      {"status":"pending"}
      status = pending (hold keeps it pending)
   ✔ POST /admin/operator-applications/01a0d774-4a32-7b96-8c80-8d4355645290/approve  →  200  approve
      {"tenantId":"01a0d774-4a50-737c-8248-a3e0be8b6529","slug":"rathore-bus-service-10cae9","consoleUrl":"https://app.rathore-bus-service-10cae9.localhost"}

## 3. Fake Travels — invalid GSTIN, rejected
_Approval is blocked by KYC checks; the admin rejects with a reason._

   ✔ POST /operators/apply  →  201  application submitted (the form accepts it; review catches it)
      {"applicationId":"01a0d774-4ace-7cb2-af56-a983cf50997c","status":"pending"}
   ✔ POST /admin/operator-applications/01a0d774-4ace-7cb2-af56-a983cf50997c/approve  →  422  approve
      “Cannot approve yet: GSTIN '12345' is not in a valid format”
   ✔ POST /admin/operator-applications/01a0d774-4ace-7cb2-af56-a983cf50997c/reject  →  200  reject
      {"ok":true}
   ✔ POST /admin/operator-applications/01a0d774-4ace-7cb2-af56-a983cf50997c/approve  →  422  approve
      “Cannot approve an application that is 'rejected'. Allowed only from: pending.”
      ↳ a rejected application cannot be approved; it must be reopened first.

## 4. Mismatch Motors — GSTIN belongs to a different PAN, left pending
_Characters 3–12 of a GSTIN are the PAN; a mismatch blocks approval._

   ✔ POST /operators/apply  →  201  application submitted
      {"applicationId":"01a0d774-4b42-7513-8f93-a3093ba0121f","status":"pending"}
   ✔ POST /admin/operator-applications/01a0d774-4b42-7513-8f93-a3093ba0121f/approve  →  422  approve
      “Cannot approve yet: GSTIN 08NPGCO3355Z1Z7 is not registered to PAN CISCO1274Z”
   ✔ POST /admin/operator-applications/01a0d774-4b42-7513-8f93-a3093ba0121f/hold  →  200  hold
      {"ok":true}

## 5. Duplicate applications — refused at the form
_The same email, mobile, GSTIN or PAN cannot apply while another application is pending or approved._

   ⏳ 429 Too Many Requests — the public form allows 5 applications a minute per IP. Waiting 42s…
   ✔ POST /operators/apply  →  409  same email as Sharma Travels
      “An application with this email is already pending or approved”
   ✔ POST /operators/apply  →  409  same mobile as Rathore
      “An application with this mobile is already pending or approved”
   ✔ POST /operators/apply  →  409  same GSTIN + PAN as Sharma
      “An application with this gst number is already pending or approved”
   ✔ POST /operators/apply  →  400  bad email and short password
      “Request validation failed”

## 6. Highway Kings — no bank account, pending
_Settlements need a bank account: approval stays blocked until it is added._

   ✔ POST /operators/apply  →  201  application submitted without bank details
      {"applicationId":"01a0d774-f3ed-71bd-a60e-a02a1edb0f03","status":"pending"}
   ✔ POST /admin/operator-applications/01a0d774-f3ed-71bd-a60e-a02a1edb0f03/approve  →  422  approve
      “Cannot approve yet: Bank account details are incomplete (needed for settlements)”

## 7. Night Rider Roadways — rejected
_Operator does not meet the platform requirements._

   ⏳ 429 Too Many Requests — the public form allows 5 applications a minute per IP. Waiting 59s…
   ✔ POST /operators/apply  →  201  application submitted
      {"applicationId":"01a0d775-dedd-757d-a24d-df3660de9d40","status":"pending"}
   ✔ POST /admin/operator-applications/01a0d775-dedd-757d-a24d-df3660de9d40/reject  →  200  reject
      {"ok":true}

## 8. Reopen Express — rejected, reopened, approved
_Mistakes happen: a rejected application can be reopened (with a reason) and approved._

   ✔ POST /operators/apply  →  201  application submitted
      {"applicationId":"01a0d775-df54-7050-9ffd-afa7b7ef5746","status":"pending"}
   ✔ POST /admin/operator-applications/01a0d775-df54-7050-9ffd-afa7b7ef5746/reject  →  200  reject
      {"ok":true}
   ✔ POST /admin/operator-applications/01a0d775-df54-7050-9ffd-afa7b7ef5746/reopen  →  200  reopen
      {"ok":true}
   ✔ POST /admin/operator-applications/01a0d775-df54-7050-9ffd-afa7b7ef5746/approve  →  200  approve
      {"tenantId":"01a0d775-df72-777c-8c36-32e4931a0784","slug":"reopen-express-30b5ed","consoleUrl":"https://app.reopen-express-30b5ed.localhost"}
   ✔ POST /auth/login  →  200  operator signs in to its own console
      {"accessToken":"eyJhbGciOiJIUzI1…"}

## 9. Golden Wheels — approved, suspended, re-activated
_After go-live, control moves to the operator itself: suspend / activate._

   ✔ POST /operators/apply  →  201  application submitted
      {"applicationId":"01a0d775-e080-7803-ad0b-4fb7f8d3b232","status":"pending"}
   ✔ POST /admin/operator-applications/01a0d775-e080-7803-ad0b-4fb7f8d3b232/approve  →  200  approve
      {"tenantId":"01a0d775-e08b-7b63-888f-b215ed3de206","slug":"golden-wheels-eb4b7f","consoleUrl":"https://app.golden-wheels-eb4b7f.localhost"}
   ✔ POST /auth/login  →  200  operator signs in to its own console
      {"accessToken":"eyJhbGciOiJIUzI1…"}
   ✔ POST /admin/tenants/01a0d775-e08b-7b63-888f-b215ed3de206/suspend  →  200  super admin suspends the operator
      {"ok":true}
   ✔ POST /auth/login  →  403  operator signs in to its own console
      “This operator account is suspended”
   ✔ POST /admin/tenants/01a0d775-e08b-7b63-888f-b215ed3de206/activate  →  200  super admin re-activates it
      {"ok":true}
   ✔ POST /auth/login  →  200  operator signs in to its own console
      {"accessToken":"eyJhbGciOiJIUzI1…"}

## 10. Royal Safar — new, waiting for review
_Submitted and not yet reviewed._

   ✔ POST /operators/apply  →  201  application submitted
      {"applicationId":"01a0d775-e241-73ed-a9f8-0877fdaaf3b6","status":"pending"}

## 11. Metro Link Travels — added directly by the super admin
_No application: the platform provisions the operator and its owner login in one call._

   ✔ POST /admin/tenants  →  201  super admin provisions the operator
      {"tenantId":"01a0d775-e249-7da3-abe4-fa7f1930ac1c","slug":"metro-link-mugmyv3k","consoleUrl":"https://app.metro-link-mugmyv3k.localhost"}
   ✔ POST /auth/login  →  200  operator signs in to its own console
      {"accessToken":"eyJhbGciOiJIUzI1…"}
   ✔ POST /admin/tenants  →  409  same slug again
      “An operator with this slug already exists”

## ✓. Queue as the super admin sees it
_GET /admin/operator-applications?status=…_

   ✔ GET /admin/operator-applications?status=pending  →  200  pending applications
      {"applications":[{"id":"01a0d775-e241-73ed-a9f8-0877fdaaf3b6","status":"pending","firstName":"Royal","lastName":"Owner","email":"royal.26.mugmyv3k@example.in","mobile":"9323945032","companyName":"Roya
      pending: Royal Safar, Highway Kings, Mismatch Motors
   ✔ GET /admin/operator-applications?status=approved  →  200  approved applications
      {"applications":[{"id":"01a0d775-e080-7803-ad0b-4fb7f8d3b232","status":"approved","firstName":"Golden","lastName":"Owner","email":"golden.24.mugmyv3k@example.in","mobile":"9323735151","companyName":"G
      approved: Golden Wheels, Reopen Express, Rathore Bus Service, Sharma Travels
   ✔ GET /admin/operator-applications?status=rejected  →  200  rejected applications
      {"applications":[{"id":"01a0d775-dedd-757d-a24d-df3660de9d40","status":"rejected","firstName":"Night","lastName":"Owner","email":"night.20.mugmyv3k@example.in","mobile":"9323255785","companyName":"Nig
      rejected: Night Rider Roadways, Fake Travels

## Summary

| Operator | Final state | Edge case shown |
|---|---|---|
| Sharma Travels | approved | live; console login works; second approve refused |
| Rathore Bus Service | approved | held first (reason required), then approved |
| Fake Travels | rejected | approve blocked (invalid GSTIN), rejected |
| Mismatch Motors | pending (on hold) | GSTIN / PAN mismatch blocks approval |
| (duplicates) | refused | email / mobile / GSTIN clash → 409; invalid form → 400 |
| Highway Kings | pending | no bank details → cannot approve yet |
| Night Rider Roadways | rejected | rejected with reason |
| Reopen Express | approved | rejected → reopened → approved |
| Golden Wheels | approved → suspended → active | suspended operator cannot sign in |
| Royal Safar | pending | awaiting review |
| Metro Link Travels | active (direct) | provisioned without an application; duplicate slug → 409 |
