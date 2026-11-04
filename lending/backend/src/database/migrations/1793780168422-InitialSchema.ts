import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1793780168422 implements MigrationInterface {
    name = 'InitialSchema1793780168422'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "audit_logs" ("id" uuid NOT NULL, "at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actorType" character varying(20) NOT NULL, "actorId" character varying(64), "action" character varying(80) NOT NULL, "entityType" character varying(40) NOT NULL, "entityId" uuid, "data" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_13c69424c440a0e765053feb4b" ON "audit_logs" ("entityType", "entityId") `);
        await queryRunner.query(`CREATE TABLE "otp_challenges" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "mobile" character varying(10) NOT NULL, "codeHash" character(64) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "consumedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c34f21df6c8aa51229715452068" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8110c96b8d3e17292c75f4daf7" ON "otp_challenges" ("mobile") `);
        await queryRunner.query(`CREATE TABLE "bank_accounts" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "customerId" uuid NOT NULL, "accountNumberEnc" text NOT NULL, "accountHash" character(64) NOT NULL, "accountLast4" character varying(4) NOT NULL, "ifsc" character varying(11) NOT NULL, "bankHolderName" character varying(200), "nameMatchScore" numeric(4,3), "verificationRef" character varying(100), "verifiedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c872de764f2038224a013ff25ed" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1faad0248bc84d65758400b273" ON "bank_accounts" ("customerId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6c4df4b2ad5b0cd0d0d87b549f" ON "bank_accounts" ("customerId", "accountHash") `);
        await queryRunner.query(`CREATE TABLE "customers" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "mobile" character varying(10) NOT NULL, "fullName" character varying(200), "panHash" character(64), "panEnc" text, "panMasked" character varying(10), "dateOfBirth" date, "ckycNumber" character varying(40), "kycVerifiedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6d1cb2e8c3ca15f7293464edad" ON "customers" ("mobile") `);
        await queryRunner.query(`CREATE INDEX "IDX_c89b89ebd363485563703be219" ON "customers" ("panHash") `);
        await queryRunner.query(`CREATE TYPE "public"."disbursements_rail_enum" AS ENUM('IMPS', 'UPI', 'NEFT')`);
        await queryRunner.query(`CREATE TYPE "public"."disbursements_status_enum" AS ENUM('INITIATED', 'PENDING', 'SUCCESS', 'FAILED')`);
        await queryRunner.query(`CREATE TABLE "disbursements" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "loanId" uuid NOT NULL, "bankAccountId" uuid NOT NULL, "amountPaise" bigint NOT NULL, "rail" "public"."disbursements_rail_enum" NOT NULL, "attempt" integer NOT NULL, "idempotencyKey" character varying(80) NOT NULL, "status" "public"."disbursements_status_enum" NOT NULL DEFAULT 'INITIATED', "providerRef" character varying(100), "utr" character varying(40), "failureCode" character varying(60), "initiatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "confirmedAt" TIMESTAMP WITH TIME ZONE, "reconciledAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_2f9ea0e5b8382113aaa3e51cdfa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e44e40a4f3eae65703ee1cb323" ON "disbursements" ("loanId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_002172c4b4f2e6c95b25d57edd" ON "disbursements" ("idempotencyKey") `);
        await queryRunner.query(`CREATE INDEX "IDX_418e2dd3e58c516999f0276b78" ON "disbursements" ("status") `);
        await queryRunner.query(`CREATE INDEX "IDX_33a663709028483371755d6296" ON "disbursements" ("providerRef") `);
        await queryRunner.query(`CREATE TYPE "public"."journey_events_step_enum" AS ENUM('OTP_LOGIN', 'KYC', 'BANK_VERIFICATION', 'CREDIT_RISK', 'APPROVAL', 'KFS_ESIGN', 'DISBURSAL')`);
        await queryRunner.query(`CREATE TYPE "public"."journey_events_outcome_enum" AS ENUM('PASSED', 'FAILED', 'REFERRED')`);
        await queryRunner.query(`CREATE TABLE "journey_events" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "applicationId" uuid NOT NULL, "step" "public"."journey_events_step_enum" NOT NULL, "outcome" "public"."journey_events_outcome_enum" NOT NULL, "durationMs" integer NOT NULL, "elapsedMs" integer NOT NULL, "targetCompleteByMs" integer NOT NULL, "providerRef" character varying(100), "detail" jsonb NOT NULL DEFAULT '{}', CONSTRAINT "PK_1c3caf5dd7da2f01bbc058c9978" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b35c37a47f4d3842e24757b87e" ON "journey_events" ("applicationId", "step") `);
        await queryRunner.query(`CREATE TYPE "public"."loan_applications_status_enum" AS ENUM('STARTED', 'KYC_VERIFIED', 'BANK_VERIFIED', 'MANUAL_REVIEW', 'APPROVED', 'REJECTED', 'KFS_ACCEPTED', 'ESIGN_PENDING', 'DISBURSING', 'DISBURSED', 'DISBURSAL_FAILED', 'EXPIRED')`);
        await queryRunner.query(`CREATE TABLE "loan_applications" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "customerId" uuid NOT NULL, "status" "public"."loan_applications_status_enum" NOT NULL DEFAULT 'STARTED', "journeyStartedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "bankAccountId" uuid, "requestedPrincipalPaise" bigint, "declaredMonthlyIncomePaise" bigint, "employmentType" character varying(20), "bureauScore" integer, "decisionReasons" text array NOT NULL DEFAULT '{}', "pricingPolicyId" uuid, "offer" jsonb, "offerExpiresAt" TIMESTAMP WITH TIME ZONE, "kfsHash" character(64), "kfsAcceptedAt" TIMESTAMP WITH TIME ZONE, "esignRequestId" character varying(100), "signedAgreementRef" character varying(200), "esignedAt" TIMESTAMP WITH TIME ZONE, "reviewedBy" uuid, "clientIp" character varying(64), "deviceId" character varying(128), "completedAt" TIMESTAMP WITH TIME ZONE, "totalElapsedMs" integer, "withinTarget" boolean, CONSTRAINT "PK_a40270ea2f2b1fbc185b0f5684a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5c4b5719b1358329d26963803f" ON "loan_applications" ("customerId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6b27a7a458d012bede19920359" ON "loan_applications" ("status") `);
        await queryRunner.query(`CREATE TYPE "public"."loans_status_enum" AS ENUM('PENDING_DISBURSAL', 'ACTIVE', 'CANCELLED', 'CLOSED')`);
        await queryRunner.query(`CREATE TABLE "loans" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "applicationId" uuid NOT NULL, "customerId" uuid NOT NULL, "pricingPolicyId" uuid NOT NULL, "principalPaise" bigint NOT NULL, "processingFeePaise" bigint NOT NULL, "gstOnFeePaise" bigint NOT NULL, "netDisbursalPaise" bigint NOT NULL, "interestPaise" bigint NOT NULL, "totalRepayablePaise" bigint NOT NULL, "aprBps" integer NOT NULL, "tenureDays" integer NOT NULL, "status" "public"."loans_status_enum" NOT NULL DEFAULT 'PENDING_DISBURSAL', "disbursedAt" TIMESTAMP WITH TIME ZONE, "dueDate" date, "coolingOffEndsOn" date, CONSTRAINT "PK_5c6942c1e13e4de135c5203ee61" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_faed1fe2cbe2232ab68f16448f" ON "loans" ("applicationId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d7002fbfdf6379b25a869d40e1" ON "loans" ("customerId") `);
        await queryRunner.query(`CREATE TYPE "public"."pricing_policies_status_enum" AS ENUM('DRAFT', 'ACTIVE', 'RETIRED')`);
        await queryRunner.query(`CREATE TABLE "pricing_policies" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "annualInterestBps" integer NOT NULL, "processingFeeBps" integer NOT NULL, "gstOnFeeBps" integer NOT NULL DEFAULT '1800', "tenureDays" integer NOT NULL, "minPrincipalPaise" bigint NOT NULL, "maxPrincipalPaise" bigint NOT NULL, "aprCapBps" integer NOT NULL, "coolingOffDays" integer NOT NULL DEFAULT '3', "penalChargesText" text NOT NULL, "status" "public"."pricing_policies_status_enum" NOT NULL DEFAULT 'DRAFT', "createdBy" uuid NOT NULL, "activatedBy" uuid, "boardApprovalRef" character varying(200), "activatedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_b05a8d42b54bd34699ee55bcd7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "one_active_policy" ON "pricing_policies" ("status") WHERE "status" = 'ACTIVE'`);
        await queryRunner.query(`CREATE TYPE "public"."staff_users_roles_enum" AS ENUM('CUSTOMER', 'SUPER_ADMIN', 'COMPLIANCE_OFFICER', 'CREDIT_RISK_MANAGER', 'CREDIT_ANALYST', 'OPERATIONS_MANAGER', 'KYC_VERIFIER', 'FINANCE_MANAGER', 'COLLECTION_AGENT', 'CUSTOMER_SUPPORT', 'GRIEVANCE_OFFICER', 'AUDITOR')`);
        await queryRunner.query(`CREATE TABLE "staff_users" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "email" character varying(200) NOT NULL, "name" character varying(200) NOT NULL, "title" character varying(120) NOT NULL, "passwordHash" text NOT NULL, "totpSecret" text NOT NULL, "roles" "public"."staff_users_roles_enum" array NOT NULL, "active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_c6b167335377df69f7910c2c75e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4f32dd66546226ea64f5573b77" ON "staff_users" ("email") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_4f32dd66546226ea64f5573b77"`);
        await queryRunner.query(`DROP TABLE "staff_users"`);
        await queryRunner.query(`DROP TYPE "public"."staff_users_roles_enum"`);
        await queryRunner.query(`DROP INDEX "public"."one_active_policy"`);
        await queryRunner.query(`DROP TABLE "pricing_policies"`);
        await queryRunner.query(`DROP TYPE "public"."pricing_policies_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d7002fbfdf6379b25a869d40e1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_faed1fe2cbe2232ab68f16448f"`);
        await queryRunner.query(`DROP TABLE "loans"`);
        await queryRunner.query(`DROP TYPE "public"."loans_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6b27a7a458d012bede19920359"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5c4b5719b1358329d26963803f"`);
        await queryRunner.query(`DROP TABLE "loan_applications"`);
        await queryRunner.query(`DROP TYPE "public"."loan_applications_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b35c37a47f4d3842e24757b87e"`);
        await queryRunner.query(`DROP TABLE "journey_events"`);
        await queryRunner.query(`DROP TYPE "public"."journey_events_outcome_enum"`);
        await queryRunner.query(`DROP TYPE "public"."journey_events_step_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_33a663709028483371755d6296"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_418e2dd3e58c516999f0276b78"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_002172c4b4f2e6c95b25d57edd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e44e40a4f3eae65703ee1cb323"`);
        await queryRunner.query(`DROP TABLE "disbursements"`);
        await queryRunner.query(`DROP TYPE "public"."disbursements_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."disbursements_rail_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c89b89ebd363485563703be219"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6d1cb2e8c3ca15f7293464edad"`);
        await queryRunner.query(`DROP TABLE "customers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6c4df4b2ad5b0cd0d0d87b549f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1faad0248bc84d65758400b273"`);
        await queryRunner.query(`DROP TABLE "bank_accounts"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8110c96b8d3e17292c75f4daf7"`);
        await queryRunner.query(`DROP TABLE "otp_challenges"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_13c69424c440a0e765053feb4b"`);
        await queryRunner.query(`DROP TABLE "audit_logs"`);
    }

}
