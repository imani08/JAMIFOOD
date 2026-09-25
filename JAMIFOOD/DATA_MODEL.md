# Modèle de données Prisma conceptuel

Ce modèle est le contrat de conception avant migration. Les noms finaux Prisma
peuvent évoluer, pas les responsabilités ni les invariants. Tous les modèles
ont `id` UUID, `createdAt` et `updatedAt` sauf les événements append-only qui
ont `createdAt` seulement. `Decimal` est utilisé pour l'argent et les quantités;
les dates métier utilisent `DateTime` UTC avec `businessDate` quand nécessaire.

## Enums centrales

```prisma
enum UserStatus { ACTIVE DISABLED LOCKED }
enum ClientStatus { ACTIVE ARCHIVED }
enum QRCodeStatus { ACTIVE REVOKED REPLACED EXPIRED }
enum SubscriptionStatus { PENDING_PAYMENT SCHEDULED ACTIVE SUSPENDED EXPIRED CANCELLED }
enum MealRightStatus { AVAILABLE RESERVED CONSUMED CANCELLED }
enum OrderStatus { RECEIVED CONFIRMED PREPARING READY SERVED OUT_FOR_DELIVERY DELIVERED CANCELLED }
enum PaymentStatus { PENDING CONFIRMED FAILED CANCELLED REFUNDED }
enum Currency { USD CDF }
enum ServiceMode { DINE_IN TAKEAWAY DELIVERY }
enum CashSessionStatus { OPEN COUNTING CLOSED VALIDATED }
enum SyncStatus { PENDING SYNCING SYNCED CONFLICT REJECTED }
enum PriceStatus { SCHEDULED ACTIVE RETIRED }
```

## Identité, autorisation et audit

```prisma
model User { id String @id @default(uuid()); username String @unique; email String? @unique; firstName String; lastName String; phone String?; passwordHash String; status UserStatus; lastLoginAt DateTime?; roles UserRole[]; sessions Session[]; auditLogs AuditLog[] }
model Role { id String @id @default(uuid()); code String @unique; label String; users UserRole[]; permissions RolePermission[] }
model Permission { id String @id @default(uuid()); code String @unique; label String; roles RolePermission[] }
model UserRole { userId String; roleId String; user User @relation(fields:[userId],references:[id]); role Role @relation(fields:[roleId],references:[id]); @@id([userId,roleId]) }
model RolePermission { roleId String; permissionId String; role Role @relation(fields:[roleId],references:[id]); permission Permission @relation(fields:[permissionId],references:[id]); @@id([roleId,permissionId]) }
model Session { id String @id @default(uuid()); userId String; tokenHash String @unique; expiresAt DateTime; lastActivityAt DateTime; user User @relation(fields:[userId],references:[id]) }
model AuditLog { id String @id @default(uuid()); actorId String?; action String; entityType String; entityId String?; oldValue Json?; newValue Json?; metadata Json?; ip String?; deviceId String?; requestId String; createdAt DateTime @default(now()); actor User? @relation(fields:[actorId],references:[id]); @@index([entityType,entityId]); @@index([createdAt]); @@index([actorId,createdAt]) }
model IdempotencyRecord { id String @id @default(uuid()); scope String; key String; requestHash String; responseStatus Int; responseBody Json; createdAt DateTime @default(now()); expiresAt DateTime; @@unique([scope,key]); @@index([expiresAt]) }
```

`AuditLog` est uniquement insérable par les services applicatifs ; aucune route
de modification/suppression n'existe. La base de production utilise un rôle DB
applicatif sans privilège `DELETE`/`UPDATE` sur cette table.

## Clients, QR et abonnements

