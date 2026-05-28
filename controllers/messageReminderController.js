const mongoose = require("mongoose");
const twilio = require("twilio");
const Customer = require("../models/Customer");
const ReminderHistory = require("../models/ReminderHistory");
const { MESSAGE_REMINDER_TEMPLATES } = require("../constants/messageReminderTemplates");
const { normalizePhoneNumber } = require("./whatsappService");

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

const formatAmount = (amount) => {
  const num = Number(amount) || 0;
  return num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};

const applyMessageTemplate = (template, amount) => {
  const formatted = formatAmount(amount);
  return String(template).replace(/\{\{amount\}\}/g, formatted);
};

const applyStoreName = (text, storeName) => {
  const name =
    storeName != null && String(storeName).trim() !== ""
      ? String(storeName).trim()
      : "आमचे दुकान";
  return String(text).replace(/\{\{storeName\}\}/g, name);
};

const applyReminderPlaceholders = (text, { amount, storeName, useAmount }) => {
  let out = String(text).trim();
  if (useAmount && amount != null && Number.isFinite(Number(amount))) {
    out = applyMessageTemplate(out, amount);
  }
  out = applyStoreName(out, storeName);
  return out;
};

/**
 * Twilio Content API variable slots are typically "1", "2", … — default amount → "1".
 * Override with TWILLO_REMINDER_AMOUNT_VARIABLE_KEY if your approved WhatsApp template uses a different index.
 */
const reminderAmountVariableKey = () =>
  String(process.env.TWILLO_REMINDER_AMOUNT_VARIABLE_KEY || "1").trim() || "1";

exports.getTemplates = async (_req, res) => {
  return res.json({ data: MESSAGE_REMINDER_TEMPLATES });
};

exports.getCustomersForReminders = async (req, res) => {
  try {
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 50;
    const skip = (page - 1) * limit;
    const search = (req.query.search || "").trim();

    const filter = {
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    };

    if (search) {
      const searchRegex = new RegExp(search, "i");
      filter.$and = [
        {
          $or: [
            { fullName: { $regex: searchRegex } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: "$phoneNumber" },
                  regex: search,
                  options: "i",
                },
              },
            },
          ],
        },
      ];
    }

    let customers = await Customer.find(filter)
      .sort({ updatedAt: -1 })
      .lean();

    let enriched = customers.map((c) => ({
      _id: String(c._id),
      fullName: c.fullName,
      phoneNumber: c.phoneNumber,
    }));

    const total = enriched.length;
    const paginated = enriched.slice(skip, skip + limit);

    return res.json({
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("getCustomersForReminders error:", err);
    return res.status(500).json({ error: err.message });
  }
};

const sendWhatsAppReminderTemplate = async (mobile, contentSid, contentVariables) => {
  const client = getTwilioClient();
  if (!client) {
    throw new Error("Twilio is not configured");
  }

  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) {
    throw new Error("TWILIO_WHATSAPP_FROM is not configured");
  }

  if (!contentSid) {
    throw new Error("WhatsApp reminder template SID is not configured for this template");
  }

  await client.messages.create({
    from,
    to: `whatsapp:+91${mobile}`,
    contentSid,
    contentVariables: JSON.stringify(
      contentVariables && Object.keys(contentVariables).length ? contentVariables : {},
    ),
  });
};

const recordAndSendReminder = async ({
  customerId,
  customerName,
  mobileRaw,
  baseMessage,
  numericAmount,
  storeName,
  useAmountInBody,
  contentSid,
  sentBy,
}) => {
  const finalMessage = applyReminderPlaceholders(baseMessage, {
    amount: numericAmount,
    storeName,
    useAmount: useAmountInBody,
  });
  const amountValue = useAmountInBody ? numericAmount : null;
  const mobile = normalizePhoneNumber(mobileRaw);
  const contentVariables = useAmountInBody
    ? { [reminderAmountVariableKey()]: `₹${formatAmount(numericAmount)}` }
    : {};

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
    return {
      customerId: customerId ? String(customerId) : null,
      mobile: String(mobileRaw || ""),
      status: "failed",
      error: "Invalid phone number",
    };
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
    return {
      customerId: customerId ? String(customerId) : null,
      mobile,
      status: "sent",
    };
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
    return {
      customerId: customerId ? String(customerId) : null,
      mobile,
      status: "failed",
      error: sendErr.message,
    };
  }
};

