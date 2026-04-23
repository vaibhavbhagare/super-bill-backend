const twilio = require("twilio");
const User = require("../models/User");
const Store = require("../models/store");
const { normalizePhoneNumber } = require("../controllers/whatsappService");
const {
  STATUS_MAP,
  ORDER_NOTIFICATION_EVENT_IDS,
  ORDER_NOTIFICATION_EVENT_AUDIENCE,
  WHATSAPP_ORDER_OPS_DB_ROLES,
  STORE_DISPLAY_NAME_CACHE_TTL_MS,
} = require("../constants/whatsappOrderNotifications");

let twilioClient;
let cachedStoreDisplayName = null;
let cachedStoreDisplayNameAt = 0;

const sanitizeOneLine = (text) => {
  return String(text || "")
    .replace(/\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const normalizeStatusKey = (status) => {
  const key = sanitizeOneLine(String(status || "").toUpperCase());
  return STATUS_MAP[key] ? key : "PLACED";
};

const getStatusData = (statusKey) => {
  return STATUS_MAP[normalizeStatusKey(statusKey)];
};

const getCancelMessage = (by, reason = "") => {
  if (by === "ADMIN") return `Cancelled by store.${reason ? ` Reason: ${sanitizeOneLine(reason)}` : ""}`;
  if (by === "CUSTOMER") return "Your oder is cancelled. Please continue shopping.";
  return "Order cancelled.";
};

const getTwilioClient = () => {
  if (twilioClient) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  twilioClient = twilio(sid, token);
  return twilioClient;
};

const orderRef = (order) => {
  const id = order && (order._id || order.id);
  if (!id) return "";
  return String(id).slice(-6).toUpperCase();
};

const customerName = (order) => {
  return sanitizeOneLine(order?.customerSnapshot?.fullName || "Customer").slice(0, 40);
};

const customerPhone = (order) => {
  const raw = order?.customerSnapshot?.phoneNumber;
  return raw == null ? null : normalizePhoneNumber(raw);
};

const itemCount = (order) => {
  return (order?.items || []).reduce((sum, it) => sum + Number(it.quantity || 0), 0);
};

const amount = (order) => {
  const total = Number(order?.billingSummary?.total || 0);
  return `₹${Math.round(Number.isNaN(total) ? 0 : total)}`;
};

const deliveryType = (order) => {
  return order?.orderType === "STORE_PICKUP" ? "Store Pickup" : "Home Delivery";
};

const paymentMode = (order) => {
  const mode = String(order?.paymentMethod || "").toUpperCase();
  if (mode === "COD") return "Cash on Delivery";
  if (mode === "ONLINE") return "Online";
  if (mode === "CASH") return "Cash";
  return sanitizeOneLine(mode || "NA");
};

const resolveStoreDisplayName = async () => {
  if (cachedStoreDisplayName && Date.now() - cachedStoreDisplayNameAt < STORE_DISPLAY_NAME_CACHE_TTL_MS) {
    return cachedStoreDisplayName;
  }
  try {
    const baseFilter = { $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }] };
    let store = await Store.findOne({ ...baseFilter, "storeProfile.isActive": true })
      .select("storeProfile.storeName")
      .sort({ createdAt: -1 })
      .lean();
    if (!store) {
      store = await Store.findOne(baseFilter)
        .select("storeProfile.storeName")
        .sort({ createdAt: -1 })
        .lean();
    }
    cachedStoreDisplayName = sanitizeOneLine(store?.storeProfile?.storeName || process.env.STORE_DISPLAY_NAME || "Our store").slice(0, 40);
    cachedStoreDisplayNameAt = Date.now();
    return cachedStoreDisplayName;
  } catch (err) {
    console.error("[order WhatsApp] store resolve failed:", err.message);
    return sanitizeOneLine(process.env.STORE_DISPLAY_NAME || "Our store").slice(0, 40);
  }
};

const resolveContentSid = (audience) => {
  if (audience === "ops") {
    return process.env.TWILIO_CONTENT_SID_ORDER_GENERIC_OPS || null;
  }
  return process.env.TWILIO_CONTENT_SID_ORDER_GENERIC_CUSTOMER || null;
};