```prisma
model ClientCategory { id String @id @default(uuid()); code String @unique; label String; clients Client[] }
model Client { id String @id @default(uuid()); categoryId String; firstName String; lastName String; ulcNumber String? @unique; faculty String?; promotion String?; residency String?; phone String?; email String?; photoObjectKey String?; dietaryNotesEncrypted String?; status ClientStatus; mergedIntoId String?; category ClientCategory @relation(fields:[categoryId],references:[id]); subscriptions Subscription[]; orders Order[]; qrCodes QRCode[]; @@index([lastName,firstName]); @@index([phone]) }
model QRCode { id String @id @default(uuid()); clientId String; tokenHash String @unique; status QRCodeStatus; issuedAt DateTime; revokedAt DateTime?; replacedById String? @unique; client Client @relation(fields:[clientId],references:[id]); history QRCodeHistory[]; @@index([clientId,status]) }
model QRCodeHistory { id String @id @default(uuid()); qrCodeId String; action String; actorId String?; metadata Json?; createdAt DateTime @default(now()); qrCode QRCode @relation(fields:[qrCodeId],references:[id]) }
model SubscriptionPlan { id String @id @default(uuid()); code String @unique; name String; active Boolean; versions SubscriptionPlanVersion[] }
model SubscriptionPlanVersion { id String @id @default(uuid()); planId String; version Int; price Decimal @db.Decimal(18,2); currency Currency; services Json; eligibilityDays Json; quotaRules Json; deliveryIncluded Boolean; effectiveFrom DateTime; effectiveTo DateTime?; status PriceStatus; plan SubscriptionPlan @relation(fields:[planId],references:[id]); subscriptions Subscription[]; @@unique([planId,version]); @@index([planId,effectiveFrom]) }
model Subscription { id String @id @default(uuid()); clientId String; planVersionId String; status SubscriptionStatus; startsOn DateTime @db.Date; endsOn DateTime @db.Date; amount Decimal @db.Decimal(18,2); currency Currency; paidAmount Decimal @db.Decimal(18,2); balance Decimal @db.Decimal(18,2); serviceSnapshot Json; deliveryIncluded Boolean; client Client @relation(fields:[clientId],references:[id]); planVersion SubscriptionPlanVersion @relation(fields:[planVersionId],references:[id]); rights MealRight[]; payments SubscriptionPayment[]; @@index([clientId,status]); @@index([status,startsOn,endsOn]) }
model SubscriptionPayment { id String @id @default(uuid()); subscriptionId String; paymentId String @unique; amount Decimal @db.Decimal(18,2); subscription Subscription @relation(fields:[subscriptionId],references:[id]); payment Payment @relation(fields:[paymentId],references:[id]) }
model MealRight { id String @id @default(uuid()); subscriptionId String; businessDate DateTime @db.Date; serviceCode String; quotaGroup String?; status MealRightStatus; reservedAt DateTime?; consumedAt DateTime?; subscription Subscription @relation(fields:[subscriptionId],references:[id]); consumption MealConsumption?; reservation MealReservation?; @@unique([subscriptionId,businessDate,serviceCode,quotaGroup]); @@index([status,businessDate,serviceCode]) }
model MealConsumption { id String @id @default(uuid()); mealRightId String @unique; orderId String? @unique; servedById String; idempotencyKey String @unique; consumedAt DateTime; mealRight MealRight @relation(fields:[mealRightId],references:[id]); order Order? @relation(fields:[orderId],references:[id]) }
model MealReservation { id String @id @default(uuid()); mealRightId String @unique; orderId String @unique; expiresAt DateTime?; reservedById String; mealRight MealRight @relation(fields:[mealRightId],references:[id]); order Order @relation(fields:[orderId],references:[id]) }
```

Le token QR en clair n'est jamais stocké ; seul son hash indexable l'est. Une
fusion de client renseigne `mergedIntoId` et redirige les recherches, sans
réécrire les opérations historiques.

## Catalogue, prix, menus et commandes

