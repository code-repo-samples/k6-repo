import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend } from 'k6/metrics';
// Professional reporters
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

// Custom metric to track a specific business logic
const checkoutDuration = new Trend('checkout_duration');

export const options = {
  scenarios: {
    browse_products: {
      executor: 'constant-vus',
      vus: 2,
      duration: '10s',
      exec: 'browse',
    },
    quick_checkout: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 5,
      startTime: '2s',
      exec: 'checkout',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
  },
};

export function browse() {
  group('Browse Flow', function () {
    const res = http.get('https://test.k6.io/news.php');
    check(res, { 'is news page': (r) => r.status === 200 });
    sleep(1);
  });
}

export function checkout() {
  group('Checkout Flow', function () {
    const res = http.get('https://test.k6.io/contacts.php');
    checkoutDuration.add(res.timings.duration);
    check(res, { 'is contacts page': (r) => r.status === 200 });
    sleep(0.5);
  });
}

// THIS GENERATES THE FILES FOR YOUR RESULTS FOLDER
export function handleSummary(data) {
  return {
    // 1. The custom HTML report (Matches path in your entrypoint.sh)
    '/tmp/work/results/summary.html': htmlReport(data),
    
    // 2. A raw text summary for quick reading in Logs
    '/tmp/work/results/summary.txt': textSummary(data, { indent: ' ', enableColors: false }),
    
    // 3. Keep standard output so it shows in Google Cloud Logs
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
  };
}
