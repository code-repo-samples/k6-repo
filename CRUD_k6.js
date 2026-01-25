/**
 * ============================================================
 * Script 01: CRUD User Operations with Correlation & Conditional Flow
 * ============================================================
 * 
 * FEATURES:
 *  ✓ CSV-driven unique data (username, objectId)
 *  ✓ Synthetic data generation for create operations
 *  ✓ Correlation: Create → Get → Update → Delete (30%)
 *  ✓ Conditional execution (skip on failure)
 *  ✓ Error logging to stderr (redirect: 2> error.log)
 *  ✓ Two-phase scenario: Ramp Up + Steady State
 * 
 * USAGE:
 *   k6 run script01_crud.js \
 *     --env BASE_URL=https://api.example.com \
 *     --env AUTH_TOKEN=your_bearer_token \
 *     --env APP_ID=your_app_id \
 *     2> error.log
 * 
 * CSV FORMAT (data/users.csv):
 *   username,objectId
 *   user001,obj_abc123
 *   user002,obj_def456
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

const BASE_URL = __ENV.BASE_URL || 'https://api.example.com';
const AUTH_TOKEN = __ENV.AUTH_TOKEN;
const APP_ID = __ENV.APP_ID;
const PRINT_CONSOLE_REPORT = __ENV.PRINT_CONSOLE_REPORT === 'true';

if (!AUTH_TOKEN || !APP_ID) {
    throw new Error('Missing required environment variables: AUTH_TOKEN and APP_ID');
}

// Define SLA thresholds
const SLA = {
    create_user: { p90: 500, p95: 800, p99: 1200 },
    get_user: { p90: 200, p95: 300, p99: 500 },
    update_user: { p90: 400, p95: 600, p99: 900 },
    delete_user: { p90: 300, p95: 500, p99: 800 }
};

const TEST_APIS = ['create_user', 'get_user', 'update_user', 'delete_user'];

/* ============================================================
   SCENARIO CONFIGURATION - Two Phases
   ============================================================ */