```prisma
model ProductCategory { id String @id @default(uuid()); code String @unique; label String; products Product[] }
model Product { id String @id @default(uuid()); categoryId String; sku String? @unique; name String; active Boolean; category ProductCategory @relation(fields:[categoryId],references:[id]); prices ProductPrice[] }
model ProductPrice { id String @id @default(uuid()); productId String; currentVersionId String? @unique; product Product @relation(fields:[productId],references:[id]); versions PriceVersion[] }
model PriceVersion { id String @id @default(uuid()); productPriceId String; version Int; amount Decimal @db.Decimal(18,2); currency Currency; effectiveFrom DateTime; effectiveTo DateTime?; status PriceStatus; productPrice ProductPrice @relation(fields:[productPriceId],references:[id]); @@unique([productPriceId,version]); @@index([productPriceId,effectiveFrom]) }
model Menu { id String @id @default(uuid()); businessDate DateTime @db.Date; serviceCode String; activeVersionId String? @unique; versions MenuVersion[]; @@unique([businessDate,serviceCode]) }
model MenuVersion { id String @id @default(uuid()); menuId String; version Int; effectiveFrom DateTime; compositionSnapshot Json; menu Menu @relation(fields:[menuId],references:[id]); items MenuItem[]; @@unique([menuId,version]) }
model MenuItem { id String @id @default(uuid()); menuVersionId String; productId String; availableQuantity Decimal? @db.Decimal(18,3); variants Json?; menuVersion MenuVersion @relation(fields:[menuVersionId],references:[id]); product Product @relation(fields:[productId],references:[id]) }
model Order { id String @id @default(uuid()); number String @unique; clientId String?; mealConsumptionId String? @unique; serviceMode ServiceMode; status OrderStatus; businessDate DateTime @db.Date; paymentRequired Boolean; ticketTokenHash String? @unique; totalAmount Decimal @db.Decimal(18,2); currency Currency; client Client? @relation(fields:[clientId],references:[id]); items OrderItem[]; payments Payment[]; statusHistory OrderStatusHistory[]; kitchenTicket KitchenTicket?; delivery Delivery?; mealConsumption MealConsumption?; @@index([status,createdAt]); @@index([clientId,createdAt]) }
model OrderItem { id String @id @default(uuid()); orderId String; productId String?; quantity Decimal @db.Decimal(18,3); unitPrice Decimal @db.Decimal(18,2); lineTotal Decimal @db.Decimal(18,2); productSnapshot Json; variantsSnapshot Json?; supplementsSnapshot Json?; order Order @relation(fields:[orderId],references:[id]); @@index([orderId]) }
model OrderStatusHistory { id String @id @default(uuid()); orderId String; fromStatus OrderStatus?; toStatus OrderStatus; reason String?; actorId String?; createdAt DateTime @default(now()); order Order @relation(fields:[orderId],references:[id]); @@index([orderId,createdAt]) }
model KitchenTicket { id String @id @default(uuid()); orderId String @unique; number String @unique; renderedSnapshot Json; issuedAt DateTime; order Order @relation(fields:[orderId],references:[id]); items KitchenTicketItem[] }
model KitchenTicketItem { id String @id @default(uuid()); kitchenTicketId String; quantity Decimal @db.Decimal(18,3); preparationSnapshot Json; kitchenTicket KitchenTicket @relation(fields:[kitchenTicketId],references:[id]) }
model Delivery { id String @id @default(uuid()); orderId String @unique; courierId String?; addressSnapshot Json; status String; deliveryCodeHash String?; assignedAt DateTime?; deliveredAt DateTime?; failureReason String?; order Order @relation(fields:[orderId],references:[id]); @@index([courierId,status]) }
```

Le `productSnapshot` porte le prix/version/libellé au moment de la vente ; une
commande abonnée a `mealConsumptionId` mais ne génère pas de recette additionnelle.

## Paiements, change, caisse et dépenses

