const twilio = require("twilio");
const accountSid = "AC579d13b5f9faef79cf3d789d24d5fca9";
const authToken = "513dbba59279e3fa417048065af4c981";
const client = new twilio(accountSid, authToken);

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
