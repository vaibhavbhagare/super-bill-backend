const { Features } = require("./features");

const ALL = new Set(Object.values(Features));

const BILLER_ALLOWED = [
  Features.PRODUCTS_VIEW,
  Features.PRODUCTS_CREATE,
  Features.PRODUCTS_EDIT,
  Features.CUSTOMERS_VIEW,
  Features.CUSTOMERS_CREATE,
  Features.CUSTOMERS_EDIT,
  Features.INVOICES_VIEW,
  Features.INVOICE_CREATE,
  Features.INVOICE_EDIT,
  Features.REPORTS_VIEW,
  Features.ORDERS_VIEW,
  Features.SYNC_APP,
  Features.EXPENSES_VIEW,
  Features.STORE_PROFILE_VIEW,
];

const PACKER_ALLOWED = [
  Features.PRODUCTS_VIEW,
  Features.REPORTS_VIEW,
  Features.ORDERS_VIEW,
];

const RoleEntitlements = {
  super_admin: { allowed: ALL },
  admin: { allowed: ALL },
  biller: { allowed: new Set(BILLER_ALLOWED) },
  packer: { allowed: new Set(PACKER_ALLOWED) },
};

module.exports = { RoleEntitlements };
