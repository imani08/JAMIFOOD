export const RESTAURANT_TIMEZONE = 'Africa/Kinshasa';

export enum PermissionCode {
  USERS_READ = 'users.read', USERS_CREATE = 'users.create', USERS_UPDATE = 'users.update', USERS_DISABLE = 'users.disable',
  CLIENTS_READ = 'clients.read', CLIENTS_CREATE = 'clients.create', CLIENTS_UPDATE = 'clients.update', CLIENTS_ARCHIVE = 'clients.archive', CLIENTS_MERGE = 'clients.merge',
  SUBSCRIPTIONS_READ = 'subscriptions.read', SUBSCRIPTIONS_CREATE = 'subscriptions.create', SUBSCRIPTIONS_UPDATE = 'subscriptions.update', SUBSCRIPTIONS_SUSPEND = 'subscriptions.suspend', SUBSCRIPTIONS_CANCEL = 'subscriptions.cancel',
  PRICING_READ = 'pricing.read', PRICING_UPDATE = 'pricing.update', CASH_OPEN = 'cash.open', CASH_CLOSE = 'cash.close', CASH_READ = 'cash.read', CASH_EXPENSE = 'cash.expense', CASH_REFUND = 'cash.refund', CASH_ADJUST = 'cash.adjust',
  SALES_CREATE = 'sales.create', SALES_READ = 'sales.read', SALES_CANCEL = 'sales.cancel', SALES_REFUND = 'sales.refund', MEAL_VALIDATE = 'meal.validate', MEAL_CORRECT = 'meal.correct', MEAL_EXCEPTION = 'meal.exception',
  ORDERS_CREATE = 'orders.create', ORDERS_READ = 'orders.read', ORDERS_UPDATE = 'orders.update', ORDERS_CANCEL = 'orders.cancel', REPORTS_READ = 'reports.read', REPORTS_EXPORT = 'reports.export', AUDIT_READ = 'audit.read', STOCK_READ = 'stock.read', STOCK_ADJUST = 'stock.adjust', STOCK_INVENTORY = 'stock.inventory'
}

export const ORDER_TRANSITIONS = {
  RECEIVED: ['CONFIRMED', 'READY', 'CANCELLED'], CONFIRMED: ['READY', 'CANCELLED'], READY: ['SERVED', 'CANCELLED'], SERVED: [], CANCELLED: []
} as const;

export type ApiErrorCode = 'FORBIDDEN' | 'MEAL_RIGHT_ALREADY_CONSUMED' | 'MEAL_RIGHT_UNAVAILABLE' | 'ORDER_ALREADY_SERVED' | 'ORDER_NOT_READY' | 'PAYMENT_NOT_CONFIRMED' | 'IDEMPOTENCY_KEY_REUSED' | 'INVALID_ORDER_TRANSITION' | 'NOT_FOUND';
export { localDate, endDate, rightDates, drcPublicHolidays, isServiceDay, serviceEndDate, serviceRightDates } from './business';
