import http from 'k6/http';
import { sleep, group } from 'k6';
import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { generateReport, printConsoleReport, initializeMetrics, getCurrentPhase,
    recordMetrics 
 } from './reporting-framework.js';

const SLA = JSON.parse(open('./sla.json'));
const PRINT_CONSOLE_REPORT = __ENV.PRINT_CONSOLE_REPORT === 'true';

/* ----------------- Define Test Configuration ----------------- */
const testApis = ['home', 'pizza', 'recommendations'];

/* ----------------- Scenario Configuration with Multiple Phases ----------------- */
const scenarioConfig = {
    complex_load_test: {
        name: 'Complex Load Test',
        startTime: '0s',
        phases: [
            { name: 'Ramp Up to 100 TPS', duration: '1s', target: 10 },
            { name: 'Low Load Soak Test', duration: '1s', target: 10 },
        ],
        gracefulRampDown: '30s',
        gracefulStop: '30s',
    },
    stress_test: {
        name: 'Stress Test',
        startTime: '10s',
        phases: [
            { name: 'Peak Stress', duration: '1s', target: 3 },
        ],
        gracefulRampDown: '30s',
        gracefulStop: '30s',
    }
};

// Derive scenarios list from config
const scenarios = Object.keys(scenarioConfig);

/* ----------------- Initialize Metrics for APIs, Scenarios, and Phases ----------------- */
const metrics = initializeMetrics(testApis, scenarios, scenarioConfig);

// Track test start time globally
let testStartTime = null;

/* ----------------- k6 Options ----------------- */
export const options = {
    scenarios: {},
    thresholds: generateThresholds(SLA, testApis, scenarios, scenarioConfig),
};

// Dynamically build k6 scenarios from config
for (const [scenarioKey, config] of Object.entries(scenarioConfig)) {
    options.scenarios[scenarioKey] = {
        executor: 'ramping-vus',
        startTime: config.startTime || '0s',
        startVUs: 0,
        stages: config.phases.map(p => ({ 
            duration: p.duration, 
            target: p.target 
        })),
        gracefulRampDown: config.gracefulRampDown,
        gracefulStop: config.gracefulStop,
    };
}

/* ----------------- Thresholds per API per Scenario per Phase ----------------- */
function generateThresholds(SLA, apis, scenarios, scenarioConfig) {
    const thresholds = {};
    
    for (const api of apis) {
        for (const scenarioKey of scenarios) {
            const config = scenarioConfig[scenarioKey];
            
            // Overall scenario thresholds
            if (SLA[api]?.p90 !== undefined) {
                thresholds[`duration_${api}_${scenarioKey}`] = [`p(90)<${SLA[api].p90}`];
            }
            
            // Per-phase thresholds
            if (config.phases) {
                config.phases.forEach((phase, index) => {
                    if (SLA[api]?.p90 !== undefined) {
                        thresholds[`duration_${api}_${scenarioKey}_phase${index}`] = [`p(90)<${SLA[api].p90}`];
                    }
                });
            }
        }
    }
    
    return thresholds;
}

/* ----------------- Setup - Record Test Start Time ----------------- */
export function setup() {
    testStartTime = Date.now();
    return { testStartTime };
}

/* ----------------- Test Script ----------------- */
export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, scenarioConfig, data.testStartTime);
    
    group(`${scenarioName} - Home`, () => {
        const res = http.get('https://quickpizza.grafana.com/');
        recordMetrics(metrics,'home', scenarioName, currentPhase, res);
    });

    group(`${scenarioName} - Pizza`, () => {
        const res = http.get('https://quickpizza.grafana.com/api/pizza-invalid');
        recordMetrics(metrics, 'pizza', scenarioName, currentPhase, res);
    });

    group(`${scenarioName} - Recommendations`, () => {
        const res = http.get('https://httpbin.test.k6.io/delay/1');
        recordMetrics(metrics, 'recommendations', scenarioName, currentPhase, res);
    });
}

// /* ----------------- Determine Current Phase Based on Time ----------------- */
// function getCurrentPhase(scenarioName, scenarioConfig, testStartTime) {
//     const config = scenarioConfig[scenarioName];
//     if (!config?.phases) return null;
    
//     const now = Date.now();
//     const elapsedMs = now - testStartTime;
//     const elapsedSeconds = elapsedMs / 1000;
    
//     const scenarioStartOffset = parseDuration(config.startTime || '0s');
//     const scenarioElapsed = elapsedSeconds - scenarioStartOffset;
    
//     if (scenarioElapsed < 0) return null; // Scenario hasn't started yet
    
//     let cumulativeDuration = 0;
//     for (let i = 0; i < config.phases.length; i++) {
//         const phaseDuration = parseDuration(config.phases[i].duration);
//         if (scenarioElapsed < cumulativeDuration + phaseDuration) {
//             return i;
//         }
//         cumulativeDuration += phaseDuration;
//     }
    
//     return null; // In graceful shutdown phase
// }

// function parseDuration(duration) {
//     if (!duration || duration === '0s') return 0;
    
//     let totalSeconds = 0;
//     const regex = /(\d+)([smh])/g;
//     let match;
    
//     while ((match = regex.exec(duration)) !== null) {
//         const value = parseInt(match[1]);
//         const unit = match[2];
        
//         switch (unit) {
//             case 's': totalSeconds += value; break;
//             case 'm': totalSeconds += value * 60; break;
//             case 'h': totalSeconds += value * 3600; break;
//         }
//     }
    
//     return totalSeconds;
// }

// /* ----------------- Metric Recording Helper ----------------- */
// function recordMetrics(api, scenario, phaseIndex, res) {
//     // Record scenario-level metrics
//     if (metrics[scenario]?.[api]) {
//         metrics[scenario][api].count.add(1);
//         metrics[scenario][api].duration.add(res.timings.duration);
        
//         if (res.status >= 400) {
//             metrics[scenario][api].failed.add(1);
//             const statusMetric = metrics[scenario][api].statusCodes[res.status];
//             if (statusMetric) {
//                 statusMetric.add(1);
//             }
//         }
//     }
    
//     // Record phase-level metrics
//     if (phaseIndex !== null && metrics[scenario]?.phases?.[phaseIndex]?.[api]) {
//         metrics[scenario].phases[phaseIndex][api].count.add(1);
//         metrics[scenario].phases[phaseIndex][api].duration.add(res.timings.duration);
        
//         if (res.status >= 400) {
//             metrics[scenario].phases[phaseIndex][api].failed.add(1);
//             const statusMetric = metrics[scenario].phases[phaseIndex][api].statusCodes[res.status];
//             if (statusMetric) {
//                 statusMetric.add(1);
//             }
//         }
//     }
// }

/* ----------------- Post-test Summary ----------------- */
export function handleSummary(data) {
    const htmlReport = generateReport(data, SLA, testApis, scenarios, scenarioConfig);

    if (PRINT_CONSOLE_REPORT) {
        printConsoleReport(data, SLA, testApis, scenarios, scenarioConfig);
    }

    return {
        'k6-performance-report.html': htmlReport['k6-performance-report.html'],
        'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    };
}