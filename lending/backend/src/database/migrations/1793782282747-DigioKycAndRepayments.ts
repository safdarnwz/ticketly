import { MigrationInterface, QueryRunner } from "typeorm";

export class DigioKycAndRepayments1793782282747 implements MigrationInterface {
    name = 'DigioKycAndRepayments1793782282747'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // The one-open-loan index depends on the status enum; drop it while the enum changes.
        await queryRunner.query(`DROP INDEX "public"."one_open_loan_per_customer"`);
        await queryRunner.query(`CREATE TABLE "loan_documents" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "applicationId" uuid NOT NULL, "kind" character varying(40) NOT NULL, "sha256" character(64) NOT NULL, "content" bytea NOT NULL, CONSTRAINT "PK_10ce89ea05668cea82900f60e7a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_832561ed53c4dfd89984d24ec4" ON "loan_documents" ("applicationId", "kind") `);
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "loanId" uuid NOT NULL, "customerId" uuid NOT NULL, "kind" character varying(40) NOT NULL, "channel" character varying(10) NOT NULL DEFAULT 'SMS', "templateKey" character varying(60) NOT NULL, "vars" jsonb NOT NULL DEFAULT '{}', "providerRef" character varying(100), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_67d872ee1d80cf843ec38f72ab" ON "notifications" ("loanId", "kind") `);
        await queryRunner.query(`CREATE TYPE "public"."repayments_status_enum" AS ENUM('CREATED', 'PAID', 'FAILED', 'EXPIRED')`);
        await queryRunner.query(`CREATE TABLE "repayments" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "loanId" uuid NOT NULL, "customerId" uuid NOT NULL, "orderId" character varying(128), "amountPaise" bigint NOT NULL, "paidPaise" bigint NOT NULL DEFAULT '0', "status" "public"."repayments_status_enum" NOT NULL DEFAULT 'CREATED', "paymentUrl" text, "upiIntentUrl" text, "method" character varying(30), "utr" character varying(40), "paidAt" TIMESTAMP WITH TIME ZONE, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "receiptNo" character varying(40), CONSTRAINT "PK_7f297f77b60d1cbfe1d48ec4afa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6cf2f476d4ffec68819e03c28b" ON "repayments" ("loanId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_24a66b90562df85f012f21f554" ON "repayments" ("orderId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f0b333757e165f8cdef5b9f495" ON "repayments" ("status") `);
        await queryRunner.query(`ALTER TABLE "customers" ADD "aadhaarLast4" character varying(4)`);
        await queryRunner.query(`ALTER TABLE "customers" ADD "kycRef" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "loan_applications" ADD "kycRequestId" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "loan_applications" ADD "kycAccessTokenId" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "loan_applications" ADD "kycStartedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "loan_applications" ADD "esignAccessTokenId" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "loan_applications" ADD "agreementSha256" character(64)`);
        await queryRunner.query(`ALTER TABLE "loans" ADD "penalType" character varying(20) NOT NULL DEFAULT 'NONE'`);
        await queryRunner.query(`ALTER TABLE "loans" ADD "penalValue" numeric(14,4) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "loans" ADD "penalAccruedPaise" bigint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "loans" ADD "penalAccruedThrough" date`);
        await queryRunner.query(`ALTER TABLE "loans" ADD "paidPaise" bigint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "loans" ADD "closedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "loan_applications" ALTER COLUMN "esignRequestId" TYPE character varying(128)`);
        await queryRunner.query(`ALTER TYPE "public"."loans_status_enum" RENAME TO "loans_status_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."loans_status_enum" AS ENUM('PENDING_DISBURSAL', 'ACTIVE', 'OVERDUE', 'CANCELLED', 'CLOSED')`);
        await queryRunner.query(`ALTER TABLE "loans" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "loans" ALTER COLUMN "status" TYPE "public"."loans_status_enum" USING "status"::"text"::"public"."loans_status_enum"`);
        await queryRunner.query(`ALTER TABLE "loans" ALTER COLUMN "status" SET DEFAULT 'PENDING_DISBURSAL'`);
        await queryRunner.query(`DROP TYPE "public"."loans_status_enum_old"`);
        // An OVERDUE loan is still open, so it also blocks a second loan.
        await queryRunner.query(`CREATE UNIQUE INDEX "one_open_loan_per_customer" ON "loans" ("customerId") WHERE status IN ('PENDING_DISBURSAL', 'ACTIVE', 'OVERDUE')`);
        await queryRunner.query(`CREATE INDEX "IDX_521d6c0f5bf821a21f6eb78c33" ON "loan_applications" ("kycRequestId") `);
        await queryRunner.query(`CREATE INDEX "IDX_dd975fabe0fbb2dcbcc3177585" ON "loan_applications" ("esignRequestId") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_dd975fabe0fbb2dcbcc3177585"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_521d6c0f5bf821a21f6eb78c33"`);
        await queryRunner.query(`DROP INDEX "public"."one_open_loan_per_customer"`);
        await queryRunner.query(`CREATE TYPE "public"."loans_status_enum_old" AS ENUM('PENDING_DISBURSAL', 'ACTIVE', 'CANCELLED', 'CLOSED')`);
        await queryRunner.query(`ALTER TABLE "loans" ALTER COLUMN "status" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "loans" ALTER COLUMN "status" TYPE "public"."loans_status_enum_old" USING "status"::"text"::"public"."loans_status_enum_old"`);
        await queryRunner.query(`ALTER TABLE "loans" ALTER COLUMN "status" SET DEFAULT 'PENDING_DISBURSAL'`);
        await queryRunner.query(`DROP TYPE "public"."loans_status_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."loans_status_enum_old" RENAME TO "loans_status_enum"`);
        await queryRunner.query(`ALTER TABLE "loan_applications" ALTER COLUMN "esignRequestId" TYPE character varying(100)`);
        await queryRunner.query(`ALTER TABLE "loans" DROP COLUMN "closedAt"`);
        await queryRunner.query(`ALTER TABLE "loans" DROP COLUMN "paidPaise"`);
        await queryRunner.query(`ALTER TABLE "loans" DROP COLUMN "penalAccruedThrough"`);
        await queryRunner.query(`ALTER TABLE "loans" DROP COLUMN "penalAccruedPaise"`);
        await queryRunner.query(`ALTER TABLE "loans" DROP COLUMN "penalValue"`);
        await queryRunner.query(`ALTER TABLE "loans" DROP COLUMN "penalType"`);
        await queryRunner.query(`ALTER TABLE "loan_applications" DROP COLUMN "agreementSha256"`);
        await queryRunner.query(`ALTER TABLE "loan_applications" DROP COLUMN "esignAccessTokenId"`);
        await queryRunner.query(`ALTER TABLE "loan_applications" DROP COLUMN "kycStartedAt"`);
        await queryRunner.query(`ALTER TABLE "loan_applications" DROP COLUMN "kycAccessTokenId"`);
        await queryRunner.query(`ALTER TABLE "loan_applications" DROP COLUMN "kycRequestId"`);
        await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN "kycRef"`);
        await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN "aadhaarLast4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f0b333757e165f8cdef5b9f495"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_24a66b90562df85f012f21f554"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6cf2f476d4ffec68819e03c28b"`);
        await queryRunner.query(`DROP TABLE "repayments"`);
        await queryRunner.query(`DROP TYPE "public"."repayments_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_67d872ee1d80cf843ec38f72ab"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_832561ed53c4dfd89984d24ec4"`);
        await queryRunner.query(`DROP TABLE "loan_documents"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "one_open_loan_per_customer" ON "loans" ("customerId") WHERE (status = ANY (ARRAY['PENDING_DISBURSAL'::loans_status_enum, 'ACTIVE'::loans_status_enum]))`);
    }

}
