const ReminderHistory = require("../models/ReminderHistory");
const Store = require("../models/store");
const { MESSAGE_REMINDER_TEMPLATES } = require("../constants/messageReminderTemplates");
const { normalizePhoneNumber } = require("../controllers/whatsappService");
const twilio = require("twilio");

let twilioClient = null;

const getTwilioClient = () => {
  if (twilioClient) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !String(sid).startsWith("AC")) return null;
  try {
    twilioClient = twilio(sid, token);
    return twilioClient;
  } catch (err) {
    console.error("Twilio init failed:", err.message);
    return null;
  }
};

const sanitizeOneLine = (text) =>
  String(text || "")
    .replace(/\n/g, " ")
    .replace(/\t/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const formatAmount = (amount) => {
  const num = Number(amount) || 0;
  return num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

const applyMessageTemplate = (template, amount) =>
  String(template).replace(/\{\{amount\}\}/g, formatAmount(amount));

const applyStoreName = (text, storeName) => {
  const name = storeName || "आमचे दुकान";
  return String(text).replace(/\{\{storeName\}\}/g, name);
};

const applyReminderPlaceholders = (
  text,
  { amount, balance, storeName, useAmount, useBalance },
) => {
  let out = String(text).trim();
  if (useAmount && amount != null && Number.isFinite(Number(amount))) {
    out = applyMessageTemplate(out, amount);
  }
  if (useBalance && balance != null && Number.isFinite(Number(balance))) {
    out = out.replace(/\{\{balance\}\}/g, formatAmount(balance));
  }
  return applyStoreName(out, storeName);
};

const reminderAmountVariableKey = (templateMeta) =>
  String(
    templateMeta?.amountVariableKey ||
      process.env.TWILLO_REMINDER_AMOUNT_VARIABLE_KEY ||
      "1",
  ).trim() || "1";

const reminderBalanceVariableKey = (templateMeta) =>
  String(
    templateMeta?.balanceVariableKey ||
      process.env.TWILLO_REMINDER_BALANCE_VARIABLE_KEY ||
      "2",
  ).trim() || "2";

const resolveStoreNameVariableKey = (templateMeta) => {
  if (templateMeta?.storeNameVariableKey) {
    return String(templateMeta.storeNameVariableKey).trim();
  }
  return String(process.env.TWILLO_REMINDER_STORE_NAME_VARIABLE_KEY || "2").trim() || "2";
};

const resolveReminderStoreName = async (storeName) => {
  const fromRequest = sanitizeOneLine(storeName);
  if (fromRequest) return fromRequest.slice(0, 40);

  try {
    const baseFilter = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };
    let store = await Store.findOne({
      ...baseFilter,
      "storeProfile.isActive": true,
    })
      .select("storeProfile.storeName")
      .sort({ createdAt: -1 })
      .lean();

    if (!store) {
      store = await Store.findOne(baseFilter)
        .select("storeProfile.storeName")
        .sort({ createdAt: -1 })
        .lean();
    }

    return sanitizeOneLine(
      store?.storeProfile?.storeName ||
        process.env.STORE_DISPLAY_NAME ||
        "आमचे दुकान",
    ).slice(0, 40);
  } catch (err) {
    console.error("resolveReminderStoreName error:", err.message);
    return sanitizeOneLine(process.env.STORE_DISPLAY_NAME || "आमचे दुकान").slice(
      0,
      40,
    );
  }
};

const sendWhatsAppReminderTemplate = async (mobile, contentSid, contentVariables) => {
  const client = getTwilioClient();
  if (!client) throw new Error("Twilio is not configured");

  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) throw new Error("TWILIO_WHATSAPP_FROM is not configured");
  if (!contentSid) throw new Error("WhatsApp reminder template SID is not configured");

  await client.messages.create({
    from,
    to: `whatsapp:+91${mobile}`,
    contentSid,
    contentVariables: JSON.stringify(
      contentVariables && Object.keys(contentVariables).length ? contentVariables : {},
    ),
  });
};

