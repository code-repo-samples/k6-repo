/**
 * ============================================================
 * K6 PERFORMANCE TEST TEMPLATE - PRODUCTION READY
 * ============================================================
 * 
 * This template demonstrates integration of:
 *  ✓ PerformanceFramework v3.0 (data, auth, HTTP wrappers)
 *  ✓ Reporting Framework (metrics, SLA validation, HTML reports)
 *  ✓ Multi-scenario, multi-phase execution
 *  ✓ CSV-driven test data
 *  ✓ OAuth authentication with credential rotation
 *  ✓ Scalable from 1 TPS to 1000+ TPS
 * 
 * USAGE:
 *   k6 run --env PRINT_CONSOLE_REPORT=true template.js
 *   k6 run --env BASE_URL=https://staging.api.com template.js
 * 
 * FILE STRUCTURE:
 *   /test-suite/
 *     ├── template.js                    (this file)
 *     ├── performance-framework.js       (PerformanceFramework v3.0)
 *     ├── reporting-framework.js         (Metrics & Reporting)
 *     ├── sla.json                       (SLA thresholds)
 *     ├── lib/
 *     │   └── papaparse.js              (CSV parser)
 *     └── data/
 *         ├── users.csv                  (test user data)
 *         └── credentials.csv            (OAuth credentials)
 */

import http from 'k6/http';
import { sleep, group, check } from 'k6';
import exec from 'k6/execution';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.1/index.js';

// Import frameworks
import { PerformanceFramework } from './performance-framework.js';
import { 
    generateReport, 
    printConsoleReport, 
    initializeMetrics, 
    getCurrentPhase,
    recordMetrics,
    makeRequest 
} from './reporting-framework.js';

/* ============================================================
   CONFIGURATION
   ============================================================ */

// Load SLA definitions from external JSON
const SLA = JSON.parse(open('./sla.json'));

// Environment-controlled settings
const BASE_URL = __ENV.BASE_URL || 'https://api.example.com';
const AUTH_URL = __ENV.AUTH_URL || 'https://auth.example.com/oauth/token';
const PRINT_CONSOLE_REPORT = __ENV.PRINT_CONSOLE_REPORT === 'true';
const DEBUG_MODE = __ENV.DEBUG_MODE === 'true';
const LOG_ERRORS = __ENV.LOG_ERRORS !== 'false'; // Default true

// API endpoints to test
const TEST_APIS = [
    'user_profile',
    'user_orders',
    'product_catalog',
    'product_search',
    'checkout'
];

/* ============================================================
   SCENARIO CONFIGURATION
   ============================================================
   Define test scenarios with multiple phases for ramp-up,
   soak, spike, and stress testing
   ============================================================ */

const SCENARIO_CONFIG = {
    // Scenario 1: Load Test with gradual ramp-up
    load_test: {
        name: 'Load Test - Gradual Ramp',
        startTime: '0s',
        phases: [
            { name: 'Warm Up', duration: '30s', target: 10 },
            { name: 'Ramp to Target', duration: '1m', target: 50 },
            { name: 'Sustained Load', duration: '3m', target: 50 },
            { name: 'Ramp Down', duration: '30s', target: 10 },
        ],
        gracefulRampDown: '20s',
        gracefulStop: '30s',
    },
    
    // Scenario 2: Spike Test - sudden traffic surge
    spike_test: {
        name: 'Spike Test',
        startTime: '5m', // Starts 5 minutes into the test
        phases: [
            { name: 'Baseline', duration: '1m', target: 20 },
            { name: 'Spike', duration: '30s', target: 200 },
            { name: 'Recovery', duration: '1m', target: 20 },
        ],
        gracefulRampDown: '20s',
        gracefulStop: '30s',
    },
    
    // Scenario 3: Stress Test - push to limits
    stress_test: {
        name: 'Stress Test',
        startTime: '8m',
        phases: [
            { name: 'Initial Load', duration: '1m', target: 50 },
            { name: 'Increase Pressure', duration: '2m', target: 100 },
            { name: 'Maximum Stress', duration: '2m', target: 200 },
        ],
        gracefulRampDown: '30s',
        gracefulStop: '30s',
    }
};

// Extract scenario names
const SCENARIOS = Object.keys(SCENARIO_CONFIG);

/* ============================================================
   INITIALIZE FRAMEWORKS
   ============================================================ */

// Performance Framework with scalability settings
const pf = new PerformanceFramework({ 
    debug: DEBUG_MODE,      // Set to false for high TPS tests
    logErrors: LOG_ERRORS   // Keep true for debugging, false for max performance
});

// Initialize reporting metrics (scenario + phase aware)
const metrics = initializeMetrics(TEST_APIS, SCENARIOS, SCENARIO_CONFIG);

// Global state
let testStartTime = null;
let authPool = null;

/* ============================================================
   K6 OPTIONS
   ============================================================ */

