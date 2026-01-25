# K6 Performance Testing Framework - Quick Start Guide

## 📁 Project Structure

```
/performance-tests/
├── template.js                    # Main test script (copy & customize)
├── performance-framework.js       # PerformanceFramework v3.0
├── reporting-framework.js         # Metrics & Reporting
├── sla.json                      # SLA thresholds
├── lib/
│   └── papaparse.js              # CSV parser library
└── data/
    ├── users.csv                 # Test user data
    ├── products.csv              # Product catalog
    └── credentials.csv           # OAuth credentials
```

---

## 🚀 Quick Start

### 1. Install k6

```bash
# macOS
brew install k6

# Windows
choco install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

### 2. Setup Test Files

```bash
# Create directory structure
mkdir -p performance-tests/{lib,data}
cd performance-tests

# Copy framework files
cp /path/to/performance-framework.js .
cp /path/to/reporting-framework.js .
cp /path/to/template.js my-test.js

# Create CSV data files (see examples below)
```

### 3. Create Configuration Files

**sla.json**
```json
{
  "user_profile": { "p90": 200, "p95": 300, "p99": 500 },
  "user_orders": { "p90": 500, "p95": 800, "p99": 1200 },
  "product_catalog": { "p90": 150, "p95": 250, "p99": 400 },
  "product_search": { "p90": 400, "p95": 600, "p99": 900 },
  "checkout": { "p90": 800, "p95": 1200, "p99": 2000 }
}
```

**data/users.csv**
```csv
user_id,email,first_name,last_name
user_001,john.doe@example.com,John,Doe
user_002,jane.smith@example.com,Jane,Smith
user_003,bob.wilson@example.com,Bob,Wilson
```

**data/products.csv**
```csv
product_id,product_name,category,price
prod_001,Laptop,Electronics,999.99
prod_002,Mouse,Electronics,29.99
prod_003,Keyboard,Electronics,79.99
```

**data/credentials.csv**
```csv
clientId,clientSecret
client_001,secret_abc123xyz789
client_002,secret_def456uvw012
client_003,secret_ghi789rst345
```

### 4. Run Your Test

```bash
# Basic run
k6 run my-test.js

# With console report
k6 run --env PRINT_CONSOLE_REPORT=true my-test.js

# Debug mode (verbose logging)
k6 run --env DEBUG_MODE=true my-test.js

# Production mode (minimal logging, high TPS)
k6 run --env DEBUG_MODE=false --env LOG_ERRORS=false my-test.js

# Custom base URL
k6 run --env BASE_URL=https://staging.api.com my-test.js

# Override credentials
k6 run --env CLIENT_ID=my_client --env CLIENT_SECRET=my_secret my-test.js
```

---

## 📊 Scalability Configurations

### 🐌 Light Load Test (1-10 TPS)

```javascript
const SCENARIO_CONFIG = {
    light_load: {
        name: 'Light Load Test',
        startTime: '0s',
        phases: [
            { name: 'Ramp Up', duration: '30s', target: 5 },
            { name: 'Steady State', duration: '5m', target: 5 },
        ],
        gracefulRampDown: '10s',
        gracefulStop: '10s',
    }
};

// Framework settings for light load
const pf = new PerformanceFramework({ 
    debug: true,      // Enable debug logging
    logErrors: true   // Log all errors
});
```

**Run command:**
```bash
k6 run --env DEBUG_MODE=true --env PRINT_CONSOLE_REPORT=true my-test.js
```

---

### ⚡ Medium Load Test (50-100 TPS)

```javascript
const SCENARIO_CONFIG = {
    medium_load: {
        name: 'Medium Load Test',
        startTime: '0s',
        phases: [
            { name: 'Warm Up', duration: '1m', target: 20 },
            { name: 'Ramp to Target', duration: '2m', target: 50 },
            { name: 'Sustained Load', duration: '10m', target: 50 },
            { name: 'Peak Load', duration: '5m', target: 100 },
            { name: 'Ramp Down', duration: '2m', target: 20 },
        ],
        gracefulRampDown: '30s',
        gracefulStop: '30s',
    }
};

// Framework settings for medium load
const pf = new PerformanceFramework({ 
    debug: false,     // Disable verbose debug logs
    logErrors: true   // Keep error logging enabled
});

