import { MigrationInterface, QueryRunner } from "typeorm";

export class CustomPricingPlans1793780945765 implements MigrationInterface {
    name = 'CustomPricingPlans1793780945765'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "loan_applications" RENAME COLUMN "pricingPolicyId" TO "pricingPlanId"`);
        await queryRunner.query(`ALTER TABLE "loans" RENAME COLUMN "pricingPolicyId" TO "pricingPlanId"`);
        await queryRunner.query(`CREATE TABLE "pricing_plans" ("id" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "name" character varying(120) NOT NULL, "scope" character varying(10) NOT NULL, "customerMobile" character varying(10), "customerLabel" character varying(120), "priority" integer NOT NULL DEFAULT '0', "active" boolean NOT NULL DEFAULT true, "validFrom" TIMESTAMP WITH TIME ZONE, "validUntil" TIMESTAMP WITH TIME ZONE, "maxUses" integer, "usedCount" integer NOT NULL DEFAULT '0', "interestUnit" character varying(10) NOT NULL, "interestRatePercent" numeric(12,6) NOT NULL, "feeType" character varying(10) NOT NULL, "feeValue" numeric(14,4) NOT NULL, "gstPercent" numeric(6,3) NOT NULL DEFAULT '18', "tenureDays" integer NOT NULL, "minPrincipalPaise" bigint NOT NULL, "maxPrincipalPaise" bigint NOT NULL, "penalType" character varying(20) NOT NULL DEFAULT 'NONE', "penalValue" numeric(14,4) NOT NULL DEFAULT '0', "coolingOffDays" integer NOT NULL DEFAULT '3', "aprCapPercent" numeric(10,3), "createdBy" uuid NOT NULL, "updatedBy" uuid, CONSTRAINT "PK_57aa9837d4777aafc70ba090fb6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b427930b28f01ebd31bcacbbfa" ON "pricing_plans" ("customerMobile") `);
        await queryRunner.query(`CREATE INDEX "IDX_ea027e1fb295449fd341426688" ON "pricing_plans" ("scope", "active") `);
        await queryRunner.query(`ALTER TYPE "public"."staff_users_roles_enum" RENAME TO "staff_users_roles_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."staff_users_roles_enum" AS ENUM('CUSTOMER', 'OWNER', 'SUPER_ADMIN', 'COMPLIANCE_OFFICER', 'CREDIT_RISK_MANAGER', 'CREDIT_ANALYST', 'OPERATIONS_MANAGER', 'KYC_VERIFIER', 'FINANCE_MANAGER', 'COLLECTION_AGENT', 'CUSTOMER_SUPPORT', 'GRIEVANCE_OFFICER', 'AUDITOR')`);
        await queryRunner.query(`ALTER TABLE "staff_users" ALTER COLUMN "roles" TYPE "public"."staff_users_roles_enum"[] USING "roles"::"text"::"public"."staff_users_roles_enum"[]`);
        await queryRunner.query(`DROP TYPE "public"."staff_users_roles_enum_old"`);
        // Carry existing policies over as "all customers" plans, then drop the old table.
        await queryRunner.query(`
          INSERT INTO pricing_plans (id, "createdAt", "updatedAt", name, scope, active, "interestUnit", "interestRatePercent", "feeType", "feeValue",
                                     "gstPercent", "tenureDays", "minPrincipalPaise", "maxPrincipalPaise", "coolingOffDays", "aprCapPercent", "createdBy")
          SELECT id, "createdAt", "updatedAt", name, 'ALL', status = 'ACTIVE', 'PER_ANNUM', "annualInterestBps" / 100.0, 'PERCENT', "processingFeeBps" / 100.0,
                 "gstOnFeeBps" / 100.0, "tenureDays", "minPrincipalPaise", "maxPrincipalPaise", "coolingOffDays", "aprCapBps" / 100.0, "createdBy"
            FROM pricing_policies`);
        await queryRunner.query(`DROP TABLE pricing_policies`);
        await queryRunner.query(`DROP TYPE IF EXISTS "public"."pricing_policies_status_enum"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // pricing_policies data is not restored on rollback (plans have more options than policies had).
        await queryRunner.query(`CREATE TYPE "public"."staff_users_roles_enum_old" AS ENUM('CUSTOMER', 'SUPER_ADMIN', 'COMPLIANCE_OFFICER', 'CREDIT_RISK_MANAGER', 'CREDIT_ANALYST', 'OPERATIONS_MANAGER', 'KYC_VERIFIER', 'FINANCE_MANAGER', 'COLLECTION_AGENT', 'CUSTOMER_SUPPORT', 'GRIEVANCE_OFFICER', 'AUDITOR')`);
        await queryRunner.query(`ALTER TABLE "staff_users" ALTER COLUMN "roles" TYPE "public"."staff_users_roles_enum_old"[] USING "roles"::"text"::"public"."staff_users_roles_enum_old"[]`);
        await queryRunner.query(`DROP TYPE "public"."staff_users_roles_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."staff_users_roles_enum_old" RENAME TO "staff_users_roles_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ea027e1fb295449fd341426688"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b427930b28f01ebd31bcacbbfa"`);
        await queryRunner.query(`DROP TABLE "pricing_plans"`);
        await queryRunner.query(`ALTER TABLE "loans" RENAME COLUMN "pricingPlanId" TO "pricingPolicyId"`);
        await queryRunner.query(`ALTER TABLE "loan_applications" RENAME COLUMN "pricingPlanId" TO "pricingPolicyId"`);
    }

}
