/**
 * ============================================================
 * K6 Script with GCP JWT Authentication
 * ============================================================
 * 
 * Demonstrates GCP authentication for:
 *  ✓ Cloud Run services
 *  ✓ Cloud Functions
 *  ✓ API Gateway
 *  ✓ Any GCP service requiring authentication
 * 
 * RECOMMENDED APPROACH: Pre-generate tokens with gcloud CLI
 * This is simpler and more reliable than runtime JWT generation
 * 
 * USAGE:
 *   # 1. Generate token
 *   export GCP_TOKEN=$(gcloud auth print-identity-token \
 *     --audiences=https://my-service-abc123.run.app)
 *   
 *   # 2. Run test
 *   k6 run gcp_test.js \
 *     --env GCP_TOKEN=$GCP_TOKEN \
 *     --env API_ENDPOINT=https://my-service-abc123.run.app \
 *     2> error.log
 */

import http from 'k6/http';
import { check, group } from 'k6';
import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';
import { PerformanceFramework } from './performance-framework.js';
import { 
    generateReport,
    printConsoleReport,
    initializeMetrics, 
    getCurrentPhase, 
    recordMetrics 
} from './reporting-framework.js';

/* ============================================================
   CONFIGURATION
   ============================================================ */

const API_ENDPOINT = __ENV.API_ENDPOINT || 'https://my-service.run.app';
const GCP_TOKEN = __ENV.GCP_TOKEN;  // Pre-generated token
const PRINT_CONSOLE_REPORT = __ENV.PRINT_CONSOLE_REPORT === 'true';

if (!GCP_TOKEN) {
    console.error(`
    ❌ GCP_TOKEN not set!
    
    Generate token with:
      gcloud auth print-access-token
    Or for Cloud Run/Functions:
      gcloud auth print-identity-token --audiences=${API_ENDPOINT}
    
    Then run:
      k6 run gcp_test.js --env GCP_TOKEN=\$token
    `);
    throw new Error('GCP_TOKEN required');
}

const SLA = {
    get_users: { p90: 500, p95: 800, p99: 1200 },
    create_user: { p90: 800, p95: 1200, p99: 2000 },
    health_check: { p90: 200, p95: 300, p99: 500 }
};

const TEST_APIS = ['health_check', 'get_users', 'create_user'];

/* ============================================================
   SCENARIO CONFIGURATION
   ============================================================ */

const SCENARIO_CONFIG = {
    gcp_cloud_run_test: {
        name: 'GCP Cloud Run Test',
        startTime: '0s',
        phases: [
            { name: 'Warm Up', duration: '1m', target: 5 },
            { name: 'Steady Load', duration: '5m', target: 10 },
        ],
        gracefulRampDown: '30s',
        gracefulStop: '30s',
    }
};

const SCENARIOS = Object.keys(SCENARIO_CONFIG);

/* ============================================================
   INITIALIZE FRAMEWORKS
   ============================================================ */

const pf = new PerformanceFramework({ 
    debug: false,
    logErrors: true
});

const metrics = initializeMetrics(TEST_APIS, SCENARIOS, SCENARIO_CONFIG);

let testStartTime = null;

/* ============================================================
   K6 OPTIONS
   ============================================================ */

export const options = {
    scenarios: {
        gcp_cloud_run_test: {
            executor: 'ramping-vus',
            startTime: SCENARIO_CONFIG.gcp_cloud_run_test.startTime,
            startVUs: 0,
            stages: SCENARIO_CONFIG.gcp_cloud_run_test.phases.map(p => ({
                duration: p.duration,
                target: p.target
            })),
            gracefulRampDown: SCENARIO_CONFIG.gcp_cloud_run_test.gracefulRampDown,
            gracefulStop: SCENARIO_CONFIG.gcp_cloud_run_test.gracefulStop,
        }
    },
    thresholds: generateThresholds(SLA, TEST_APIS, SCENARIOS, SCENARIO_CONFIG),
};

function generateThresholds(SLA, apis, scenarios, scenarioConfig) {
    const thresholds = {};
    
    for (const api of apis) {
        for (const scenarioKey of scenarios) {
            if (SLA[api]?.p90 !== undefined) {
                thresholds[`duration_${api}_${scenarioKey}`] = [
                    `p(90)<${SLA[api].p90}`
                ];
            }
        }
    }
    
    return thresholds;
}

/* ============================================================
   SETUP PHASE
   ============================================================ */

export function setup() {
    console.log('=== SETUP: Initializing GCP Authentication ===');
    
    testStartTime = Date.now();
    
    // Get GCP token (validates it exists)
    const token = pf.getGCPToken(GCP_TOKEN, true);
    
    console.log(`✓ GCP Token configured: ${token.substring(0, 30)}...`);
    console.log(`✓ Endpoint: ${API_ENDPOINT}`);
    console.log('✓ Setup complete\n');
    
    return { testStartTime };
}

/* ============================================================
   MAIN TEST EXECUTION
   ============================================================ */