```prisma
model ExchangeRate { id String @id @default(uuid()); baseCurrency Currency; quoteCurrency Currency; rate Decimal @db.Decimal(20,8); effectiveFrom DateTime; source String; status PriceStatus; createdById String; @@unique([baseCurrency,quoteCurrency,effectiveFrom]); @@index([baseCurrency,quoteCurrency,effectiveFrom]) }
model Payment { id String @id @default(uuid()); orderId String?; status PaymentStatus; method String; operator String?; referenceCurrency Currency; amountDue Decimal @db.Decimal(18,2); receivedAmount Decimal @db.Decimal(18,2); receivedCurrency Currency; exchangeRateSnapshot Decimal? @db.Decimal(20,8); changeAmount Decimal @db.Decimal(18,2); changeCurrency Currency?; externalReference String?; confirmedAt DateTime?; confirmedById String?; idempotencyKey String @unique; order Order? @relation(fields:[orderId],references:[id]); references PaymentReference[]; movements CashMovement[]; @@index([orderId,status]); @@index([externalReference]) }
model PaymentReference { id String @id @default(uuid()); paymentId String; operator String; reference String; payment Payment @relation(fields:[paymentId],references:[id]); @@unique([operator,reference]) }
model CashRegister { id String @id @default(uuid()); code String @unique; label String; active Boolean; sessions CashSession[] }
model CashSession { id String @id @default(uuid()); cashRegisterId String; cashierId String; status CashSessionStatus; openedAt DateTime; closedAt DateTime?; openingUsd Decimal @db.Decimal(18,2); openingCdf Decimal @db.Decimal(18,2); cashRegister CashRegister @relation(fields:[cashRegisterId],references:[id]); movements CashMovement[]; closing CashClosing?; @@index([cashRegisterId,status]); @@index([cashierId,status]) }
model CashMovement { id String @id @default(uuid()); cashSessionId String; paymentId String?; type String; amount Decimal @db.Decimal(18,2); currency Currency; occurredAt DateTime; sourceType String; sourceId String; cashSession CashSession @relation(fields:[cashSessionId],references:[id]); payment Payment? @relation(fields:[paymentId],references:[id]); @@unique([sourceType,sourceId,type,currency]); @@index([cashSessionId,occurredAt]) }
model CashClosing { id String @id @default(uuid()); cashSessionId String @unique; status String; countedUsd Decimal @db.Decimal(18,2); countedCdf Decimal @db.Decimal(18,2); theoreticalSnapshot Json; varianceSnapshot Json; submittedAt DateTime; validatedAt DateTime?; validatedById String?; cashSession CashSession @relation(fields:[cashSessionId],references:[id]) }
model ExpenseCategory { id String @id @default(uuid()); code String @unique; label String; expenses Expense[] }
model Expense { id String @id @default(uuid()); categoryId String; cashSessionId String?; beneficiary String; reason String; amount Decimal @db.Decimal(18,2); currency Currency; paymentMethod String; receiptObjectKey String?; authorizedById String?; createdById String; occurredAt DateTime; category ExpenseCategory @relation(fields:[categoryId],references:[id]); @@index([occurredAt]); @@index([categoryId,occurredAt]) }
```

`CashMovement` est un ledger opérationnel append-only. Les remboursements et
régularisations utilisent de nouveaux paiements/mouvements liés à l'original,
jamais une modification directe d'une opération clôturée.

## Appareils et synchronisation

```prisma
model Device { id String @id @default(uuid()); deviceKey String @unique; name String; type String; active Boolean; lastSeenAt DateTime?; syncOperations SyncOperation[] }
model SyncOperation { id String @id @default(uuid()); operationUuid String @unique; deviceId String; actorId String?; type String; payload Json; idempotencyKey String; status SyncStatus; conflict Json?; occurredAt DateTime; syncedAt DateTime?; device Device @relation(fields:[deviceId],references:[id]); @@unique([deviceId,idempotencyKey]); @@index([status,occurredAt]) }
```

## Phase 2, isolée

```text
Ingredient, Unit, UnitConversion, Recipe, RecipeVersion, RecipeIngredient,
Production, ProductionBatch, Stock, StockMovement, Inventory, InventoryLine,
Supplier, Purchase, PurchaseItem, GoodsReceipt, GoodsReceiptItem,
SupplierPayment.
```

Les unités et conversions explicites empêcheront les additions incompatibles.
Les mouvements de stock auront une clé d'origine unique afin d'empêcher les
doubles déductions ; les ingrédients sont déduits lors de la validation de
production, pas au paiement puis au service.
