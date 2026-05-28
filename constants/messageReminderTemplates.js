const MESSAGE_REMINDER_TEMPLATES = [
  {
    id: "without_amount",
    label: "Udhar Reminder (No Amount)",
    includeAmount: false,
    contentSidEnvKey: "TWILLO_REMINDER_MESSAGE_1",
    message:
      "नमस्कार, आपल्या उधारीची आठवण करून देत आहोत. कृपया लवकरात लवकर पैसे जमा करा. {{storeName}}- धन्यवाद.",
  },
  {
    id: "with_amount",
    label: "Udhar Reminder (With Amount)",
    includeAmount: true,
    contentSidEnvKey: "TWILLO_REMINDER_MESSAGE_WITH_AMOUNT",
    message:
      "नमस्कार, आपल्या खात्यावर ₹{{amount}} उधारी बाकी आहे. कृपया लवकरात लवकर पैसे जमा करा. {{storeName}}- धन्यवाद.",
  },
  {
    id: "friendly",
    label: "Friendly Payment Reminder",
    includeAmount: false,
    contentSidEnvKey: "TWILLO_REMINDER_MESSAGE_2",
    message:
      "नमस्कार, आपल्या बाकी रकमेबद्दल ही नम्र आठवण आहे. कृपया पेमेंट करा. {{storeName}}- धन्यवाद.",
  },
];

module.exports = { MESSAGE_REMINDER_TEMPLATES };
