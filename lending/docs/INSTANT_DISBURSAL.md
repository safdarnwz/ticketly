# 5-Minute Instant Digital Loan Disbursement

**Business plan addendum. Yeh Section 9 (Web Application Features) ka naya main feature hai.**

**Target:** Within 5 minutes.
Loan approval ki poori process successfully complete hone ke baad, eligible customer ke verified bank account mein loan amount digitally transfer karna.

> Yeh target journey hai, guaranteed processing time nahi. KYC, bureau, bank verification, e-sign ya banking network mein delay hone par samay badh sakta hai. Website par "within 5 minutes guaranteed" jaisa vaada nahi likhna hai, sirf "about 5 minutes*" aur disclaimer.

---

## 1. Customer Journey (target timeline)

Clock t = 0 tab shuru hota hai jab customer OTP maangta hai. Har step ka ek "complete by" target hai. System har step ka actual time record karta hai.

| Start | Step | Kya hota hai | Complete by |
|---|---|---|---|
| 00:00 | Mobile OTP Login | Mobile number se OTP login | 00:30 |
| 00:30 | KYC Verification | PAN verify aur CKYC download, dono parallel mein | 01:30 |
| 01:30 | Bank Account Verification | Penny drop: account exist karta hai, active hai, aur naam KYC se match karta hai | 02:30 |
| 02:30 | Credit & Risk Assessment | Credit bureau, income, repayment capacity, fraud aur velocity checks | 03:30 |
| 03:30 | Loan Approval | Automated underwriting. Borderline case manual review mein jata hai | 04:00 |
| 04:00 | KFS & E-Sign | Customer APR, charges aur due date padhkar accept karta hai, phir Aadhaar OTP se e-sign | 05:00 |
| 05:00 | Digital Disbursement | E-sign hote hi IMPS payout seedha customer ke verified account mein | 05:00 |

### Jab 5 minute mein nahi hoga (aur yeh theek hai)

- **Manual review:** borderline credit score, new-to-credit, self-employed ya naam ka partial match. Credit Analyst review karta hai, phir customer KFS aur e-sign karta hai.
- **Bank ya bureau down:** customer ko saaf message milta hai aur retry kar sakta hai.
- **Payout fail:** agar IMPS confirm-failed ho (jaise beneficiary bank offline), to NEFT par ek baar retry hota hai. Account closed ho to loan cancel ho jata hai aur customer kuch nahi deta.

---

## 2. Required Integrations

| Integration | Purpose | Code mein port |
|---|---|---|
| PAN/KYC API | Customer verification | `PanKycProvider` |
| CKYC / permitted KYC provider | KYC compliance | `CkycProvider` |
| Credit Bureau API | Credit history | `CreditBureauProvider` |
| Bank Verification API | Account ownership | `BankVerificationProvider` |
| Penny Drop / Account Validation | Beneficiary verification, jahan appropriate ho | `BankVerificationProvider` |
| eSign / Digital Signature | Loan agreement | `EsignProvider` |
| UPI / IMPS / NEFT payout API | Instant digital disbursement | `PayoutProvider` |
| Payment Reconciliation API | Transaction confirmation | `ReconciliationProvider` |

Har integration ek interface (port) hai (`backend/src/integrations/ports.ts`). Development ke liye sandbox simulator bana hai. Vendor contract sign hone ke baad har port ka live adapter likhna hai.

---

## 3. Disbursement design (paisa sahi jagah, sirf ek baar)

1. **Rail:** IMPS primary hai (24x7, instant, ₹5 lakh tak). NEFT sirf fallback hai. Bank account verify hua hai, isliye UPI VPA ki zarurat nahi.
2. **Double payout nahi hoga:** har attempt ki unique idempotency key hoti hai (`loanId:attempt`). Agar timeout ho jaye to wahi key dobara bhejte hain, naya payout nahi banta.
3. **Fallback sirf confirmed failure par:** status "unknown" ho to doosre rail par paisa kabhi nahi bheja jata. Pehle provider se status confirm hota hai.
4. **Fund flow (RBI Digital Lending Directions):** paisa lender ke bank account se seedha borrower ke verified account mein jata hai. Beech mein koi LSP ya pool account nahi hota.
5. **Confirmation:** har 2 second poller, signed webhook (HMAC, aur phir provider status API se dobara check), aur settlement feed se reconciliation. UTR customer ko dikhaya jata hai.
6. **Interest disbursal date se lagta hai**, sanction date se nahi. Due date = credit date + tenure.

---

## 4. Compliance checks jo code mein enforce hain

- KFS accept kiye bina e-sign nahi, aur e-sign ke bina disbursal nahi (state machine).
- Customer ne jo KFS dekha uska SHA-256 hash store hota hai. Hash match na ho to accept nahi hota.
- Offer 15 minute mein expire ho jata hai. Purana offer kabhi sign nahi ho sakta.
- Agar Owner ne APR cap set kiya hai, to us cap se upar ka offer banta hi nahi.
- Pricing aur offers sirf OWNER badal sakta hai (Section 8 dekhein). Har badlaav ka purana aur naya value audit log mein jata hai.
- KFS mein processing fee ke saath GST, APR, penal charges, cooling-off period, recovery practices, LSP details aur grievance officer sab dikhte hain.
- PAN aur account number encrypted (AES-256-GCM) store hote hain. Sirf masked value dikhayi jati hai.
- Ek customer ka ek hi open loan ho sakta hai (database unique index bhi).
- Audit log append-only hai: database trigger update aur delete block karta hai.
- Customer ke phone contacts ya gallery ka koi access nahi.