// Use silent token mode
const token = pf.getToken(config, creds, false); // No verbose logs
```

**Run command:**
```bash
k6 run --env DEBUG_MODE=false --env LOG_ERRORS=true my-test.js
```

---

### 🚀 High Load Test (500-1000+ TPS)

```javascript
const SCENARIO_CONFIG = {
    high_load: {
        name: 'High Load Test',
        startTime: '0s',
        phases: [
            { name: 'Warm Up', duration: '2m', target: 100 },
            { name: 'Ramp to 500 TPS', duration: '3m', target: 500 },
            { name: 'Sustained 500 TPS', duration: '15m', target: 500 },
            { name: 'Ramp to 1000 TPS', duration: '3m', target: 1000 },
            { name: 'Sustained 1000 TPS', duration: '10m', target: 1000 },
            { name: 'Gradual Ramp Down', duration: '5m', target: 100 },
        ],
        gracefulRampDown: '1m',
        gracefulStop: '1m',
    }
};

// CRITICAL: Framework settings for high load (1000+ TPS)
const pf = new PerformanceFramework({ 
    debug: false,      // MUST be false - no debug logs
    logErrors: false   // Disable error logging for max performance
});

// ALWAYS use silent token mode
const token = pf.getToken(config, creds, false);

// Use makeRequest with printErrors = false
const res = makeRequest(
    'api_name',
    url,
    params,
    SCENARIO_CONFIG,
    metrics,
    testStartTime,
    expectedText,
    false  // CRITICAL: No console.error output
);
```

**Run command:**
```bash
# Production high-load test - ALL logging disabled
k6 run --env DEBUG_MODE=false --env LOG_ERRORS=false my-test.js

# To suppress console report (only HTML output)
k6 run --env DEBUG_MODE=false --env LOG_ERRORS=false \
       --env PRINT_CONSOLE_REPORT=false my-test.js
```

**Performance Tuning for 1000+ TPS:**

```bash
# Increase system limits (Linux/Mac)
ulimit -n 250000

# Run with optimized settings
k6 run \
  --env DEBUG_MODE=false \
  --env LOG_ERRORS=false \
  --env PRINT_CONSOLE_REPORT=false \
  --no-connection-reuse=false \
  --batch=20 \
  --batch-per-host=10 \
  my-test.js
```

---

## 🎯 Common Test Patterns

### Pattern 1: Simple API Test (No Auth)

```javascript
export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, SCENARIO_CONFIG, data.testStartTime);
    
    group('Simple API Call', () => {
        const res = pf.get(
            `${BASE_URL}/api/health`,
            {},
            ['status', 'healthy'] // Expected response content
        );
        
        recordMetrics(metrics, 'health_check', scenarioName, currentPhase, res);
    });
    
    pf.pause(1, 2);
}
```

### Pattern 2: OAuth-Protected API

```javascript
export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, SCENARIO_CONFIG, data.testStartTime);
    
    // Get credentials and token
    const creds = pf.getAuthCredentials(data.authPool);
    const token = pf.getToken({
        tokenUrl: AUTH_URL,
        expirySeconds: 3600,
        renewBefore: 300
    }, creds, false); // Silent mode
    
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
    
    group('Protected API Call', () => {
        const res = pf.get(
            `${BASE_URL}/api/protected/resource`,
            { headers },
            ['data']
        );
        
        recordMetrics(metrics, 'protected_api', scenarioName, currentPhase, res);
    });
    
    pf.pause(1, 3);
}
```

### Pattern 3: CSV-Driven Data Test

```javascript
export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, SCENARIO_CONFIG, data.testStartTime);
    
    // Each iteration gets unique user from CSV
    const user = pf.getCSVData('users', 'unique', true);
    
    group('User-Specific API Call', () => {
        const res = pf.get(
            `${BASE_URL}/api/users/${user.user_id}/profile`,
            { headers },
            ['user_id']
        );
        
        recordMetrics(metrics, 'user_profile', scenarioName, currentPhase, res);
    });
    
    pf.pause(1, 2);
}
```

### Pattern 4: Multi-Step Transaction with Correlation

```javascript
export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, SCENARIO_CONFIG, data.testStartTime);
    const headers = { 'Authorization': `Bearer ${token}` };
    
    group('Multi-Step Transaction', () => {
        // Step 1: Create resource
        const createRes = pf.post(
            `${BASE_URL}/api/orders`,
            { product_id: 'prod_001', quantity: 1 },
            { headers },
            ['order_id']
        );
        
        recordMetrics(metrics, 'create_order', scenarioName, currentPhase, createRes);
        
        // Extract order_id for next step
        const orderId = pf.extract(createRes, 'order_id', 'first');
        
        // Step 2: Update resource (only if step 1 succeeded)
        if (pf.isValid(createRes, orderId, true)) {
            const updateRes = pf.post(
                `${BASE_URL}/api/orders/${orderId}/confirm`,
                { payment_method: 'credit_card' },
                { headers },
                ['confirmation']
            );
            
            recordMetrics(metrics, 'confirm_order', scenarioName, currentPhase, updateRes);
        }
    });
    
    pf.pause(2, 4);
}
```

### Pattern 5: Synthetic Data Generation

```javascript
export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, SCENARIO_CONFIG, data.testStartTime);
    
    group('Register New User', () => {
        // Generate unique user data on-the-fly
        const synth = pf.generateSynthetic();
        
        const res = pf.post(
            `${BASE_URL}/api/users/register`,
            {
                email: synth.email,
                first_name: synth.firstName,
                last_name: synth.lastName,
                phone: synth.phone,
                address: {
                    street: synth.street,
                    city: synth.city,
                    country: synth.country,
                    zip: synth.zipCode
                }
            },
            { headers: { 'Content-Type': 'application/json' } },
            ['user_id', 'success']
        );
        
        recordMetrics(metrics, 'user_registration', scenarioName, currentPhase, res);
    });
    
    pf.pause(1, 3);
}
```

---

## 📈 Understanding Reports

### Console Report Output

```
=== EXECUTION SUMMARY ===
+---------------------+---------------------+----------+-------+--------+--------+---------+
| start               | end                 | duration | total | passed | failed | passPct |
+---------------------+---------------------+----------+-------+--------+--------+---------+
| 12/15/2024 10:00:00 | 12/15/2024 10:15:00 | 900.00   | 45000 | 44850  | 150    | 99.67   |
+---------------------+---------------------+----------+-------+--------+--------+---------+

