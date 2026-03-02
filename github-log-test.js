import http from 'k6/http';
import { check } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// Track last phase for logging
let lastPhase = '';

export let options = {
  scenarios: {
    tps_test: {
      executor: 'ramping-arrival-rate',
      startRate: 2,      // starting TPS
      timeUnit: '1s',    // rate is per second
      stages: [
        // Steady 2 TPS
        { target: 2, duration: '1m', tags: { phase: 'steady_2_tps' } },

        // Ramp to 10 TPS
        { target: 10, duration: '2m', tags: { phase: 'ramp_to_10_tps' } },

        // Steady 10 TPS
        { target: 10, duration: '1m', tags: { phase: 'steady_10_tps' } },

        // Ramp to 20 TPS
        { target: 20, duration: '2m', tags: { phase: 'ramp_to_20_tps' } },

        // Steady 20 TPS
        { target: 20, duration: '1m', tags: { phase: 'steady_20_tps' } },

        // Ramp down to 0 TPS
        { target: 0, duration: '1m', tags: { phase: 'ramp_down' } },
      ],
      preAllocatedVUs: 50,   // estimate based on expected TPS * response time
      maxVUs: 200,
    },
  },
};

/**
 * Returns the current stage tag based on scenario progress
 */
function getCurrentPhase() {
  const stages = options.scenarios.tps_test.stages;
  const totalDurationSec = stages.reduce((sum, s) => sum + parseDuration(s.duration), 0);
  const elapsedSec = __ITER / 2; // rough estimate (per VU)
  let cumulative = 0;
  for (let stage of stages) {
    cumulative += parseDuration(stage.duration);
    if (elapsedSec <= cumulative) {
      return stage.tags.phase;
    }
  }
  return stages[stages.length - 1].tags.phase;
}

/**
 * Converts duration strings to seconds
 */
function parseDuration(dur) {
  if (dur.endsWith('s')) return parseInt(dur);
  if (dur.endsWith('m')) return parseInt(dur) * 60;
  return parseInt(dur);
}

export default function () {
  // Track phase transitions for minimal logging
  const phase = getCurrentPhase();
  if (phase !== lastPhase) {
    lastPhase = phase;
    console.log(`>>> Entering phase: ${phase}`);
  }

  // API 1: Always runs
  let getResp = http.get('https://jsonplaceholder.typicode.com/posts/1', { tags: { phase } });
  check(getResp, { 'GET status 200': (r) => r.status === 200 });

  // API 2: 50% of iterations
  if (Math.random() < 0.5) {
    let payload = JSON.stringify({ title: 'foo', body: 'bar', userId: 1 });
    let params = { headers: { 'Content-Type': 'application/json' }, tags: { phase } };
    let postResp = http.post('https://jsonplaceholder.typicode.com/posts', payload, params);
    check(postResp, { 'POST status 201': (r) => r.status === 201 });
  }
}

/**
 * Custom summary output
 */
export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