const SCENARIO_CONFIG = {
    crud_flow: {
        name: 'CRUD User Flow',
        startTime: '0s',
        phases: [
            { name: 'Ramp Up', duration: '2m', target: 10 },
            { name: 'Steady State', duration: '5m', target: 10 },
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
    debug: false,       // Disable debug logs for performance
    logErrors: true     // Keep error logging for stderr redirect
});

const metrics = initializeMetrics(TEST_APIS, SCENARIOS, SCENARIO_CONFIG);

let testStartTime = null;

/* ============================================================
   K6 OPTIONS
   ============================================================ */

export const options = {
    scenarios: {
        crud_flow: {
            executor: 'ramping-vus',
            startTime: SCENARIO_CONFIG.crud_flow.startTime,
            startVUs: 0,
            stages: SCENARIO_CONFIG.crud_flow.phases.map(p => ({
                duration: p.duration,
                target: p.target
            })),
            gracefulRampDown: SCENARIO_CONFIG.crud_flow.gracefulRampDown,
            gracefulStop: SCENARIO_CONFIG.crud_flow.gracefulStop,
        }
    },
    thresholds: generateThresholds(SLA, TEST_APIS, SCENARIOS, SCENARIO_CONFIG),
};

/* ============================================================
   THRESHOLD GENERATION
   ============================================================ */

function generateThresholds(SLA, apis, scenarios, scenarioConfig) {
    const thresholds = {};
    
    for (const api of apis) {
        for (const scenarioKey of scenarios) {
            const config = scenarioConfig[scenarioKey];
            
            // Overall scenario-level thresholds
            if (SLA[api]?.p90 !== undefined) {
                thresholds[`duration_${api}_${scenarioKey}`] = [
                    `p(90)<${SLA[api].p90}`
                ];
            }
            
            // Phase-level thresholds
            if (config.phases) {
                config.phases.forEach((phase, index) => {
                    if (SLA[api]?.p90 !== undefined) {
                        thresholds[`duration_${api}_${scenarioKey}_phase${index}`] = [
                            `p(90)<${SLA[api].p90}`
                        ];
                    }
                });
            }
        }
    }
    
    return thresholds;
}

/* ============================================================
   SETUP PHASE
   ============================================================ */

export function setup() {
    console.log('=== SETUP: Loading CSV Data ===');
    
    testStartTime = Date.now();
    
    // Load CSV data with unique usernames and objectIds
    pf.loadDataFiles({
        users: './data/users.csv'
    });
    
    console.log('✓ Setup complete\n');
    
    return { testStartTime };
}

/* ============================================================
   MAIN TEST EXECUTION
   ============================================================ */

export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, SCENARIO_CONFIG, data.testStartTime);
    
    // Common headers
    const headers = {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
        'X-App-ID': APP_ID
    };
    
    // Get unique CSV data (abort if exhausted)
    const csvData = pf.getCSVData('users', 'unique', false); // No loop, stop when exhausted
    
    // Generate synthetic data for create operation
    const synth = pf.generateSynthetic();
    
    // Correlation variables
    let userId = null;
    let customerId = null;
    let objectId = csvData.objectId;
    let emailId = synth.email;
    
    /* --------------------------------------------------------
       STEP 1: CREATE USER
       -------------------------------------------------------- */
    group('Create User', () => {
        const createPayload = {
            username: csvData.username,
            email: emailId,
            first_name: synth.firstName,
            last_name: synth.lastName,
            phone: synth.phone,
            object_id: objectId,
            address: {
                street: synth.street,
                city: synth.city,
                country: synth.country,
                zip_code: synth.zipCode
            }
        };
        
        const res = http.post(
            `${BASE_URL}/api/users`,
            JSON.stringify(createPayload),
            { headers }
        );
        
        // Check status code and message if present
        const statusOk = check(res, {
            'Create: status 200/201': r => r.status === 200 || r.status === 201,
            'Create: has success message': r => {
                if (r.body.includes('message')) {
                    return r.json('message')?.toLowerCase().includes('success') ||
                           r.json('message')?.toLowerCase().includes('created');
                }
                return true; // Status code is primary check
            }
        });
        
        recordMetrics(metrics, 'create_user', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            // Log error to stderr (redirect with 2> error.log)
            console.error(`[CREATE FAILED] VU:${exec.vu.idInTest} | Email:${emailId} | Status:${res.status} | Body:${res.body.slice(0, 200)}`);
            return; // Skip remaining steps
        }
        
        // Extract correlation IDs
        try {
            const jsonBody = res.json();
            userId = jsonBody.user_id || jsonBody.id || pf.extract(res, 'user_id');
            customerId = jsonBody.customer_id || pf.extract(res, 'customer_id');
            objectId = jsonBody.object_id || objectId;
            emailId = jsonBody.email || emailId;
            
            if (!userId || !customerId) {
                console.error(`[CREATE CORRELATION FAILED] VU:${exec.vu.idInTest} | Missing user_id or customer_id in response`);
                return; // Skip remaining steps
            }
        } catch (err) {
            console.error(`[CREATE PARSE ERROR] VU:${exec.vu.idInTest} | ${err.message}`);
            return;
        }
    });
    
    // Exit if create failed
    if (!userId || !customerId) return;
    
    /* --------------------------------------------------------
       STEP 2: GET USER
       -------------------------------------------------------- */
    group('Get User', () => {
        const res = http.get(
            `${BASE_URL}/api/users/${customerId}`,
            { headers }
        );
        
        const statusOk = check(res, {
            'Get: status 200': r => r.status === 200,
            'Get: has customer_id': r => r.body.includes(customerId),
            'Get: has email': r => r.body.includes(emailId)
        });
        
        recordMetrics(metrics, 'get_user', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            console.error(`[GET FAILED] VU:${exec.vu.idInTest} | CustomerID:${customerId} | Status:${res.status} | Body:${res.body.slice(0, 200)}`);
            return; // Skip remaining steps
        }
    });
    
    /* --------------------------------------------------------
       STEP 3: UPDATE USER
       -------------------------------------------------------- */
    group('Update User', () => {
        const updatePayload = {
            customer_id: customerId,
            email: emailId,
            phone: `555${Math.floor(1000000 + Math.random() * 8999999)}`, // New phone
            address: {
                street: synth.street,
                city: 'Updated City',
                country: synth.country,
                zip_code: synth.zipCode
            }
        };
        
        const res = http.put(
            `${BASE_URL}/api/users/${customerId}`,
            JSON.stringify(updatePayload),
            { headers }
        );
        
        const statusOk = check(res, {
            'Update: status 200': r => r.status === 200,
            'Update: has success message': r => {
                if (r.body.includes('message')) {
                    return r.json('message')?.toLowerCase().includes('success') ||
                           r.json('message')?.toLowerCase().includes('updated');
                }
                return true;
            }
        });
        
        recordMetrics(metrics, 'update_user', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            console.error(`[UPDATE FAILED] VU:${exec.vu.idInTest} | CustomerID:${customerId} | Status:${res.status} | Body:${res.body.slice(0, 200)}`);
            return; // Skip delete step
        }
    });
    
    /* --------------------------------------------------------
       STEP 4: DELETE USER (30% of calls)
       -------------------------------------------------------- */
    const shouldDelete = Math.random() < 0.30; // 30% probability
    
    if (shouldDelete) {
        group('Delete User', () => {
            const res = http.del(
                `${BASE_URL}/api/users?object_id=${objectId}`,
                null,
                { headers }
            );
            
            const statusOk = check(res, {
                'Delete: status 200/204': r => r.status === 200 || r.status === 204,
                'Delete: has success message': r => {
                    if (r.body && r.body.includes('message')) {
                        return r.json('message')?.toLowerCase().includes('success') ||
                               r.json('message')?.toLowerCase().includes('deleted');
                    }
                    return true;
                }
            });
            
            recordMetrics(metrics, 'delete_user', scenarioName, currentPhase, res);
            
            if (!statusOk) {
                console.error(`[DELETE FAILED] VU:${exec.vu.idInTest} | ObjectID:${objectId} | Status:${res.status} | Body:${res.body.slice(0, 200)}`);
            }
        });
    }
    
    // Think time between iterations
    pf.pause(1, 2);
}

