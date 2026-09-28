CREATE TYPE "CourierAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE');

CREATE TABLE "CourierProfile" (
    "userId" UUID NOT NULL,
    "availability" "CourierAvailability" NOT NULL DEFAULT 'UNAVAILABLE',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CourierProfile_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "CourierProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
