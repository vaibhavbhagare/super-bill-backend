const nodeHtmlToImage = require("node-html-to-image");
const twilio = require("twilio");
const accountSid = "AC579d13b5f9faef79cf3d789d24d5fca9";
const authToken = "513dbba59279e3fa417048065af4c981";
const client = new twilio(accountSid, authToken);

const imageUrl1 = "https://super-bill-backend-ps3e.vercel.app/images/bill-image.png";

exports.sendWhatsAppMessage = async (
  customerName,
  amount,
  phoneNumber,
  imageUrl
) => {
  try {
    const bill = {
      _id: "686571a15ddde0804ac11f53",
      invoiceNumber: "1s212",
      customer: "6855248cb749817241a3d0a2",
      billerName: "User Name",
      transactionType: "ONLINE",
      paymentStatus: "PAID",
      createdAt: "2025-07-02T17:51:29.524Z",
      buyingProducts: [
        {
          name: "Product Name",
          secondName: "supream",
          quantity: 1,
          price: 100,
          mrp: 120,
          discount: 10,
          subtotal: 200,
        },
        {
          name: "",
          secondName: "",
          quantity: 1,
          price: 100,
          mrp: 120,
          discount: 10,
          subtotal: 200,
        },
      ],
      billingSummary: {
        subtotal: 220,
        discount: 20,
        gst: 0,
        total: 200,
      },
    };

    const html = `
  <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 40px;
          font-size: 14px;
          background: #fff;
        }
        h2, h3 {
          margin: 0 0 10px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          padding: 8px 12px;
          border: 1px solid #ccc;
        }
        th {
          background: #f2f2f2;
        }
        .summary {
          margin-top: 20px;
        }
        .summary p {
          margin: 4px 0;
        }
        .footer {
          margin-top: 40px;
          font-size: 12px;
          color: #777;
        }
      </style>
    </head>
    <body>
      <h2>Invoice #: ${bill.invoiceNumber}</h2>
      <p><strong>Invoice ID:</strong> ${bill._id}</p>
      <p><strong>Biller:</strong> ${bill.billerName}</p>
      <p><strong>Payment:</strong> ${bill.transactionType} (${bill.paymentStatus})</p>
      <p><strong>Date:</strong> ${new Date(bill.createdAt).toLocaleString()}</p>

      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Second Name</th>
            <th>Qty</th>
            <th>Price</th>
            <th>MRP</th>
            <th>Discount</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${bill.buyingProducts
            .map(
              (p) => `
            <tr>
              <td>${p.name || "-"}</td>
              <td>${p.secondName || "-"}</td>
              <td>${p.quantity}</td>
              <td>₹${p.price}</td>
              <td>₹${p.mrp}</td>
              <td>₹${p.discount}</td>
              <td>₹${p.subtotal}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>

      <div class="summary">
        <h3>Summary</h3>
        <p><strong>Subtotal:</strong> ₹${bill.billingSummary.subtotal}</p>
        <p><strong>Discount:</strong> ₹${bill.billingSummary.discount}</p>
        <p><strong>GST:</strong> ₹${bill.billingSummary.gst}</p>
        <p><strong>Total:</strong> ₹${bill.billingSummary.total}</p>
      </div>

      <div class="footer">
        Generated on ${new Date().toLocaleString()}
      </div>
    </body>
  </html>
`;

    await nodeHtmlToImage({
      output: "./bill-image.png",
      html: html,
    }).then(() => {
      console.log("✅ Bill image created: bill-image.png");
    });

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
      mediaUrl: [imageUrl1], // this should be a public image URL
    });

    console.log("WhatsApp message sent:", JSON.stringify(message));
  } catch (error) {
    console.error("Error sending WhatsApp message:", error);
  }
};
