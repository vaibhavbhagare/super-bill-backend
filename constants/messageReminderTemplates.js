const MESSAGE_REMINDER_TEMPLATES = [
  {
    id: "without_amount",
    label: "Udhar Reminder (No Amount)",
    includeAmount: false,
    contentSidEnvKey: "TWILLO_REMINDER_MESSAGE_1",
    storeNameVariableKey: "1",
    message:
      "नमस्कार, आपल्या उधारीची आठवण करून देत आहोत. कृपया लवकरात लवकर पैसे जमा करा. {{storeName}}- धन्यवाद.",
  },
  {
    id: "with_amount",
    label: "Udhar Reminder (With Amount)",
    includeAmount: true,
    contentSidEnvKey: "TWILLO_REMINDER_MESSAGE_WITH_AMOUNT",
    amountVariableKey: "1",
    storeNameVariableKey: "2",
    message:
      "नमस्कार, आपल्या खात्यावर ₹{{amount}} उधारी बाकी आहे. कृपया लवकरात लवकर पैसे जमा करा. {{storeName}}- धन्यवाद.",
  },
  {
    id: "friendly",
    label: "Friendly Payment Reminder",
    includeAmount: false,
    contentSidEnvKey: "TWILLO_REMINDER_MESSAGE_2",
    storeNameVariableKey: "1",
    message:
      "नमस्कार, आपल्या बाकी रकमेबद्दल ही नम्र आठवण आहे. कृपया पेमेंट करा. {{storeName}}- धन्यवाद.",
  },
  {
    id: "payment_received_balance",
    label: "Payment Received (Balance Remaining)",
    includeAmount: true,
    includeBalance: true,
    contentSidEnvKey: "TWILLO_REMINDER_PAYMENT_RECEIVED",
    amountVariableKey: "1",
    balanceVariableKey: "2",
    storeNameVariableKey: "3",
    message:
      "नमस्कार, आपले ₹{{amount}} पेमेंट आम्हाला प्राप्त झाले आहे. सध्या खात्यावर ₹{{balance}} उधारी बाकी आहे. {{storeName}}- धन्यवाद.",
  },
  {
    id: "payment_received_settled",
    label: "Payment Received (Account Settled)",
    includeAmount: true,
    includeBalance: false,
    contentSidEnvKey: "TWILLO_REMINDER_PAYMENT_SETTLED",
    amountVariableKey: "1",
    storeNameVariableKey: "3",
    message:
      "नमस्कार, आपले ₹{{amount}} पेमेंट आम्हाला प्राप्त झाले आहे. आपले खाते पूर्णपणे सेट झाले आहे. {{storeName}}- धन्यवाद.",
  },
];

module.exports = { MESSAGE_REMINDER_TEMPLATES };
