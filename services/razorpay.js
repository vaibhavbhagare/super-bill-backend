const crypto = require("crypto");
const Razorpay = require("razorpay");

function getRazorpayKeys() {
  const keyId = process.env.RAZORPAY_KEY_ID || "";
  const keySecret = process.env.RAZORPAY_KEY_SECRET || "";
  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured on the server");
  }
  return { keyId, keySecret };
}

function getRazorpayClient() {
  const { keyId, keySecret } = getRazorpayKeys();
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function verifyRazorpaySignature(orderId, paymentId, signature) {
  const { keySecret } = getRazorpayKeys();
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature || "");
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

function verifyRazorpayWebhook(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
  if (!secret || !signature || typeof rawBody !== "string") return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = {
  getRazorpayKeys,
  getRazorpayClient,
  verifyRazorpaySignature,
  verifyRazorpayWebhook,
};