exports.sendReminders = async (req, res) => {
  try {
    const { customerIds, manualRecipients, templateId, amount, storeName } = req.body || {};
    const sentBy = req.user?.userName || req.user?.name || "system";

    if (!templateId) {
      return res.status(400).json({ error: "templateId is required" });
    }

    const templateMeta = MESSAGE_REMINDER_TEMPLATES.find((t) => t.id === templateId);
    if (!templateMeta) {
      return res.status(400).json({ error: `Unknown templateId: ${templateId}` });
    }

    const baseMessage = templateMeta.message;
    const contentSidEnvKey = templateMeta.contentSidEnvKey;
    const contentSid = contentSidEnvKey ? process.env[contentSidEnvKey] : null;
    if (!contentSid) {
      return res.status(500).json({
        error: `Set environment variable ${contentSidEnvKey || "(missing contentSidEnvKey)"} to your Twilio Content SID`,
      });
    }

    const numericAmount =
      amount !== undefined && amount !== null && amount !== ""
        ? Number(amount)
        : NaN;
    const useAmount = Number.isFinite(numericAmount);

    if (templateMeta && templateMeta.includeAmount) {
      if (!useAmount) {
        return res
          .status(400)
          .json({ error: "amount is required for this template" });
      }
      if (numericAmount <= 0) {
        return res
          .status(400)
          .json({ error: "amount must be greater than 0" });
      }
    }

    const useAmountInBody = !!(templateMeta?.includeAmount && useAmount);

    const ids = Array.isArray(customerIds) ? customerIds : [];
    const manualList = Array.isArray(manualRecipients) ? manualRecipients : [];

    if (ids.length === 0 && manualList.length === 0) {
      return res.status(400).json({
        error: "Select at least one customer or add a mobile number",
      });
    }

    const results = [];
    let sent = 0;
    let failed = 0;

    if (ids.length > 0) {
      const customers = await Customer.find({
        _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) },
        $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
      }).lean();

      const customerById = new Map(customers.map((c) => [String(c._id), c]));

      for (const customerId of ids) {
        const customer = customerById.get(String(customerId));
        if (!customer) {
          failed += 1;
          results.push({
            customerId: String(customerId),
            mobile: "",
            status: "failed",
            error: "Customer not found",
            recipientType: "customer",
          });
          continue;
        }

        const outcome = await recordAndSendReminder({
          customerId: customer._id,
          customerName: customer.fullName,
          mobileRaw: customer.phoneNumber,
          baseMessage,
          numericAmount,
          storeName,
          useAmountInBody,
          contentSid,
          sentBy,
        });
        results.push({ ...outcome, recipientType: "customer" });
        if (outcome.status === "sent") sent += 1;
        else failed += 1;
      }
    }

    for (const entry of manualList) {
      const mobileRaw = entry?.mobile ?? entry;
      const displayName =
        entry?.name && String(entry.name).trim()
          ? String(entry.name).trim()
          : "Unknown";

      const outcome = await recordAndSendReminder({
        customerId: null,
        customerName: displayName,
        mobileRaw,
        baseMessage,
        numericAmount,
        storeName,
        useAmountInBody,
        contentSid,
        sentBy,
      });
      results.push({ ...outcome, recipientType: "manual" });
      if (outcome.status === "sent") sent += 1;
      else failed += 1;
    }

    return res.json({
      message: "Reminders processed",
      data: { sent, failed, results },
    });
  } catch (err) {
    console.error("sendReminders error:", err);
    return res.status(500).json({ error: err.message });
  }
};

exports.getReminderHistory = async (req, res) => {
  try {
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 15;
    const skip = (page - 1) * limit;
    const search = (req.query.search || "").trim();
    const status = (req.query.status || "").trim();

    const filter = {};
    if (status && ["sent", "failed"].includes(status)) {
      filter.status = status;
    }
    if (search) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { mobile: { $regex: regex } },
        { message: { $regex: regex } },
        { customerName: { $regex: regex } },
      ];
    }

    const [data, total] = await Promise.all([
      ReminderHistory.find(filter)
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ReminderHistory.countDocuments(filter),
    ]);

    return res.json({
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("getReminderHistory error:", err);
    return res.status(500).json({ error: err.message });
  }
};
