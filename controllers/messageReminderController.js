const mongoose = require("mongoose");
const Customer = require("../models/Customer");
const ReminderHistory = require("../models/ReminderHistory");
const { MESSAGE_REMINDER_TEMPLATES } = require("../constants/messageReminderTemplates");
const { getBalancesByCustomerId } = require("../services/khataBalanceService");
const { sendCustomerReminder } = require("../services/reminderSendService");

exports.getTemplates = async (_req, res) => {
  return res.json({ data: MESSAGE_REMINDER_TEMPLATES });
};

exports.getCustomersForReminders = async (req, res) => {
  try {
    const page = Number(req.query.page) > 0 ? Number(req.query.page) : 1;
    const limit = Number(req.query.limit) > 0 ? Number(req.query.limit) : 50;
    const skip = (page - 1) * limit;
    const search = (req.query.search || "").trim();
    const pendingOnly =
      String(req.query.pendingOnly || "").toLowerCase() === "true" ||
      req.query.pendingOnly === "1";

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

    const balanceMap = await getBalancesByCustomerId(
      customers.map((c) => c._id),
    );

    let enriched = customers.map((c) => ({
      _id: String(c._id),
      fullName: c.fullName,
      phoneNumber: c.phoneNumber,
      pendingBalance: balanceMap.get(String(c._id))?.balance ?? 0,
    }));

    if (pendingOnly) {
      enriched = enriched.filter((c) => (Number(c.pendingBalance) || 0) > 0);
    }

    const total = enriched.length;
    const paginated = enriched.slice(skip, skip + limit);

    return res.json({
      data: paginated,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      pendingOnly,
    });
  } catch (err) {
    console.error("getCustomersForReminders error:", err);
    return res.status(500).json({ error: err.message });
  }
};

const recordAndSendReminder = async ({
  customerId,
  customerName,
  mobileRaw,
  numericAmount,
  storeName,
  useAmountInBody,
  templateId,
  sentBy,
}) => {
  const balance = useAmountInBody ? numericAmount : 0;
  return sendCustomerReminder({
    customerId,
    customerName,
    mobileRaw,
    balance,
    templateId: templateId || (useAmountInBody ? "with_amount" : undefined),
    storeName,
    sentBy,
  });
};

exports.sendReminders = async (req, res) => {
  try {
    const {
      customerIds,
      manualRecipients,
      templateId,
      amount,
      storeName,
      sendToAllWithPending,
      useCustomerPendingAmount,
    } = req.body || {};
    const sentBy = req.user?.userName || req.user?.name || "system";
    const sendAllPending = Boolean(sendToAllWithPending);
    const usePendingAmount =
      Boolean(useCustomerPendingAmount) || sendAllPending;

    if (!templateId) {
      return res.status(400).json({ error: "templateId is required" });
    }

    const templateMeta = MESSAGE_REMINDER_TEMPLATES.find((t) => t.id === templateId);
    if (!templateMeta) {
      return res.status(400).json({ error: `Unknown templateId: ${templateId}` });
    }

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

    // Bulk / pending-amount modes use each customer's balance for amount templates.
    if (templateMeta && templateMeta.includeAmount && !usePendingAmount) {
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

    let ids = Array.isArray(customerIds) ? customerIds : [];
    const manualList = Array.isArray(manualRecipients) ? manualRecipients : [];

    let pendingBalanceMap = null;
    if (sendAllPending) {
      pendingBalanceMap = await getBalancesByCustomerId();
      ids = [];
      for (const [customerId, stats] of pendingBalanceMap.entries()) {
        if ((Number(stats?.balance) || 0) > 0) {
          ids.push(customerId);
        }
      }
      if (ids.length === 0) {
        return res.status(400).json({
          error: "No customers with pending amount greater than 0",
        });
      }
    }

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
      const balanceMap =
        pendingBalanceMap ||
        (await getBalancesByCustomerId(customers.map((c) => c._id)));

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

        const customerBalance = balanceMap.get(String(customer._id))?.balance ?? 0;

        // Skip zero/negative when bulk-sending to all with pending
        if (sendAllPending && !(Number(customerBalance) > 0)) {
          continue;
        }

        const amountForCustomer =
          usePendingAmount && templateMeta.includeAmount
            ? Number(customerBalance) || 0
            : useAmountInBody
              ? numericAmount
              : Number(customerBalance) || 0;

        const outcome = await recordAndSendReminder({
          customerId: customer._id,
          customerName: customer.fullName,
          mobileRaw: customer.phoneNumber,
          numericAmount: amountForCustomer,
          storeName,
          useAmountInBody:
            (templateMeta.includeAmount && amountForCustomer > 0) ||
            useAmountInBody ||
            Number(customerBalance) > 0,
          templateId,
          sentBy,
        });
        results.push({
          ...outcome,
          customerId: customerId ? String(customerId) : null,
          recipientType: "customer",
        });
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
        numericAmount: useAmountInBody ? numericAmount : 0,
        storeName,
        useAmountInBody,
        templateId,
        sentBy,
      });
      results.push({
        ...outcome,
        customerId: null,
        recipientType: "manual",
      });
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