const sendWhatsAppTemplate = async (toDigits10, contentSid, variables, context = {}) => {
  const client = getTwilioClient();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const { audience = "unknown", trace = "NA" } = context;
  if (!client || !from) {
    console.warn(`[order WhatsApp] [${audience}] [${trace}] Twilio not configured`);
    return { skipped: true, reason: "no_twilio" };
  }
  if (!contentSid) {
    console.warn(`[order WhatsApp] [${audience}] [${trace}] no content SID configured`);
    return { skipped: true, reason: "no_template" };
  }
  const to = normalizePhoneNumber(toDigits10);
  if (!to) {
    console.warn(`[order WhatsApp] [${audience}] [${trace}] invalid phone`);
    return { skipped: true, reason: "bad_phone" };
  }
  const msg = await client.messages.create({
    from,
    to: `whatsapp:+91${to}`,
    contentSid,
    contentVariables: JSON.stringify(variables),
  });
  console.log(`[order WhatsApp] [${audience}] [${trace}] sent sid=${msg.sid} to=${to}`);
  return { sid: msg.sid };
};

const resolveOpsPhoneNumbers = async () => {
  try {
    const users = await User.find({
      deletedAt: null,
      role: { $in: WHATSAPP_ORDER_OPS_DB_ROLES },
    }).select("phoneNumber").lean();
    return [...new Set(users.map((u) => normalizePhoneNumber(u.phoneNumber)).filter(Boolean))];
  } catch (err) {
    console.error("[order WhatsApp] ops phones load failed:", err.message);
    return [];
  }
};

const buildCustomerPayload = async (order, statusKey, options = {}) => {
  const st = getStatusData(statusKey);
  const storeName = await resolveStoreDisplayName();
  const extraMessage = options.extraMessage
    || (normalizeStatusKey(statusKey) === "CANCELLED"
      ? getCancelMessage(options.cancelBy, options.cancelReason)
      : st.extraMessage);
  return {
    1: customerName(order),
    2: st.status,
    3: orderRef(order),
    4: String(itemCount(order)),
    5: amount(order),
    6: deliveryType(order),
    7: paymentMode(order),
    8: sanitizeOneLine(extraMessage || ""),
    9: storeName,
  };
};

const buildOpsPayload = async (order, statusKey, actionMessage) => {
  const st = getStatusData(statusKey);
  const storeName = await resolveStoreDisplayName();
  return {
    1: st.status,
    2: orderRef(order),
    3: customerName(order),
    4: customerPhone(order) || "NA",
    5: String(itemCount(order)),
    6: amount(order),
    7: sanitizeOneLine(actionMessage || "Please review and update order status."),
    8: storeName,
  };
};

const defaultOpsAction = (statusKey) => {
  const key = normalizeStatusKey(statusKey);
  if (key === "PLACED" || key === "READY FOR STORE PICKUP") return "New order received. Please review and confirm.";
  if (key === "CANCELLED") return "Order cancelled. Stop packing and restock items.";
  return `Order status changed to ${getStatusData(key).status}.`;
};

const customerCancelOpsAction = (reason = "") => {
  const cleaned = sanitizeOneLine(reason || "");
  if (cleaned) {
    return `Order cancelled by customer. Reason: ${cleaned}`;
  }
  return "Order cancelled by customer. Stop packing and restock items.";
};

const eventToStatusKey = (eventId, order) => {
  const map = {
    CUSTOMER_ORDER_PLACED: "PLACED",
    CUSTOMER_ORDER_STORE_READY: "READY FOR STORE PICKUP",
    CUSTOMER_ORDER_CONFIRMED: "CONFIRMED",
    CUSTOMER_ORDER_PACKING: "PACKING",
    CUSTOMER_ORDER_OUT_FOR_DELIVERY: "OUT FOR DELIVERY",
    CUSTOMER_ORDER_DELIVERED: "DELIVERED",
    CUSTOMER_ORDER_COMPLETED: "COMPLETED",
    CUSTOMER_ORDER_CANCELLED: "CANCELLED",
    OPS_NEW_ORDER: "PLACED",
    OPS_ORDER_CANCELLED: "CANCELLED",
  };
  return normalizeStatusKey(map[eventId] || order?.status || "PLACED");
};