---

## 5. SLA dashboard (management ke liye)

`GET /api/admin/metrics/instant-disbursal` yeh dikhata hai:

- Kitne loan disburse hue aur unme se kitne % 5 minute ke andar.
- p50, p90 aur p95 login-to-money time.
- Har step ka median aur p90 time, failures, manual referrals, aur kitni baar target miss hua. Isse pata chalta hai ki bottleneck kahan hai.
- Funnel (har status par kitni applications) aur rail-wise payout success.

**Suggested internal targets (controlled launch ke baad review karein):** auto-approved loans mein 90% 5 minute ke andar; payout success 99% se zyada; double payout zero.

---

## 6. 5-person company setup

| Employee | System roles | Kaam |
|---|---|---|
| 1. Founder / Owner | OWNER + SUPER_ADMIN + CREDIT_RISK_MANAGER | Strategy, staff accounts, credit policy, aur saari pricing aur offers (sirf Owner) |
| 2. Compliance & Grievance Head | COMPLIANCE_OFFICER + GRIEVANCE_OFFICER | Pricing dekhna (badal nahi sakta), RBI returns, complaints, PMLA Principal Officer |
| 3. Finance & Accounts | FINANCE_MANAGER | Reconciliation, books, GST |
| 4. Credit & Operations | CREDIT_ANALYST + OPERATIONS_MANAGER + KYC_VERIFIER | Manual review, KYC exceptions, payout issues |
| 5. Support & Collections | CUSTOMER_SUPPORT + COLLECTION_AGENT | Customer queries, lawful reminders |
| External CA firm | AUDITOR (read-only) | Audit |

System yeh combinations block karta hai: Owner + Auditor, Collection + Grievance, aur Auditor ke saath Super Admin, Credit Analyst ya Finance. OWNER role sirf doosra Owner hi de sakta hai. Har staff login par password ke saath authenticator (TOTP) MFA lagta hai.

Technology development, hosting aur call-center overflow outsource kiye ja sakte hain, RBI outsourcing guidelines aur company oversight ke saath.

---

## 7. Pricing note

Seed mein sirf ek placeholder plan hai (18% per year, 1% fee + GST, 30 din). Owner ise jab chahe badal sakta hai.

Business plan ka original proposal (1% per day + 10% upfront fee) ka APR lagbhag **540%** banta hai. System yeh rate set karne deta hai (APR cap khali chhodne par), aur KFS mein APR saaf dikhata hai. Lekin itni mehngi pricing regulatory, reputational aur default risk badhati hai. Interest rate aur charges Board-approved interest-rate policy ke andar hone chahiye. Owner jo bhi rate set kare, wo us policy ke range mein ho, aur regulatory lawyer ne review kiya ho.

---

## 8. Fully custom pricing aur offers (sirf Owner)

Owner panel (`/#owner`) se Owner yeh sab jab chahe set aur badal sakta hai:

| Setting | Options |
|---|---|
| Interest | **% per day** (jaise 0.05% per day) ya **% per year** (jaise 18%) |
| Processing fee | **% of loan** ya **flat ₹** (jaise ₹99) |
| GST on fee | Koi bhi % |
| Tenure | 1–365 din |
| Loan amount | Min aur max ₹ |
| Penal charge (due date ke baad) | None, % per day of overdue amount, ya flat ₹ per day |
| Cooling-off | Din |
| APR cap | Optional. Set kiya to usse upar ka offer nahi banega |
| Validity | Kab se, kab tak (festival ya campaign offer ke liye) |
| Max loans | Is offer par kitne loan (jaise personal offer sirf 1 baar) |
| Priority | Ek saath kai offer chal rahe hon to zyada priority wala jeetega |
| On / off | Turant band ya chalu |

**Do tarah ke offer:**
- **Offer for all customers:** default plan, ya ek time-limited campaign (jaise "Festival offer: zero fee" agle 7 din).
- **Offer for one customer:** mobile number par personal rate (jaise "Special rate for you"). Customer ke register hone se pehle bhi banaya ja sakta hai.

**Kaunsa offer lagega:** customer ka valid personal offer sabse pehle, warna sabke liye valid offer. Ek se zyada hon to zyada priority wala, phir naya wala. Owner panel mein "Check what a customer will be offered" se mobile aur amount daal kar dekh sakte hain.

**Suraksha:**
- Sirf OWNER role pricing badal sakta hai. Baaki roles sirf dekh sakte hain, ya bilkul nahi.
- Har save par authenticator app ka fresh code maanga jata hai, chahe Owner already logged in ho.
- Har badlaav audit log mein jata hai: kisne, kab, purana value aur naya value.

**Badlaav kab lagta hai:** turant, lekin sirf naye offers par. Jo offer customer ko KFS mein dikh chuka hai ya sign ho chuka hai, uski terms freeze rehti hain. KFS mein na diya gaya charge baad mein nahi lagaya ja sakta, isliye system yeh rule khud enforce karta hai.

*Yeh document legal opinion nahi hai. Launch se pehle RBI CoR, Digital Lending Directions, KFS format aur saare integrations qualified NBFC professionals se verify karwayein.*
