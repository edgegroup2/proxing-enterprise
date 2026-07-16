'use strict';

const axios = require('axios');

const BASE_URL = 'https://vtpass.com/api';

function extractVariationList(data) {
  if (!data) return [];

  const candidates = [
    data?.content?.variations,
    data?.content2?.variations,
    data?.content?.[0]?.variations,
    data?.variations,
    Array.isArray(data?.content) ? data.content : null
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }

  return [];
}

async function fetchVariations(serviceID) {

  const url = `${BASE_URL}/service-variations?serviceID=${serviceID}`;

  const res = await axios.get(url, {
    timeout: 20000
  });

  return extractVariationList(res.data);
}

function printRows(title, rows) {

  console.log('\n====================================================');
  console.log(title);
  console.log('====================================================');

  if (!rows.length) {
    console.log('No variations returned.');
    return;
  }

  rows.forEach((row, i) => {

    console.log(`\n[${i + 1}]`);
    console.log(`variation_code : ${row?.variation_code ?? ''}`);
    console.log(`name           : ${row?.name ?? ''}`);
    console.log(`variation      : ${row?.variation ?? ''}`);
    console.log(`amount         : ${row?.amount ?? ''}`);
    console.log(`price          : ${row?.price ?? ''}`);
    console.log(`variation_amt  : ${row?.variation_amount ?? ''}`);

  });

}

async function main() {

  const services = [
    { label: 'MTN DATA', serviceId: 'mtn-data' },
    { label: 'AIRTEL DATA', serviceId: 'airtel-data' },
    { label: 'GLO DATA', serviceId: 'glo-data' },
    { label: '9MOBILE DATA', serviceId: 'etisalat-data' }
  ];

  for (const s of services) {

    try {

      const variations = await fetchVariations(s.serviceId);

      printRows(`${s.label} (${s.serviceId})`, variations);

    } catch (err) {

      console.log('\n====================================================');
      console.log(`${s.label} (${s.serviceId})`);
      console.log('====================================================');

      console.log(`ERROR: ${err.message}`);

    }

  }

}

main();