const notifyCustomerByStatus = async (order, statusKey, options = {}, trace = "") => {
  const phone = customerPhone(order);
  if (!phone) {
    console.warn(`[order WhatsApp] [customer] [${trace}] no customer phone`);
    return { skipped: true, reason: "no_customer_phone" };
  }
  const payload = await buildCustomerPayload(order, statusKey, options);
  return sendWhatsAppTemplate(phone, resolveContentSid("customer"), payload, {
    audience: "customer",
    trace,
  });
};

const notifyOpsByStatus = async (order, statusKey, actionMessage, trace = "") => {
  const opsPhones = await resolveOpsPhoneNumbers();
  if (!opsPhones.length) {
    console.warn(`[order WhatsApp] [ops] [${trace}] no ops users for roles ${WHATSAPP_ORDER_OPS_DB_ROLES.join(",")}`);
    return { skipped: true, reason: "no_ops_phones" };
  }
  const payload = await buildOpsPayload(order, statusKey, actionMessage);
  const sid = resolveContentSid("ops");
  const results = [];
  for (const p of opsPhones) {
    results.push(await sendWhatsAppTemplate(p, sid, payload, { audience: "ops", trace }));
  }
  return results;
};

const dispatchOrderNotification = async (eventId, order, metadata = {}) => {
  if (!ORDER_NOTIFICATION_EVENT_IDS.includes(eventId)) {
    return { skipped: true, reason: "invalid_event_id" };
  }
  const audience = ORDER_NOTIFICATION_EVENT_AUDIENCE[eventId];
  const statusKey = normalizeStatusKey(metadata.statusKey || eventToStatusKey(eventId, order));
  if (audience === "customer") {
    return notifyCustomerByStatus(order, statusKey, {
      extraMessage: metadata.extraMessage,
      cancelBy: metadata.cancelBy,
      cancelReason: metadata.cancelReason,
    }, eventId);
  }
  if (audience === "ops") {
    return notifyOpsByStatus(order, statusKey, metadata.actionMessage || defaultOpsAction(statusKey), eventId);
  }
  return { skipped: true, reason: "unknown_audience" };
};

const scheduleNotify = (fn) => {
  Promise.resolve().then(fn).catch((err) => console.error("[order WhatsApp]", err?.message || err));
};

const onOrderPlaced = async (order) => {
  const statusKey = normalizeStatusKey(order.status);
  await notifyCustomerByStatus(order, statusKey, {}, "onOrderPlaced.customer");
  await notifyOpsByStatus(order, statusKey, defaultOpsAction(statusKey), "onOrderPlaced.ops");
};

const onOrderStatusUpdated = async (order, newStatus, options = {}) => {
  const statusKey = normalizeStatusKey(newStatus);
  const cancelOptions = statusKey === "CANCELLED"
    ? { cancelBy: "ADMIN", cancelReason: options.statusNote }
    : {};
  await notifyCustomerByStatus(order, statusKey, cancelOptions, "onOrderStatusUpdated.customer");

  if (Array.isArray(options.orderWhatsAppExtras)) {
    for (const row of options.orderWhatsAppExtras) {
      const eventId = row && row.eventId;
      if (!eventId) continue;
      const meta = { ...row };
      delete meta.eventId;
      await dispatchOrderNotification(eventId, order, meta);
    }
  }
};

const onOrderCancelled = async (order, { reason } = {}) => {
  console.log(`[order WhatsApp] [cancel] [${orderRef(order)}] customer initiated cancel`);
  await notifyCustomerByStatus(order, "CANCELLED", {
    cancelBy: "CUSTOMER",
    cancelReason: reason,
  }, "onOrderCancelled.customer");
  await notifyOpsByStatus(order, "CANCELLED", customerCancelOpsAction(reason), "onOrderCancelled.ops");
};

const isValidEventId = (eventId) => {
  return ORDER_NOTIFICATION_EVENT_IDS.includes(eventId);
};

exports.ORDER_NOTIFICATION_EVENT_IDS = ORDER_NOTIFICATION_EVENT_IDS;
exports.isValidOrderWhatsAppEventId = isValidEventId;
exports.dispatchOrderNotification = dispatchOrderNotification;
exports.onOrderPlaced = onOrderPlaced;
exports.onOrderStatusUpdated = onOrderStatusUpdated;
exports.onOrderCancelled = onOrderCancelled;
exports.scheduleOrderWhatsApp = scheduleNotify;