/* ============================================================
   SUMMARY REPORTING
   ============================================================ */

export function handleSummary(data) {
    // Generate HTML report using reporting framework
    const htmlReport = generateReport(
        data, 
        SLA, 
        TEST_APIS, 
        SCENARIOS, 
        SCENARIO_CONFIG
    );
    
    // Print console report if enabled
    if (PRINT_CONSOLE_REPORT) {
        printConsoleReport(
            data, 
            SLA, 
            TEST_APIS, 
            SCENARIOS, 
            SCENARIO_CONFIG
        );
    }
    
    // Return multiple output formats
    return {
        // HTML report for browser viewing (from reporting framework)
        'k6-performance-report.html': htmlReport['k6-performance-report.html'],
        
        // JSON for CI/CD integration
        'k6-summary.json': JSON.stringify(data),
        
        // Standard k6 text summary to stdout (default k6 metrics)
        'stdout': textSummary(data, { 
            indent: ' ', 
            enableColors: true 
        }),
    };
}

/* ============================================================
   EXAMPLE CSV FILE
   ============================================================
   
   data/users.csv:
   ---------------
   username,objectId
   user001,obj_abc123
   user002,obj_def456
   user003,obj_ghi789
   user004,obj_jkl012
   user005,obj_mno345
   
   RUN COMMAND:
   ------------
   k6 run script01_crud.js \
     --env BASE_URL=https://api.example.com \
     --env AUTH_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... \
     --env APP_ID=app_12345 \
     --env PRINT_CONSOLE_REPORT=true \
     2> error.log
   
   ============================================================ */