export const options = {
    scenarios: {},
    thresholds: generateThresholds(SLA, TEST_APIS, SCENARIOS, SCENARIO_CONFIG),
    
    // Global settings
    setupTimeout: '60s',
    teardownTimeout: '60s',
    
    // Disable default summary to use custom reporting
    summaryTrendStats: ['min', 'max', 'avg', 'p(90)', 'p(95)', 'p(99)'],
};

// Build k6 scenarios dynamically from config
for (const [scenarioKey, config] of Object.entries(SCENARIO_CONFIG)) {
    options.scenarios[scenarioKey] = {
        executor: 'ramping-vus',
        startTime: config.startTime || '0s',
        startVUs: 0,
        stages: config.phases.map(phase => ({ 
            duration: phase.duration, 
            target: phase.target 
        })),
        gracefulRampDown: config.gracefulRampDown,
        gracefulStop: config.gracefulStop,
    };
}

/* ============================================================
   THRESHOLD GENERATION
   ============================================================
   Creates k6 thresholds for each API, scenario, and phase
   based on SLA definitions
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
            
            if (SLA[api]?.p95 !== undefined) {
                thresholds[`duration_${api}_${scenarioKey}`] = 
                    thresholds[`duration_${api}_${scenarioKey}`] || [];
                thresholds[`duration_${api}_${scenarioKey}`].push(`p(95)<${SLA[api].p95}`);
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
   ============================================================
   Executed once before test starts:
   - Load CSV test data
   - Load authentication credentials
   - Initialize test state
   ============================================================ */

export function setup() {
    console.log('=== SETUP: Initializing Test Data ===');
    
    // Record test start time for phase tracking
    testStartTime = Date.now();
    
    // Load CSV data files
    try {
        pf.loadDataFiles({
            users: './data/users.csv',
            products: './data/products.csv',
            // Add more data files as needed
        });
        console.log('✓ CSV data files loaded successfully');
    } catch (err) {
        console.error(`✗ Failed to load CSV files: ${err.message}`);
    }
    
    // Load OAuth credentials pool
    try {
        authPool = pf.loadAuthPool('./data/credentials.csv');
        console.log(`✓ Auth pool loaded with ${authPool.length} credentials`);
    } catch (err) {
        console.error(`✗ Failed to load auth pool: ${err.message}`);
        // Continue with fallback credentials
        authPool = [{
            clientId: __ENV.CLIENT_ID || 'default_client',
            clientSecret: __ENV.CLIENT_SECRET || 'default_secret'
        }];
    }
    
    console.log('=== SETUP COMPLETE ===\n');
    
    return { 
        testStartTime,
        authPool 
    };
}

/* ============================================================
   MAIN TEST EXECUTION
   ============================================================
   VU script executed for each virtual user iteration
   ============================================================ */

