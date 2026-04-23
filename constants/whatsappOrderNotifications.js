const STATUS_MAP = {
  CART: {
    status: "Cart Created",
    extraMessage: "Your cart is saved. Complete your order to proceed.",
  },
  PLACED: {
    status: "Order Placed",
    extraMessage: "We've received your order and will process it shortly.",
  },
  CONFIRMED: {
    status: "Order Confirmed",
    extraMessage: "Your order is confirmed and being prepared.",
  },
  PACKING: {
    status: "Packing in Progress",
    extraMessage: "Your items are being packed.",
  },
  "OUT FOR DELIVERY": {
    status: "Out for Delivery",
    extraMessage: "Your order is on the way.",
  },
  "READY FOR STORE PICKUP": {
    status: "Ready for Pickup",
    extraMessage: "Your order is ready. Please visit the store to collect it.",
  },
  DELIVERED: {
    status: "Delivered",
    extraMessage: "Your order has been delivered successfully.",
  },
  COMPLETED: {
    status: "Order Completed",
    extraMessage: "Thank you for shopping with us.",
  },
  CANCELLED: {
    status: "Cancelled",
    extraMessage: "Your order has been cancelled.",
  },
};

const ORDER_NOTIFICATION_EVENT_IDS = [
  "CUSTOMER_ORDER_PLACED",
  "CUSTOMER_ORDER_STORE_READY",
  "CUSTOMER_ORDER_CONFIRMED",
  "CUSTOMER_ORDER_PACKING",
  "CUSTOMER_ORDER_OUT_FOR_DELIVERY",
  "CUSTOMER_ORDER_DELIVERED",
  "CUSTOMER_ORDER_COMPLETED",
  "CUSTOMER_ORDER_CANCELLED",
  "OPS_NEW_ORDER",
  "OPS_ORDER_CANCELLED",
];

const ORDER_NOTIFICATION_EVENT_AUDIENCE = {
  CUSTOMER_ORDER_PLACED: "customer",
  CUSTOMER_ORDER_STORE_READY: "customer",
  CUSTOMER_ORDER_CONFIRMED: "customer",
  CUSTOMER_ORDER_PACKING: "customer",
  CUSTOMER_ORDER_OUT_FOR_DELIVERY: "customer",
  CUSTOMER_ORDER_DELIVERED: "customer",
  CUSTOMER_ORDER_COMPLETED: "customer",
  CUSTOMER_ORDER_CANCELLED: "customer",
  OPS_NEW_ORDER: "ops",
  OPS_ORDER_CANCELLED: "ops",
};

const WHATSAPP_ORDER_OPS_DB_ROLES = ["super_admin", "admin", "packer"];
const STORE_DISPLAY_NAME_CACHE_TTL_MS = 5 * 60 * 1000;

module.exports = {
  STATUS_MAP,
  ORDER_NOTIFICATION_EVENT_IDS,
  ORDER_NOTIFICATION_EVENT_AUDIENCE,
  WHATSAPP_ORDER_OPS_DB_ROLES,
  STORE_DISPLAY_NAME_CACHE_TTL_MS,
};
