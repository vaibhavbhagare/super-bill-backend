const twilio = require("twilio");
// const accountSid = "ACa2ad0f31d5591b9d31b8cd89adcee15c";
// const authToken = "cef767502681697a32a854062265b7b6";
const client = new twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const axios = require("axios");

exports.sendWhatsAppMessageTwilio = async (invoice, customer) => {
  try {
    const storeInfo = {
      name: "*भगरे सुपर मार्केट*",
      address1: `अंकोली & `,
      address2: `अंकोली-शेजबाभूळगाव चौक`,
      phoneNumber: "9764384901",
      instaUrl: "https://tinyurl.com/bhagare-shop-insta",
      onlineWebUrl: "https://tinyurl.com/shop-bhagare",
    };
    const customerPhoneReceiver = normalizePhoneNumber(customer.phoneNumber);

    if (!customerPhoneReceiver) {
      return;
    }

    const body = generateMarathiInvoiceParamsTwilio(
      invoice,
      customer,
      storeInfo
    );
    const sender = process.env.TWILIO_WHATSAPP_FROM;
    const message = await client.messages.create({
      from: sender, // ✅ Twilio WhatsApp sender (sandbox or approved number)
      to: `whatsapp:+91${customerPhoneReceiver}`, // ✅ Dynamic number (must include +91)
      contentSid: process.env.TWILIO_CONTENT_SID, // ✅ Your approved template SID
      contentVariables: JSON.stringify(body), // ✅ Must be a JSON string
    });

    console.log("✅ WhatsApp message sent:", message);
  } catch (error) {
    console.error("❌ Error sending WhatsApp message:", error.message);
  }
};

exports.sendWhatsAppMessageTwilioShortInvoice = async (invoice, customer) => {
  try {
    const storeInfo = {
      name: "*भगरे सुपर मार्केट*",
      address1: `अंकोली & `,
      address2: `अंकोली-शेजबाभूळगाव चौक`,
      phoneNumber: "9764384901",
      instaUrl: "https://tinyurl.com/bhagare-shop-insta",
      onlineWebUrl: "https://tinyurl.com/shop-bhagare",
    };
    const customerPhoneReceiver = normalizePhoneNumber(customer.phoneNumber);

    if (!customerPhoneReceiver) {
      return;
    }

    const body = generateMarathiInvoiceParamsTwilioShortInvoice(
      invoice,
      customer,
      storeInfo
    );
    const sender = process.env.TWILIO_WHATSAPP_FROM;
    const message = await client.messages.create({
      from: sender, // ✅ Twilio WhatsApp sender (sandbox or approved number)
      to: `whatsapp:+91${customerPhoneReceiver}`, // ✅ Dynamic number (must include +91)
      contentSid: process.env.TWILIO_CONTENT_SID_SHORT_INVOICE, // ✅ Your approved template SID
      contentVariables: JSON.stringify(body), // ✅ Must be a JSON string
    });

    console.log("✅ WhatsApp message sent:", message);
  } catch (error) {
    console.error("❌ Error sending WhatsApp message:", error.message);
  }
};

function sanitizeText(text) {
  return text
    .replace(/\n/g, " ") // remove new lines
    .replace(/\t/g, " ") // remove tabs
    .replace(/\s{2,}/g, " ") // collapse multiple spaces
    .trim();
}