export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, SCENARIO_CONFIG, data.testStartTime);
    
    // Get credentials for this VU (distributed across VUs)
    const creds = pf.getAuthCredentials(data.authPool);
    
    // Get OAuth token (cached per VU, auto-renewed)
    const token = pf.getToken({
        tokenUrl: AUTH_URL,
        expirySeconds: 3600,
        renewBefore: 300
    }, creds, false); // Silent mode for production
    
    // Common headers
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    
    /* --------------------------------------------------------
       TEST FLOW 1: User Profile Access
       -------------------------------------------------------- */
    group('User Profile Flow', () => {
        // Get user data from CSV (unique per iteration)
        const user = pf.getCSVData('users', 'unique', true);
        
        // Option 1: Using Performance Framework HTTP wrapper
        const res = pf.get(
            `${BASE_URL}/api/users/${user.user_id}`,
            { headers },
            ['user_id', 'email'] // Validate response contains these
        );
        
        // Record metrics for reporting
        recordMetrics(metrics, 'user_profile', scenarioName, currentPhase, res);
        
        // Extract data for next request
        const userId = pf.extract(res, 'data.user_id', 'first');
        
        if (pf.isValid(res, userId, false)) {
            // Proceed with dependent request
        }
    });
    
    /* --------------------------------------------------------
       TEST FLOW 2: User Orders (with synthetic data)
       -------------------------------------------------------- */
    group('User Orders Flow', () => {
        // Generate synthetic user on-the-fly
        const synthUser = pf.generateSynthetic();
        
        // Option 2: Using Reporting Framework's makeRequest helper
        const res = makeRequest(
            'user_orders',
            `${BASE_URL}/api/users/${synthUser.uuid}/orders`,
            synthUser.email,
            SCENARIO_CONFIG,
            metrics,
            data.testStartTime,
            'orders', // Expected text in response
            LOG_ERRORS // Control error logging
        );
    });
    
    /* --------------------------------------------------------
       TEST FLOW 3: Product Catalog (CSV-driven)
       -------------------------------------------------------- */
    group('Product Catalog Flow', () => {
        const product = pf.getCSVData('products', 'random');
        
        const res = http.get(`${BASE_URL}/api/products/${product.product_id}`, {
            headers,
            tags: { 
                name: 'product_catalog',
                scenario: scenarioName 
            }
        });
        
        check(res, {
            'product status 200': r => r.status === 200,
            'has product_name': r => r.json('product_name') !== undefined
        });
        
        recordMetrics(metrics, 'product_catalog', scenarioName, currentPhase, res);
    });
    
    /* --------------------------------------------------------
       TEST FLOW 4: Product Search (POST request)
       -------------------------------------------------------- */
    group('Product Search Flow', () => {
        const searchQuery = {
            query: 'laptop',
            category: 'electronics',
            max_price: 1000
        };
        
        const res = pf.post(
            `${BASE_URL}/api/products/search`,
            searchQuery,
            { headers },
            ['results'] // Validate 'results' in response
        );
        
        recordMetrics(metrics, 'product_search', scenarioName, currentPhase, res);
        
        // Extract search results for next step
        const productIds = pf.extract(res, 'results[*].product_id', 'random');
    });
    
    /* --------------------------------------------------------
       TEST FLOW 5: Checkout Process (multi-step)
       -------------------------------------------------------- */
    group('Checkout Flow', () => {
        const user = pf.getCSVData('users', 'sequential');
        const product = pf.getCSVData('products', 'random');
        
        // Step 1: Add to cart
        const cartRes = pf.post(
            `${BASE_URL}/api/cart/add`,
            {
                user_id: user.user_id,
                product_id: product.product_id,
                quantity: 1
            },
            { headers }
        );
        
        const cartId = pf.extract(cartRes, 'cart_id');
        
        // Step 2: Checkout (only if cart created successfully)
        if (pf.isValid(cartRes, cartId, true)) {
            const checkoutRes = pf.post(
                `${BASE_URL}/api/checkout`,
                {
                    cart_id: cartId,
                    payment_method: 'credit_card'
                },
                { headers },
                ['order_id', 'confirmation']
            );
            
            recordMetrics(metrics, 'checkout', scenarioName, currentPhase, checkoutRes);
            
            // Optional: Log successful orders to CSV
            if (checkoutRes.status === 200) {
                const orderId = pf.extract(checkoutRes, 'order_id');
                pf.writeCsv(
                    ['timestamp', 'user_id', 'order_id', 'scenario'],
                    [Date.now(), user.user_id, orderId, scenarioName]
                );
            }
        }
    });
    
    /* --------------------------------------------------------
       USER THINK TIME
       -------------------------------------------------------- */
    // Simulate realistic user behavior with random pauses
    pf.pause(1, 3); // Random 1-3 seconds between iterations
}

/* ============================================================
   TEARDOWN PHASE
   ============================================================
   Executed once after test completes
   ============================================================ */

export function teardown(data) {
    console.log('\n=== TEARDOWN: Cleaning Up ===');
    
    // Perform any cleanup operations
    // - Close connections
    // - Archive test data
    // - Trigger notifications
    
    console.log('✓ Test cleanup completed');
}

/* ============================================================
   SUMMARY REPORTING
   ============================================================
   Generates HTML report and console output
   ============================================================ */

export function handleSummary(data) {
    // Generate HTML report
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
        // HTML report for browser viewing
        'k6-performance-report.html': htmlReport['k6-performance-report.html'],
        
        // JSON for CI/CD integration
        'k6-summary.json': JSON.stringify(data),
        
        // Standard k6 text summary to stdout
        'stdout': textSummary(data, { 
            indent: ' ', 
            enableColors: true 
        }),
    };
}

/* ============================================================
   EXAMPLE CSV FILE FORMATS
   ============================================================
   
   data/users.csv:
   ---------------
   user_id,email,first_name,last_name
   user_001,john.doe@example.com,John,Doe
   user_002,jane.smith@example.com,Jane,Smith
   user_003,bob.wilson@example.com,Bob,Wilson
   
   data/products.csv:
   ------------------
   product_id,product_name,category,price
   prod_001,Laptop,Electronics,999.99
   prod_002,Mouse,Electronics,29.99
   prod_003,Keyboard,Electronics,79.99
   
   data/credentials.csv:
   --------------------
   clientId,clientSecret
   client_001,secret_abc123xyz
   client_002,secret_def456uvw
   client_003,secret_ghi789rst
   
   sla.json:
   ---------
   {
     "user_profile": { "p90": 200, "p95": 300 },
     "user_orders": { "p90": 500, "p95": 800 },
     "product_catalog": { "p90": 150, "p95": 250 },
     "product_search": { "p90": 400, "p95": 600 },
     "checkout": { "p90": 800, "p95": 1200 }
   }
   
   ============================================================ */