// src/utils/networkDetector.js

function detectNetwork(phone) {
  if (!phone) return null;

  // Normalize phone number
  let cleaned = phone.toString().trim();

  // Convert +234 to 0
  if (cleaned.startsWith('+234')) {
    cleaned = '0' + cleaned.slice(4);
  }

  // Remove non-digits
  cleaned = cleaned.replace(/\D/g, '');

  // Must be Nigerian number
  if (!cleaned.startsWith('0') || cleaned.length < 10) {
    return null;
  }

  const prefix = cleaned.substring(0, 4);

  const networks = {
    mtn: [
      '0803','0806','0703','0706','0813','0816','0810','0814',
      '0903','0906','0913','0916'
    ],
    airtel: [
      '0802','0808','0708','0812','0701',
      '0902','0907','0901','0912'
    ],
    glo: [
      '0805','0807','0705','0815','0811',
      '0905','0915'
    ],
    etisalat: [
      '0809','0817','0818','0909','0908'
    ]
  };

  for (const [network, prefixes] of Object.entries(networks)) {
    if (prefixes.includes(prefix)) {
      return network;
    }
  }

  return null; // Never crash system
}

module.exports = { detectNetwork };
