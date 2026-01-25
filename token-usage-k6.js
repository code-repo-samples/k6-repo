/**
 * ============================================================
 * Script 02: High TPS Test with Token Auto-Renewal
 * ============================================================
 * 
 * FEATURES:
 *  ✓ 10 TPS steady state load
 *  ✓ CSV-driven random data for GET/POST calls
 *  ✓ Token pool for 5 users (from CSV)
 *  ✓ Token auto-renewal every 9 minutes (expires at 10 min)
 *  ✓ Error logging to error.log
 *  ✓ Status code + text validation
 * 
 * USAGE:
 *   k6 run script02_token.js \
 *     --env BASE_URL=https://api.example.com \
 *     --env TOKEN_URL=https://auth.example.com/token \
 *     2> error.log
 * 
 * CSV FORMATS:
 *   data/test_data.csv:
 *     product_id,category,search_term
 *     prod_001,electronics,laptop
 *     prod_002,books,python
 * 
 *   data/token_users.csv:
 *     email,password
 *     user1@example.com,password123
 *     user2@example.com,password456
 *     user3@example.com,password789
 *     user4@example.com,passwordabc
 *     user5@example.com,passwordxyz
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
const TOKEN_URL = __ENV.TOKEN_URL || 'https://auth.example.com/oauth/token';
const PRINT_CONSOLE_REPORT = __ENV.PRINT_CONSOLE_REPORT === 'true';

// Define SLA thresholds
const SLA = {
    get_product: { p90: 200, p95: 300, p99: 500 },
    create_order: { p90: 500, p95: 800, p99: 1200 },
    search_products: { p90: 400, p95: 600, p99: 900 }
};

const TEST_APIS = ['get_product', 'create_order', 'search_products'];

/* ============================================================
   SCENARIO CONFIGURATION - Steady State Only
   ============================================================ */

const SCENARIO_CONFIG = {
    steady_state: {
        name: 'Steady State - 10 TPS',
        startTime: '0s',
        phases: [
            { name: 'Steady Load', duration: '10m', target: 10 },
        ],
        gracefulRampDown: '20s',
        gracefulStop: '30s',
    }
};

const SCENARIOS = Object.keys(SCENARIO_CONFIG);

/* ============================================================
   INITIALIZE FRAMEWORKS
   ============================================================ */

const pf = new PerformanceFramework({ 
    debug: false,       // No debug logs for 10 TPS
    logErrors: true     // Error logging enabled
});

const metrics = initializeMetrics(TEST_APIS, SCENARIOS, SCENARIO_CONFIG);

let testStartTime = null;
let tokenUsers = null;

/* ============================================================
   K6 OPTIONS
   ============================================================ */

