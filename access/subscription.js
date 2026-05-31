const { Features } = require("./features");

const BASIC = [
  Features.PRODUCTS_VIEW,
  Features.CUSTOMERS_VIEW,
  Features.INVOICES_VIEW,
  Features.INVOICE_CREATE,
  Features.REPORTS_VIEW,
];

const STANDARD = [
  ...BASIC,
  Features.PRODUCTS_CREATE,
  Features.PRODUCTS_EDIT,
  Features.CUSTOMERS_CREATE,
  Features.CUSTOMERS_EDIT,
  Features.ORDERS_VIEW,
  Features.SYNC_APP,
  Features.EXPENSES_VIEW,
];

const PREMIUM = [
  ...STANDARD,
  Features.PRODUCTS_DELETE,
  Features.CUSTOMERS_DELETE,
  Features.INVOICE_EDIT,
  Features.INVOICE_DELETE,
  Features.BILL_DISCOUNT,
  Features.INVOICE_WHATSAPP,
  Features.REPORTS_EXPORT,
  Features.EXPENSES_MANAGE,
  Features.MESSAGE_REMINDER_VIEW,
  Features.MESSAGE_REMINDER_MANAGE,
  Features.STORE_PROFILE_VIEW,
  Features.STORE_PROFILE_EDIT,
  Features.BARCODE_SETTINGS,
  Features.PRINT_SETTINGS,
  Features.USERS_VIEW,
  Features.USERS_CREATE,
  Features.USERS_EDIT,
  Features.USERS_DELETE,
];

const TierEntitlements = {
  basic: new Set(BASIC),
  standard: new Set(STANDARD),
  premium: new Set(PREMIUM),
};

module.exports = { TierEntitlements };
