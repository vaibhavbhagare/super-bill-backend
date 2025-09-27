const twilio = require("twilio");
const accountSid = "AC579d13b5f9faef79cf3d789d24d5fca9";
const authToken = "513dbba59279e3fa417048065af4c981";
const client = new twilio(accountSid, authToken);
const axios = require("axios");

exports.sendWhatsAppMessage = async (
  customerName,
  amount,
  phoneNumber,
  imageUrl,
) => {
  try {
    const messageBody = `नमस्कार ${customerName},
*भगरे सुपर मार्केट* कडून आपल्याकडून झालेल्या पेमेंटची माहिती खालीलप्रमाणे आहे:
चलन रक्कम: ₹${amount}
आमच्याशी व्यवहार केल्याबद्दल धन्यवाद!
*भगरे सुपर मार्केट*
9764384901/9960038085

विश्वासाचे मार्केट – सर्व काही, एकाच ठिकाणी आणि जास्त बचत!`;

    const message = await client.messages.create({
      from: "whatsapp:+14155238886", // Twilio sandbox or your approved number
      to: "whatsapp:+918308877559",
      body: messageBody,
      mediaUrl: [imageUrl], // this should be a public image URL
    });

    console.log("WhatsApp message sent:", JSON.stringify(message));
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
  }
};

exports.sendTextMessage = async (invoice, customer) => {
  try {
    console.log(generateMarathiInvoiceParams(invoice, customer));

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

function generateMarathiInvoiceMessage(invoice, customer) {
  const date = new Date(invoice.createdAt).toLocaleDateString("hi-IN");
  const billNo =
    invoice.invoiceNumber || invoice._id.toString().slice(-6).toUpperCase();
  const customerName = customer.fullName || "ग्राहक";

  // Generate product lines
  const productLines = invoice.buyingProducts
    .map((item, index) => {
      const qtyUnit = item.quantity + (item.unit || " नग");
      const line = `${index + 1}️ ${item.name} (${qtyUnit}) - ₹${item.price}`;
      return line;
    })
    .join("\n");

  const { subtotal, discount, total } = invoice.billingSummary || {};
  const paymentMethod =
    {
      ONLINE: "GPay / PhonePe / कार्ड",
      CASH: "रोख",
      CREDIT: "उधार",
    }[invoice.transactionType] || "निवडलेले नाही";

  return ` भगरे सुपर मार्केट 
━━━━━━━━━━━━━━━
दिनांक: ${date}
बिल क्रमांक: ${billNo}
ग्राहक: ${customerName}

खरेदीची माहिती:
${productLines}

━━━━━━━━━━━━━━━
एकूण रक्कम: ₹${subtotal || 0}
सवलत: ₹${discount || 0}
देय रक्कम: ₹${total || 0}

पेमेंट प्रकार: ${paymentMethod}`;
}
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
