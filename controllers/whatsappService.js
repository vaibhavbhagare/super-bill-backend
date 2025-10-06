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
      name: "भगरे सुपर मार्केट",
      address1: `अंकोली & `,
      address2: `अंकोली-शेजबाभूळगाव चौक`,
      phoneNumber: "9764384901, 9960038085",
    };
    console.log(customer);
    const customerPhoneReceiver = normalizePhoneNumber(customer.phoneNumber);

    if (!customerPhoneReceiver) {
      return;
    }

    const body = generateMarathiInvoiceParamsTwilio(
      invoice,
      customer,
      storeInfo
    );
    const message = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM, // ✅ Twilio WhatsApp sender (sandbox or approved number)
      to: `whatsapp:+91${customerPhoneReceiver}`, // ✅ Dynamic number (must include +91)
      contentSid: process.env.TWILIO_CONTENT_SID, // ✅ Your approved template SID
      contentVariables: JSON.stringify(body), // ✅ Must be a JSON string
    });

    console.log("✅ WhatsApp message sent:", message);
  } catch (error) {
    console.error("❌ Error sending WhatsApp message:", error.message);
  }
};

exports.sendTextMessage = async (invoice, customer) => {
  try {
    const response = await axios({
      url: "https://graph.facebook.com/v22.0/708120182383703/messages",
      method: "post",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        messaging_product: "whatsapp",
        to: "919960038085",
        type: "template",
        template: {
          name: "address_update",
          language: { code: "mr" },
          components: [
            {
              type: "body",
              parameters: generateMarathiInvoiceParams(invoice, customer),
            },
          ],
        },
      }),
    });
    console.log("✅ मेसेज यशस्वीरित्या पाठवला गेला:");
    console.log(response.data);
  } catch (error) {
    console.error("❌ मेसेज पाठवताना त्रुटी आली:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    } else {
      console.error(error.message);
    }
  }
};

function sanitizeText(text) {
  return text
    .replace(/\n/g, " ") // remove new lines
    .replace(/\t/g, " ") // remove tabs
    .replace(/\s{2,}/g, " ") // collapse multiple spaces
    .trim();
}

function generateMarathiInvoiceParams(invoice, customer) {
  const date = new Date(invoice.createdAt).toLocaleDateString("hi-IN");
  const billNo =
    invoice.invoiceNumber || invoice._id.toString().slice(-6).toUpperCase();
  const customerName = customer.fullName || "ग्राहक";
  const productLength = invoice.buyingProducts.length;

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
  const customerName = customer?.fullName || "ग्राहक";
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

  const storeName = storeInfo?.name || "भगरे सुपर मार्केट";
  const address1 = storeInfo?.address1 || "Ankoli";
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
