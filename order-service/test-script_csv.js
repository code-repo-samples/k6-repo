import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

// 1. Load CSV data into a SharedArray (efficient for many VUs)
const csvData = new SharedArray('user data', function () {
  // We assume 'data.csv' is uploaded to the same folder as this script
  return papaparse.parse(open('./data.csv'), { header: true }).data;
});

// 2. Capture the AuthHeader from the environment (passed via Cloud Run)
const AUTH_HEADER = __ENV.AUTH_HEADER || 'default-token';

export const options = {
  vus: 2,
  duration: '50s',
};

export default function () {
  // Select a row based on the current iteration
  const row = csvData[__ITER % csvData.length];

  console.log(`[VU ${__VU}] Using CSV Record: User=${row.username}, ID=${row.id}`);
  console.log(`[VU ${__VU}] Using Auth Header: ${AUTH_HEADER}`);

  // Simulating an API call with the data
  const res = http.get('https://test.k6.io');
  
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