export const options = {
    scenarios: {
        steady_state: {
            executor: 'ramping-vus',
            startTime: SCENARIO_CONFIG.steady_state.startTime,
            startVUs: 0,
            stages: SCENARIO_CONFIG.steady_state.phases.map(p => ({
                duration: p.duration,
                target: p.target
            })),
            gracefulRampDown: SCENARIO_CONFIG.steady_state.gracefulRampDown,
            gracefulStop: SCENARIO_CONFIG.steady_state.gracefulStop,
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
    console.log('=== SETUP: Loading Test Data ===');
    
    testStartTime = Date.now();
    
    // Load test data CSV
    pf.loadDataFiles({
        products: './data/test_data.csv'
    });
    
    // Load token users (5 users)
    try {
        tokenUsers = pf.loadAuthPool('./data/token_users.csv');
        if (tokenUsers.length !== 5) {
            console.warn(`⚠ Expected 5 token users, found ${tokenUsers.length}`);
        }
        console.log(`✓ Loaded ${tokenUsers.length} token users`);
    } catch (err) {
        console.error(`✗ Failed to load token users: ${err.message}`);
        throw err;
    }
    
    console.log('✓ Setup complete\n');
    
    return { testStartTime, tokenUsers };
}

/* ============================================================
   TOKEN MANAGEMENT HELPER
   ============================================================
   Generates token using email/password
   Token expires after 10 minutes, renewed every 9 minutes
   ============================================================ */

function getAuthToken(userCreds, forceRefresh = false) {
    const VU_ID = exec.vu.idInTest;
    const cacheKey = `token_${VU_ID}`;
    
    // Check if token exists and is still valid (< 9 minutes old)
    if (!forceRefresh && __VU[cacheKey]) {
        const tokenAge = (Date.now() - __VU[cacheKey].timestamp) / 1000; // seconds
        
        if (tokenAge < 540) { // 9 minutes = 540 seconds
            return __VU[cacheKey].token;
        } else {
            pf.log(`[TOKEN] Renewing token for ${userCreds.email} (age: ${Math.floor(tokenAge)}s)`);
        }
    }
    
    // Generate new token
    pf.log(`[TOKEN] Generating new token for ${userCreds.email}`);
    
    const tokenPayload = {
        email: userCreds.email,
        password: userCreds.password,
        grant_type: 'password'
    };
    
    const res = http.post(
        TOKEN_URL,
        JSON.stringify(tokenPayload),
        {
            headers: { 'Content-Type': 'application/json' }
        }
    );
    
    if (res.status === 200) {
        try {
            const tokenData = res.json();
            const token = tokenData.id_token || tokenData.access_token;
            
            if (!token) {
                console.error(`[TOKEN ERROR] No id_token/access_token in response for ${userCreds.email}`);
                exec.test.abort('Token generation failed');
            }
            
            // Cache token with timestamp
            __VU[cacheKey] = {
                token: token,
                timestamp: Date.now()
            };
            
            pf.log(`[TOKEN SUCCESS] Token generated for ${userCreds.email}`);
            return token;
            
        } catch (err) {
            console.error(`[TOKEN PARSE ERROR] ${err.message} | User: ${userCreds.email}`);
            exec.test.abort('Token parse failure');
        }
    } else {
        console.error(`[TOKEN FAILED] Status ${res.status} for ${userCreds.email} | Body: ${res.body.slice(0, 200)}`);
        exec.test.abort('Token authentication failed');
    }
}

/* ============================================================
   MAIN TEST EXECUTION
   ============================================================ */

export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, SCENARIO_CONFIG, data.testStartTime);
    
    // Get token user for this VU (distributed across VUs)
    const VU_INDEX = exec.vu.idInTest % data.tokenUsers.length;
    const tokenUser = data.tokenUsers[VU_INDEX];
    
    // Get or refresh token (auto-renews at 9 minutes)
    const token = getAuthToken(tokenUser);
    
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    
    // Get random product data from CSV
    const productData = pf.getCSVData('products', 'random');
    
    /* --------------------------------------------------------
       TEST FLOW 1: GET Product
       -------------------------------------------------------- */
    group('Get Product', () => {
        const res = http.get(
            `${BASE_URL}/api/products/${productData.product_id}`,
            { headers }
        );
        
        const statusOk = check(res, {
            'Get: status 200': r => r.status === 200,
            'Get: has product_id': r => r.body.includes('product_id') || r.body.includes(productData.product_id)
        });
        
        recordMetrics(metrics, 'get_product', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            console.error(`[GET FAILED] VU:${exec.vu.idInTest} | ProductID:${productData.product_id} | Status:${res.status} | Body:${res.body.slice(0, 200)}`);
        }
    });
    
    /* --------------------------------------------------------
       TEST FLOW 2: POST Create Order
       -------------------------------------------------------- */
    group('Create Order', () => {
        const orderPayload = {
            product_id: productData.product_id,
            quantity: Math.floor(Math.random() * 5) + 1,
            customer_email: tokenUser.email
        };
        
        const res = http.post(
            `${BASE_URL}/api/orders`,
            JSON.stringify(orderPayload),
            { headers }
        );
        
        const statusOk = check(res, {
            'Create: status 200/201': r => r.status === 200 || r.status === 201,
            'Create: has order_id': r => r.body.includes('order_id'),
            'Create: has success text': r => {
                const body = r.body.toLowerCase();
                return body.includes('success') || body.includes('created') || body.includes('confirmed');
            }
        });
        
        recordMetrics(metrics, 'create_order', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            console.error(`[CREATE ORDER FAILED] VU:${exec.vu.idInTest} | ProductID:${productData.product_id} | Email:${tokenUser.email} | Status:${res.status} | Body:${res.body.slice(0, 200)}`);
        }
    });
    
    /* --------------------------------------------------------
       TEST FLOW 3: POST Search Products
       -------------------------------------------------------- */
    group('Search Products', () => {
        const searchPayload = {
            search_term: productData.search_term,
            category: productData.category,
            max_results: 10
        };
        
        const res = http.post(
            `${BASE_URL}/api/products/search`,
            JSON.stringify(searchPayload),
            { headers }
        );
        
        const statusOk = check(res, {
            'Search: status 200': r => r.status === 200,
            'Search: has results': r => r.body.includes('results') || r.body.includes('products'),
            'Search: valid response': r => {
                try {
                    const json = r.json();
                    return json.results !== undefined || json.products !== undefined;
                } catch (e) {
                    return false;
                }
            }
        });
        
        recordMetrics(metrics, 'search_products', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            console.error(`[SEARCH FAILED] VU:${exec.vu.idInTest} | SearchTerm:${productData.search_term} | Status:${res.status} | Body:${res.body.slice(0, 200)}`);
        }
    });
    
    // Think time
    pf.pause(0.5, 1.5);
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
   EXAMPLE CSV FILES
   ============================================================
   
   data/test_data.csv:
   -------------------
   product_id,category,search_term
   prod_001,electronics,laptop
   prod_002,books,python programming
   prod_003,electronics,smartphone
   prod_004,clothing,winter jacket
   prod_005,books,data science
   prod_006,electronics,headphones
   prod_007,home,coffee maker
   prod_008,sports,running shoes
   
   data/token_users.csv:
   ---------------------
   email,password
   user1@example.com,SecurePass123!
   user2@example.com,SecurePass456!
   user3@example.com,SecurePass789!
   user4@example.com,SecurePassABC!
   user5@example.com,SecurePassXYZ!
   
   RUN COMMAND:
   ------------
   k6 run script02_token.js \
     --env BASE_URL=https://api.example.com \
     --env TOKEN_URL=https://auth.example.com/oauth/token \
     --env PRINT_CONSOLE_REPORT=true \
     2> error.log
   
   TOKEN RENEWAL BEHAVIOR:
   -----------------------
   - Tokens are cached per VU
   - Auto-renewal at 9 minutes (before 10 min expiry)
   - Each VU uses one of the 5 token users (round-robin distribution)
   - Token generation logs appear in stdout
   - Failures logged to error.log via stderr
   
   ============================================================ */
