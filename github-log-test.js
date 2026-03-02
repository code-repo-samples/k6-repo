import http from 'k6/http';
import { sleep } from 'k6';

/**
 * k6 load test configuration.
 *
 * We use a constant arrival rate executor to strictly control TPS.
 * - rate: 2  → 2 iterations per second (2 TPS)
 * - timeUnit: '1s' → rate is measured per second
 * - duration: '30s' → test runs for 30 seconds
 * - preAllocatedVUs: Pre-creates virtual users to handle load
 * - maxVUs: Maximum VUs allowed if scaling is needed
 */
export const options = {
  scenarios: {
    controlled_tps: {
      executor: 'constant-arrival-rate',
      rate: 2,              // 2 iterations per second (2 TPS)
      timeUnit: '1s',
      duration: '30m',
      preAllocatedVUs: 5,
      maxVUs: 10,
    },
  },
};

/**
 * Default function executed per iteration.
 *
 * Each iteration:
 * 1. Runs a loop 50 times
 * 2. Prints multiple console logs per loop iteration
 * 3. Makes a simple HTTP request
 *
 * Even at 2 TPS, heavy logging inside loops
 * can generate thousands of log lines quickly.
 */
export default function () {
  console.log(`Starting iteration at ${new Date().toISOString()}`);

  // Loop that generates a lot of logs
  for (let i = 1; i <= 100; i++) {

    // Example log line #1
    console.log(`Loop ${i}: Preparing request payload`);

    // Example log line #2
    console.log(`Loop ${i}: Sending HTTP GET request`);

    // Perform a sample HTTP request
    const response = http.get('https://test.k6.io');

    // Example log line #3
    console.log(`Loop ${i}: Received status ${response.status}`);

    // Example log line #4
    console.log(`Loop ${i}: Response length ${response.body.length}`);
  }

  console.log(`Finished iteration at ${new Date().toISOString()}`);

  // Small sleep to simulate think time (not required for TPS control,
  // since constant-arrival-rate already enforces 2 TPS)
  sleep(0.1);
}