const resolveTemplate = (
  templateId,
  { balance, transactionType, transactionAmount },
) => {
  if (templateId) {
    const tpl = MESSAGE_REMINDER_TEMPLATES.find((t) => t.id === templateId);
    if (tpl) return tpl;
  }

  if (transactionType === "payment") {
    const paymentAmount = Number(transactionAmount) || 0;
    if (paymentAmount > 0) {
      if (Number(balance) > 0) {
        return MESSAGE_REMINDER_TEMPLATES.find(
          (t) => t.id === "payment_received_balance",
        );
      }
      return MESSAGE_REMINDER_TEMPLATES.find(
        (t) => t.id === "payment_received_settled",
      );
    }
  }

  if (Number(balance) > 0) {
    return MESSAGE_REMINDER_TEMPLATES.find((t) => t.id === "with_amount");
  }
  return MESSAGE_REMINDER_TEMPLATES.find((t) => t.id === "friendly");
};

const sendCustomerReminder = async ({
  customerId,
  customerName,
  mobileRaw,
  balance,
  transactionType,
  transactionAmount,
  templateId,
  storeName,
  sentBy,
}) => {
  const numericBalance = Number(balance) || 0;
  const numericTxnAmount = Number(transactionAmount) || 0;
  const templateMeta = resolveTemplate(templateId, {
    balance: numericBalance,
    transactionType,
    transactionAmount: numericTxnAmount,
  });
  if (!templateMeta) {
    throw new Error("No reminder template configured");
  }

  const contentSid = templateMeta.contentSidEnvKey
    ? process.env[templateMeta.contentSidEnvKey]
    : null;
  if (!contentSid) {
    throw new Error(
      `Set environment variable ${templateMeta.contentSidEnvKey || "(missing)"} to your Twilio Content SID`,
    );
  }

  const resolvedStoreName = await resolveReminderStoreName(storeName);
  const isPaymentConfirmation = transactionType === "payment" && numericTxnAmount > 0;
  const messageAmount = isPaymentConfirmation ? numericTxnAmount : numericBalance;
  const useAmountInBody = !!(
    templateMeta.includeAmount &&
    messageAmount > 0
  );
  const useBalanceInBody = !!(
    templateMeta.includeBalance &&
    numericBalance > 0
  );

  const finalMessage = applyReminderPlaceholders(templateMeta.message, {
    amount: messageAmount,
    balance: numericBalance,
    storeName: resolvedStoreName,
    useAmount: useAmountInBody,
    useBalance: useBalanceInBody,
  });
  const amountValue = useAmountInBody ? messageAmount : null;
  const mobile = normalizePhoneNumber(mobileRaw);

  const contentVariables = {
    [resolveStoreNameVariableKey(templateMeta)]: resolvedStoreName,
  };
  if (useAmountInBody) {
    contentVariables[reminderAmountVariableKey(templateMeta)] =
      formatAmount(messageAmount);
  }
  if (useBalanceInBody) {
    contentVariables[reminderBalanceVariableKey(templateMeta)] =
      formatAmount(numericBalance);
  }

  if (!mobile) {
    await ReminderHistory.create({
      customerId: customerId || null,
      customerName: customerName || null,
      mobile: String(mobileRaw || ""),
      message: finalMessage,
      amount: amountValue,
      status: "failed",
      errorMessage: "Invalid phone number",
      sentBy,
    });
    return { status: "failed", error: "Invalid phone number", mobile: String(mobileRaw || "") };
  }

  try {
    await sendWhatsAppReminderTemplate(mobile, contentSid, contentVariables);
    await ReminderHistory.create({
      customerId: customerId || null,
      customerName: customerName || null,
      mobile,
      message: finalMessage,
      amount: amountValue,
      status: "sent",
      sentBy,
    });
    return { status: "sent", mobile };
  } catch (sendErr) {
    await ReminderHistory.create({
      customerId: customerId || null,
      customerName: customerName || null,
      mobile,
      message: finalMessage,
      amount: amountValue,
      status: "failed",
      errorMessage: sendErr.message,
      sentBy,
    });
    return { status: "failed", error: sendErr.message, mobile };
  }
};

module.exports = {
  sendCustomerReminder,
  resolveReminderStoreName,
  MESSAGE_REMINDER_TEMPLATES,
};