export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, SCENARIO_CONFIG, data.testStartTime);
    
    // Get GCP auth headers using PerformanceFramework
    const headers = {
        ...pf.getGCPAuthHeaders(GCP_TOKEN),
        'Content-Type': 'application/json'
    };
    
    /* --------------------------------------------------------
       TEST FLOW 1: Health Check
       -------------------------------------------------------- */
    group('Health Check', () => {
        const res = http.get(`${API_ENDPOINT}/health`, { headers });
        
        const statusOk = check(res, {
            'Health: status 200': r => r.status === 200,
            'Health: has status field': r => {
                try {
                    return r.json().status !== undefined;
                } catch (e) {
                    return r.body.includes('ok') || r.body.includes('healthy');
                }
            }
        });
        
        recordMetrics(metrics, 'health_check', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            console.error(`[HEALTH FAILED] Status: ${res.status} | Body: ${res.body.slice(0, 200)}`);
        }
    });
    
    /* --------------------------------------------------------
       TEST FLOW 2: GET Users
       -------------------------------------------------------- */
    group('GET Users', () => {
        const res = http.get(`${API_ENDPOINT}/api/users`, { headers });
        
        const statusOk = check(res, {
            'GET: status 200': r => r.status === 200,
            'GET: has users array': r => {
                try {
                    const body = r.json();
                    return Array.isArray(body.users) || Array.isArray(body);
                } catch (e) {
                    return false;
                }
            }
        });
        
        recordMetrics(metrics, 'get_users', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            console.error(`[GET FAILED] Status: ${res.status} | Body: ${res.body.slice(0, 200)}`);
        }
    });
    
    /* --------------------------------------------------------
       TEST FLOW 3: POST Create User
       -------------------------------------------------------- */
    group('POST Create User', () => {
        const synth = pf.generateSynthetic();
        
        const requestBody = JSON.stringify({
            first_name: synth.firstName,
            last_name: synth.lastName,
            email: synth.email,
            phone: synth.phone
        });
        
        const res = http.post(
            `${API_ENDPOINT}/api/users`,
            requestBody,
            { headers }
        );
        
        const statusOk = check(res, {
            'POST: status 200/201': r => r.status === 200 || r.status === 201,
            'POST: has user_id': r => r.body.includes('user_id') || r.body.includes('id'),
            'POST: success message': r => {
                const body = r.body.toLowerCase();
                return body.includes('success') || body.includes('created');
            }
        });
        
        recordMetrics(metrics, 'create_user', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            console.error(`[POST FAILED] Email: ${synth.email} | Status: ${res.status} | Body: ${res.body.slice(0, 200)}`);
        }
    });
    
    pf.pause(1, 3);
}

/* ============================================================
   TEARDOWN PHASE
   ============================================================ */

export function teardown(data) {
    console.log('\n=== TEARDOWN: Test Complete ===');
}

/* ============================================================
   SUMMARY REPORTING
   ============================================================ */

export function handleSummary(data) {
    const htmlReport = generateReport(
        data, 
        SLA, 
        TEST_APIS, 
        SCENARIOS, 
        SCENARIO_CONFIG
    );
    
    if (PRINT_CONSOLE_REPORT) {
        printConsoleReport(
            data, 
            SLA, 
            TEST_APIS, 
            SCENARIOS, 
            SCENARIO_CONFIG
        );
    }
    
    return {
        'k6-performance-report.html': htmlReport['k6-performance-report.html'],
        'k6-summary.json': JSON.stringify(data),
        'stdout': textSummary(data, { 
            indent: ' ', 
            enableColors: true 
        }),
    };
}

/* ============================================================
   TOKEN GENERATION EXAMPLES
   ============================================================
   
   # For Cloud Run (ID Token)
   gcloud auth print-identity-token \
     --audiences=https://my-service-abc123.run.app
   
   # For Cloud Functions (ID Token)
   gcloud auth print-identity-token \
     --audiences=https://us-central1-project-id.cloudfunctions.net/function-name
   
   # For GCP APIs (Access Token)
   gcloud auth print-access-token
   
   # For API Gateway (ID Token with API Gateway audience)
   gcloud auth print-identity-token \
     --audiences=https://gateway-abc123.apigateway.project-id.cloud.goog
   
   # With impersonation (Service Account)
   gcloud auth print-identity-token \
     --impersonate-service-account=test-sa@project-id.iam.gserviceaccount.com \
     --audiences=https://my-service.run.app
   
   # Long-lived token (for extended tests)
   gcloud auth print-access-token \
     --lifetime=3600
   
   ============================================================
   
   RUN COMMANDS:
   ------------
   
   # Basic run
   export GCP_TOKEN=$(gcloud auth print-identity-token \
     --audiences=https://my-service.run.app)
   
   k6 run gcp_test.js \
     --env GCP_TOKEN=$GCP_TOKEN \
     --env API_ENDPOINT=https://my-service.run.app \
     2> error.log
   
   # With console report
   k6 run gcp_test.js \
     --env GCP_TOKEN=$GCP_TOKEN \
     --env API_ENDPOINT=https://my-service.run.app \
     --env PRINT_CONSOLE_REPORT=true \
     2> error.log
   
   # Using different token types
   # Access Token (for GCP APIs)
   export GCP_TOKEN=$(gcloud auth print-access-token)
   
   # ID Token (for Cloud Run/Functions)
   export GCP_TOKEN=$(gcloud auth print-identity-token \
     --audiences=$API_ENDPOINT)
   
   k6 run gcp_test.js \
     --env GCP_TOKEN=$GCP_TOKEN \
     --env API_ENDPOINT=$API_ENDPOINT \
     2> error.log
   
   ============================================================ */