=== OVERALL SUMMARY (All Scenarios) ===
+-----------------+---------+--------+--------+--------+--------+--------+--------+-------+--------+--------+----------+--------+
| api             | sla     | min    | max    | avg    | p90    | p95    | p99    | total | passed | failed | errorPct | status |
+-----------------+---------+--------+--------+--------+--------+--------+--------+-------+--------+--------+----------+--------+
| user_profile    | 200     | 45.23  | 892.11 | 156.78 | 189.45 | 245.67 | 456.89 | 15000 | 14950  | 50     | 0.33     | PASS   |
| checkout        | 800     | 123.45 | 2345.67| 678.90 | 756.12 | 890.34 | 1234.5 | 15000 | 14900  | 100    | 0.67     | PASS   |
+-----------------+---------+--------+--------+--------+--------+--------+--------+-------+--------+--------+----------+--------+
```

### HTML Report

Opens in browser with:
- ✅ Executive summary (start/end times, pass/fail counts)
- ✅ Overall aggregated metrics across all scenarios
- ✅ Per-scenario breakdown with phase details
- ✅ Error distribution by API and status code
- ✅ Color-coded PASS/FAIL indicators

---

## 🔧 Troubleshooting

### Issue: "Data key not found"
**Solution:** Ensure CSV files are loaded in `setup()`:
```javascript
pf.loadDataFiles({
    users: './data/users.csv'
});
```

### Issue: Token generation fails
**Solution:** Check credentials.csv format and AUTH_URL:
```bash
k6 run --env AUTH_URL=https://your-auth-server.com/token my-test.js
```

### Issue: High memory usage at 1000 TPS
**Solution:** Disable all logging:
```javascript
const pf = new PerformanceFramework({ debug: false, logErrors: false });
// Use makeRequest with printErrors = false
```

### Issue: CSV data exhausted
**Solution:** Enable looping or generate synthetic data:
```javascript
const user = pf.getCSVData('users', 'unique', true); // Loop enabled
// OR
const user = pf.generateSynthetic(); // Generate on-the-fly
```

---

## 📚 Best Practices

1. **Start Small, Scale Up**
   - Begin with 10 VUs, verify correctness
   - Gradually increase to target TPS
   - Monitor resource usage

2. **Use Appropriate Data Strategies**
   - `sequential`: Consistent, predictable data access
   - `random`: Realistic user behavior simulation
   - `unique`: Ensure no data reuse across iterations

3. **Optimize for High TPS**
   - Set `debug: false` and `logErrors: false`
   - Use silent token mode: `getToken(config, creds, false)`
   - Disable console report: `PRINT_CONSOLE_REPORT=false`

4. **Validate SLAs Properly**
   - Define realistic SLAs in `sla.json`
   - Test SLAs per scenario and per phase
   - Use P90, P95, P99 for consistent measurement

5. **Monitor System Resources**
   - Check CPU, memory, network during test
   - Increase ulimit on Linux/Mac
   - Use k6 cloud for distributed testing at extreme scale

---

## 🎓 Additional Resources

- [k6 Documentation](https://k6.io/docs/)
- [k6 Community Forum](https://community.k6.io/)
- [Best Practices Guide](https://k6.io/docs/testing-guides/best-practices/)