function truncateText(text, maxLength) {
  const value = String(text || "").trim();
  if (!maxLength || maxLength <= 0) return value;
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

// Normalize customer names: if Latin letters are all caps, convert to Title Case.
// Preserve non-Latin scripts (e.g., Devanagari) as-is.
function normalizeCustomerName(name) {
  const value = String(name || "").trim();
  if (!value) return value;
  const hasDevanagari = /[\u0900-\u097F]/.test(value);
  if (hasDevanagari) return value;
  const lettersOnly = value.replace(/[^A-Za-z\s']+/g, "");
  const isAllCaps = lettersOnly && lettersOnly === lettersOnly.toUpperCase();
  if (!isAllCaps) return value;
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Formats a date into dd/mm/YYYY HH:MM in Asia/Kolkata timezone
function formatDateTimeIST(dateInput) {
  const date = new Date(dateInput);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

function generateMarathiInvoiceParams(invoice, customer) {
  const date = new Date(invoice.createdAt).toLocaleDateString("hi-IN");
  const billNo =
    invoice.invoiceNumber || invoice._id.toString().slice(-6).toUpperCase();
  const customerName = normalizeCustomerName(customer.fullName) || "ग्राहक";
  // const productLength = invoice.buyingProducts.length;

  const productLines = invoice.buyingProducts
    .map((item) => {
      const qtyUnit = item.quantity + (item.unit || " नग");
      return `${item.secondName || item.name} (${qtyUnit}) - ₹${item.price}`;
    })
    .join(invoice.buyingProducts.length > 1 ? ", " : "");

  const {
    subtotal = 0,
    discount = 0,
    total = 0,
  } = invoice.billingSummary || {};

  const paymentMethod =
    {
      ONLINE: "GPay / PhonePe / कार्ड",
      CASH: "रोख",
      CREDIT: "उधार",
    }[invoice.transactionType] || "निवडलेले नाही";

  return [
    { type: "text", text: date }, // {{1}} दिनांक
    { type: "text", text: billNo }, // {{2}} बिल क्रमांक
    { type: "text", text: customerName }, // {{3}} ग्राहक
    { type: "text", text: sanitizeText(productLines) }, // {{4}} खरेदी माहिती
    { type: "text", text: `₹${subtotal}` }, // {{5}} एकूण रक्कम
    { type: "text", text: `₹${discount}` }, // {{6}} सवलत
    { type: "text", text: `₹${total}` }, // {{7}} देय रक्कम
    { type: "text", text: paymentMethod }, // {{8}} पेमेंट प्रकार
    { type: "text", text: customerName }, // {{8}} पेमेंट प्रकार
  ];
}

function generateMarathiInvoiceParamsTwilio(invoice, customer, storeInfo) {
  const date = new Date(invoice.createdAt).toLocaleDateString("hi-IN");
  const billNo =
    invoice.invoiceNumber || invoice._id?.toString().slice(-6).toUpperCase();
  const customerName = normalizeCustomerName(customer?.fullName) || "ग्राहक";
  const productLines = invoice.buyingProducts
    .map((item) => {
      const qtyUnit = item.quantity;
      const rawName = item.secondName || item.name;
      const shortName = truncateText(rawName, 8); // compress name to max 8 chars
      return `${shortName} (${qtyUnit}) - ₹${item.price}`;
    })
    .join(invoice.buyingProducts.length > 1 ? ", " : "");

  const {
    subtotal = 0,
    discount = 0,
    total = 0,
  } = invoice.billingSummary || {};

  const paymentMethod =
    {
      ONLINE: "GPay / PhonePe / कार्ड",
      CASH: "रोख",
      CREDIT: "उधार",
    }[invoice.transactionType] || "निवडलेले नाही";

  const storeName = storeInfo?.name || "भगरे सुपर मार्केट";
  const address1 = storeInfo?.address1 || "";
  const address2 = storeInfo?.address2 || "";
  const phone = storeInfo?.phoneNumber || "9960038085";

  return {
    1: storeName, // दुकानाचे नाव
    2: customerName, // ग्राहकाचे नाव
    3: date, // दिनांक
    4: billNo, // बिल क्रमांक
    5: customerName, // खरेदी माहिती
    6: sanitizeText(productLines), // एकूण रक्कम
    7: `₹${total}`, // सवलत
    8: `₹${discount}`, // देय रक्कम
    9: `₹${subtotal}`, // देय रक्कम
    10: paymentMethod, // पेमेंट प्रकार
    11: address1, // पत्ता
    12: address2, // मोबाईल क्रमांक
    13: phone, // मोबाईल क्रमांक
  };
}

function generateMarathiInvoiceParamsTwilioShortInvoice(
  invoice,
  customer,
  storeInfo
) {
  const date = formatDateTimeIST(invoice.createdAt);
  const billNo =
    invoice.invoiceNumber || invoice._id?.toString().slice(-6).toUpperCase();

  const customerName = normalizeCustomerName(customer?.fullName) || "ग्राहक";

  const productLines = `*एकूण ${invoice?.buyingProducts?.length || 0} वस्तू*`;

  const {
    subtotal = 0,
    discount = 0,
    total = 0,
  } = invoice.billingSummary || {};

  const paymentMethod =
    {
      ONLINE: "GPay / PhonePe / कार्ड",
      CASH: "रोख",
      CREDIT: "उधार",
    }[invoice.transactionType] || "निवडलेले नाही";

  const storeName = storeInfo?.name || "भगरे सुपर मार्केट";
  const address1 = storeInfo?.address1 || "";
  const address2 = storeInfo?.address2 || "";
  const phone = storeInfo?.phoneNumber || "9960038085";

  return {
    1: storeName, // दुकानाचे नाव
    2: customerName, // ग्राहकाचे नाव
    3: date, // दिनांक
    4: billNo, // बिल क्रमांक
    5: sanitizeText(productLines), // खरेदी माहिती
    6: `₹${total}`, // एकूण रक्कम
    7: `₹${discount}`, // सवलत
    8: `*₹${subtotal}*`, // देय रक्कम
    9: paymentMethod, // देय रक्कम
    10: invoice.channel || "POS", // पेमेंट प्रकार
    11: `${address1} ${address2}`, // channel
    12: phone, // मोबाईल क्रमांक //
    13: `${storeInfo.onlineWebUrl}`, // मोबाईल क्रमांक //
    14: `${storeInfo.instaUrl}`, // मोबाईल क्रमांक
  };
}
function normalizePhoneNumber(input) {
  if (input == null) return null;

  // Convert number to string safely
  let digits = String(input).replace(/\D/g, "");

  // Remove leading + if present
  if (digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);

  // Must be exactly 10 digits now
  return digits.length === 10 ? digits : null;
}

// Send custom WhatsApp message using Twilio
exports.sendCustomWhatsAppMessage = async (phoneNumber, message) => {
  try {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    
    if (!normalizedPhone) {
      throw new Error("Invalid phone number format");
    }

    const sender = process.env.TWILIO_WHATSAPP_FROM;
    const messageResponse = await client.messages.create({
      from: sender,
      to: `whatsapp:+91${normalizedPhone}`,
      contentSid: process.env.TWILIO_CONTENT_SID_DIWALI,
      body: ""
    });

    console.log("✅ Custom WhatsApp message sent:", messageResponse);
    return messageResponse;
  } catch (error) {
    console.error("❌ Error sending custom WhatsApp message:", error.message);
    throw error;
  }
};
