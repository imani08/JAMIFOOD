CREATE TYPE "ClientAccountType" AS ENUM ('STUDENT_HOME', 'STUDENT_EXTERNAL', 'STAFF');
CREATE TYPE "ClientVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');
CREATE TABLE "ClientAccount" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "clientId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "type" "ClientAccountType" NOT NULL,
  "verificationStatus" "ClientVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientAccount_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClientSession" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastActivityAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ClientPortalEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientPortalEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClientAccount_clientId_key" ON "ClientAccount"("clientId");
CREATE UNIQUE INDEX "ClientAccount_email_key" ON "ClientAccount"("email");
CREATE INDEX "ClientAccount_verificationStatus_createdAt_idx" ON "ClientAccount"("verificationStatus", "createdAt");
CREATE UNIQUE INDEX "ClientSession_tokenHash_key" ON "ClientSession"("tokenHash");
CREATE INDEX "ClientSession_accountId_expiresAt_idx" ON "ClientSession"("accountId", "expiresAt");
CREATE INDEX "ClientPortalEvent_accountId_createdAt_idx" ON "ClientPortalEvent"("accountId", "createdAt");
ALTER TABLE "ClientAccount" ADD CONSTRAINT "ClientAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientSession" ADD CONSTRAINT "ClientSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientPortalEvent" ADD CONSTRAINT "ClientPortalEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ClientAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
