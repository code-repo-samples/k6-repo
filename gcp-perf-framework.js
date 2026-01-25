import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { sleep, check } from 'k6';
import http from 'k6/http';
import Papa from './lib/papaparse.js';

/**
 * ============================================================
 * K6 Performance Framework v3.0
 * ============================================================
 * 
 * FEATURES:
 *  ✓ CSV data management with SharedArray (memory-efficient)
 *  ✓ Synthetic data generation (unique per VU/iteration)
 *  ✓ OAuth token management with reuse/renewal
 *  ✓ Multi-credential support via CSV pool
 *  ✓ HTTP wrappers (GET/POST) with built-in checks
 *  ✓ Response correlation & extraction
 *  ✓ Scalable logging (flag-controlled)
 *  ✓ CSV output for results
 * 
 * USAGE:
 * 
 *   import { PerformanceFramework } from './performance-framework.js';
 *   
 *   const pf = new PerformanceFramework({ debug: false }); // Disable verbose logs
 *   
 *   export function setup() {
 *     pf.loadDataFiles({ users: './data/users.csv' });
 *     return { authPool: pf.loadAuthPool('./data/credentials.csv') };
 *   }
 *   
 *   export default function(data) {
 *     const user = pf.getCSVData('users', 'unique');
 *     const creds = pf.getAuthCredentials(data.authPool);
 *     const token = pf.getToken(config, creds, false); // Silent mode
 *     
 *     const res = pf.get('https://api.example.com/users', {
 *       headers: { Authorization: `Bearer ${token}` }
 *     }, ['success']); // Check for 'success' in response
 *     
 *     pf.pause(0.5, 1.5);
 *   }
 * 
 * SCALABILITY NOTES:
 *  - Set debug: false for high TPS (1000+) tests
 *  - Use SharedArray for all CSV data
 *  - Token reuse prevents auth overhead
 *  - Minimal logging on success paths
 */

export class PerformanceFramework {
    /**
     * @param {Object} options - { debug: boolean, logErrors: boolean }
     */
    constructor(options = {}) {
        this.dataRegistry = {};
        this._csvHeaderWritten = false;
        this._token = null;
        this._tokenGeneratedAt = 0;
        
        // Scalability controls
        this.debug = options.debug !== undefined ? options.debug : true;
        this.logErrors = options.logErrors !== undefined ? options.logErrors : true;
    }

    // =========================================================================
    // 1. DATA MANAGEMENT
    // =========================================================================

    /**
     * Load CSV files into SharedArray for VU-safe access
     * SharedArray ensures data is loaded once and shared across all VUs
     * 
     * @param {Object} files - { key: 'path/to/file.csv' }
     * 
     * Example:
     *   pf.loadDataFiles({ 
     *     users: './data/users.csv',
     *     products: './data/products.csv' 
     *   });
     */
    loadDataFiles(files) {
        for (const [key, path] of Object.entries(files)) {
            this.dataRegistry[key] = new SharedArray(key, () => {
                const data = open(path);
                return Papa.parse(data, { 
                    header: true, 
                    skipEmptyLines: true // Prevents undefined rows
                }).data;
            });
        }
        if (this.debug) this.log(`Loaded ${Object.keys(files).length} data file(s)`);
    }

    /**
     * Get data from loaded CSV file
     * 
     * @param {string} key - Data registry key
     * @param {string} mode - 'sequential' | 'random' | 'unique'
     * @param {boolean} loop - Wrap around when data exhausted (unique mode)
     * 
     * Modes:
     *  - sequential: VU iterations cycle through data (idx % total)
     *  - random: Random row per access
     *  - unique: Each iteration gets unique row, abort/loop when exhausted
     * 
     * Example:
     *   const user = pf.getCSVData('users', 'unique', false); // No loop, abort when done
     */
    getCSVData(key, mode = 'sequential', loop = true) {
        const data = this.dataRegistry[key];
        if (!data) throw new Error(`Data key "${key}" not found in registry`);

        const total = data.length;
        const idx = exec.scenario?.iterationInTest || 0;

        if (mode === 'random') {
            return data[Math.floor(Math.random() * total)];
        }

        if (mode === 'unique') {
            if (idx >= total) {
                if (loop) return data[idx % total];
                exec.test.abort(`[DATA EXHAUSTED] ${key} has ${total} rows, iteration ${idx}`);
            }
            return data[idx];
        }

        // Sequential (default)
        return data[idx % total];
    }

    // =========================================================================
    // 2. SYNTHETIC DATA GENERATOR
    // =========================================================================

    /**
     * Generate synthetic test data unique per VU/iteration
     * Safe for high concurrency - no I/O, pure computation
     * 
     * @returns {Object} - firstName, lastName, email, address, phone, uuid, nonce
     * 
     * Example:
     *   const synth = pf.generateSynthetic();
     *   // synth.email => "perfjames.smith.1234ABC@example.com"
     */
    generateSynthetic() {
        const firstNames = ['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','William','Elizabeth'];
        const lastNames = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez'];
        const cities = ['New York','Los Angeles','Chicago','Houston','Phoenix'];
        const streets = ['Maple Ave','Oak St','Washington Blvd','Lakeview Dr'];
        const countries = ['United States','Canada','United Kingdom','Australia'];

        const vuId = exec.vu?.idInTest || 0;
        const iter = exec.scenario?.iterationInTest || 0;
        const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

        const fn = pick(firstNames);
        const ln = pick(lastNames);
        const uniqueID = `${vuId}${iter}${randomSuffix}`;

        return {
            fullName:  `${fn} ${ln}`,
            firstName: fn,
            lastName:  ln,
            email:     `perf${fn.toLowerCase()}.${ln.toLowerCase()}.${uniqueID}@example.com`,
            street:    `${Math.floor(Math.random() * 9999) + 1} ${pick(streets)}`,
            city:      pick(cities),
            country:   pick(countries),
            zipCode:   `${Math.floor(10000 + Math.random() * 89999)}`,
            phone:     `555${Math.floor(1000000 + Math.random() * 8999999)}`,
            uuid:      'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            }),
            nonce:     `N-${uniqueID}-${Date.now()}`
        };
    }

    // =========================================================================
    // 3. OAUTH TOKEN MANAGEMENT (Standard OAuth2 + GCP)
    // =========================================================================

    /**
     * Load authentication credentials from CSV into SharedArray
     * 
     * @param {string} path - Path to credentials CSV
     * @returns {SharedArray} - Array of {clientId, clientSecret} objects
     * 
     * CSV Format:
     *   clientId,clientSecret
     *   client_001,secret_abc123
     *   client_002,secret_xyz789
     * 
     * Example:
     *   const authPool = pf.loadAuthPool('./creds.csv');
     */
    loadAuthPool(path) {
        return new SharedArray('auth_pool', () => {
            const data = open(path);
            return Papa.parse(data, { 
                header: true, 
                skipEmptyLines: true 
            }).data;
        });
    }

    /**
     * Get credentials from auth pool for current VU
     * Distributes credentials across VUs for load distribution
     * 
     * @param {Array} authPool - SharedArray from loadAuthPool()
     * @returns {Object} - {clientId, clientSecret}
     * 
     * Example:
     *   const creds = pf.getAuthCredentials(data.authPool);
     */
    getAuthCredentials(authPool) {
        const vuId = exec.vu?.idInTest || 0;
        return authPool[vuId % authPool.length];
    }

    /**
     * Get or reuse OAuth token with automatic renewal
     * Tokens are cached per framework instance (per VU)
     * 
     * @param {Object} config - { tokenUrl, clientId?, clientSecret?, expirySeconds, renewBefore }
     * @param {Object} userCreds - Optional {clientId, clientSecret} to override config
     * @param {boolean} verbose - Log token operations (default: true, set false for high TPS)
     * @returns {string} - Access token
     * 
     * Example:
     *   const token = pf.getToken({
     *     tokenUrl: 'https://auth.example.com/token',
     *     expirySeconds: 3600,
     *     renewBefore: 300
     *   }, creds, false); // Silent mode for production
     */
    getToken(config, userCreds = null, verbose = true) {
        const now = Date.now() / 1000;
        const expiresIn = config.expirySeconds || 300;
        const renewBefore = config.renewBefore || 60;

        const cid = userCreds?.clientId || config.clientId;
        const sec = userCreds?.clientSecret || config.clientSecret;

        if (!cid || !sec) {
            this.log('[TOKEN ERROR] Missing clientId or clientSecret');
            exec.test.abort('OAuth configuration error');
        }

        // Token reuse logic
        if (this._token) {
            const age = now - this._tokenGeneratedAt;
            const remaining = expiresIn - age;

            if (age < (expiresIn - renewBefore)) {
                if (verbose && this.debug) {
                    this.log(`[TOKEN REUSE] ${cid.substring(0,8)}... (${Math.round(remaining)}s remaining)`);
                }
                return this._token;
            } else if (verbose && this.debug) {
                this.log(`[TOKEN RENEWAL] ${cid.substring(0,8)}... expired/expiring soon`);
            }
        } else if (verbose && this.debug) {
            this.log(`[TOKEN NEW] Fetching for ${cid.substring(0,8)}...`);
        }

        // Request new token
        const payload = `grant_type=client_credentials&client_id=${encodeURIComponent(cid)}&client_secret=${encodeURIComponent(sec)}`;
        
        const res = http.post(config.tokenUrl, payload, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (res.status === 200) {
            try {
                this._token = JSON.parse(res.body).access_token;
                this._tokenGeneratedAt = now;
                if (verbose && this.debug) {
                    this.log(`[TOKEN SUCCESS] Acquired for ${cid.substring(0,8)}...`);
                }
                return this._token;
            } catch (err) {
                this.log(`[TOKEN PARSE ERROR] ${err.message}`);
                exec.test.abort('Failed to parse OAuth token response');
            }
        } else {
            this.log(`[TOKEN AUTH FAILED] Status ${res.status} for ${cid.substring(0,8)}...`);
            if (this.logErrors) {
                this.log(`[TOKEN ERROR BODY] ${res.body.slice(0, 200)}`);
            }
            exec.test.abort('OAuth authentication failed');
        }
    }

    /**
     * Get GCP Access Token (pre-generated recommended)
     * For GCP, it's easier to generate tokens externally using gcloud CLI
     * 
     * @param {string} token - Pre-generated access/ID token
     * @param {boolean} verbose - Log token operations
     * @returns {string} - Bearer token
     * 
     * Example:
     *   // Generate token externally:
     *   // gcloud auth print-access-token
     *   // gcloud auth print-identity-token --audiences=https://service.run.app
     *   
     *   const token = pf.getGCPToken(__ENV.GCP_TOKEN);
     *   headers['Authorization'] = `Bearer ${token}`;
     */
    getGCPToken(token = null, verbose = false) {
        const gcpToken = token || __ENV.GCP_TOKEN || __ENV.GCP_ACCESS_TOKEN || __ENV.GCP_ID_TOKEN;
        
        if (!gcpToken) {
            this.log('[GCP TOKEN ERROR] No token provided. Set GCP_TOKEN environment variable or pass token.');
            exec.test.abort('GCP token required');
        }
        
        if (verbose && this.debug) {
            this.log(`[GCP TOKEN] Using token: ${gcpToken.substring(0, 20)}...`);
        }
        
        return gcpToken;
    }
    
    /**
     * Get GCP Auth Headers (convenience method)
     * @param {string} token - Optional token, otherwise uses env var
     * @returns {Object} - Headers with Authorization
     * 
     * Example:
     *   const headers = pf.getGCPAuthHeaders();
     *   // Returns: { 'Authorization': 'Bearer token...' }
     */
    getGCPAuthHeaders(token = null) {
        return {
            'Authorization': `Bearer ${this.getGCPToken(token)}`
        };
    }

    // =========================================================================
    // 4. HTTP REQUEST WRAPPERS
    // =========================================================================

    /**
     * HTTP GET with built-in checks and error logging
     * 
     * @param {string} url - Request URL
     * @param {Object} params - k6 params object (headers, tags, etc.)
     * @param {Array<string>} textChecks - Expected substrings in response body
     * @returns {Response} - k6 Response object
     * 
     * Example:
     *   const res = pf.get('https://api.example.com/users/123', {
     *     headers: { Authorization: `Bearer ${token}` }
     *   }, ['user_id', 'email']); // Validates these strings exist in response
     */
    get(url, params = {}, textChecks = []) {
        const res = http.get(url, params);

        // k6 check for 200 status
        check(res, { 'GET status 200': (r) => r.status === 200 });

        // Only log on failure to reduce noise at scale
        if (this.logErrors) {
            const failedChecks = textChecks.filter(t => !res.body.includes(t));
            if (res.status >= 400 || failedChecks.length > 0) {
                const snippet = res.body ? res.body.slice(0, 200) + '...' : 'empty';
                this.log(`[GET ERROR] ${url} | Status: ${res.status} | Body: ${snippet}`);
                if (failedChecks.length) {
                    this.log(`[GET CHECKS FAILED] Missing: ${failedChecks.join(', ')}`);
                }
            }
        }

        return res;
    }

    /**
     * HTTP POST with built-in checks and error logging
     * 
     * @param {string} url - Request URL
     * @param {Object} body - Request payload (will be JSON stringified)
     * @param {Object} params - k6 params object (headers, tags, etc.)
     * @param {Array<string>} textChecks - Expected substrings in response body
     * @returns {Response} - k6 Response object
     * 
     * Example:
     *   const res = pf.post('https://api.example.com/orders', {
     *     product_id: '123',
     *     quantity: 5
     *   }, {
     *     headers: { 
     *       'Authorization': `Bearer ${token}`,
     *       'Content-Type': 'application/json'
     *     }
     *   }, ['order_id']); // Validates order_id in response
     */
    post(url, body, params = {}, textChecks = []) {
        const res = http.post(url, JSON.stringify(body), params);

        // k6 check for 200 status
        check(res, { 'POST status 200': (r) => r.status === 200 });

        // Only log on failure
        if (this.logErrors) {
            const failedChecks = textChecks.filter(t => !res.body.includes(t));
            if (res.status >= 400 || failedChecks.length > 0) {
                const snippet = res.body ? res.body.slice(0, 200) + '...' : 'empty';
                this.log(`[POST ERROR] ${url} | Status: ${res.status} | Body: ${snippet}`);
                if (failedChecks.length) {
                    this.log(`[POST CHECKS FAILED] Missing: ${failedChecks.join(', ')}`);
                }
            }
        }

        return res;
    }

    // =========================================================================
    // 5. RESPONSE CORRELATION & EXTRACTION
    // =========================================================================

    /**
     * Extract data from HTTP response using JSON path or regex
     * 
     * @param {Response} res - k6 Response object
     * @param {string|RegExp} pattern - JSONPath string or regex pattern
     * @param {string|number} strategy - 'random' | 'first' | index number
     * @returns {string|null} - Extracted value or null
     * 
     * Examples:
     *   // JSON extraction
     *   const userId = pf.extract(res, 'data.user.id', 'first');
     *   
     *   // Regex extraction (capture group 1)
     *   const token = pf.extract(res, /access_token":"([^"]+)"/, 'random');
     *   
     *   // Specific index
     *   const thirdItem = pf.extract(res, 'items', 2);
     */
    extract(res, pattern, strategy = 'random') {
        try {
            let results = [];
            
            if (typeof pattern === 'string') {
                // JSON path extraction
                const val = res.json(pattern);
                results = Array.isArray(val) ? val : [val];
            } else if (pattern instanceof RegExp) {
                // Regex extraction
                results = [...res.body.matchAll(pattern)].map(m => m[1]);
            }

            if (!results.length || results[0] === undefined) return null;

            // Return strategy
            if (typeof strategy === 'number') return results[strategy];
            return strategy === 'random' 
                ? results[Math.floor(Math.random() * results.length)] 
                : results[0];
        } catch (e) {
            if (this.debug) this.log(`[EXTRACT ERROR] ${e.message}`);
            return null;
        }
    }

    /**
     * Validate response status and correlation data
     * 
     * @param {Response} res - k6 Response object
     * @param {any} correlation - Extracted correlation data (null = invalid)
     * @param {boolean} strict - If true, return false on error; if false, return true (soft fail)
     * @returns {boolean} - Validation result
     * 
     * Example:
     *   const orderId = pf.extract(res, 'order_id');
     *   if (!pf.isValid(res, orderId, true)) {
     *     // Handle validation failure
     *   }
     */
    isValid(res, correlation = true, strict = true) {
        const hasError = res.status >= 400 || correlation === null;
        
        if (hasError && this.logErrors) {
            this.log(`[VALIDATION] Status: ${res.status} | Correlation: ${correlation !== null ? 'OK' : 'FAILED'}`);
        }

        return hasError ? !strict : true;
    }

    // =========================================================================
    // 6. LOGGING & OUTPUT
    // =========================================================================

    /**
     * VU-safe logging with context
     * Automatically adds VU/iteration info when in VU context
     * 
     * @param {string} message - Log message
     */
    log(message) {
        if (exec.vu && exec.scenario) {
            console.log(`[VU:${exec.vu.idInTest}|Iter:${exec.scenario.iterationInTest}] ${message}`);
        } else {
            console.log(`[SETUP/TEARDOWN] ${message}`);
        }
    }

    /**
     * Write to stderr (for CSV output or raw data)
     * 
     * @param {...any} vars - Variables to output
     */
    write(...vars) { 
        console.error(vars.join(' | ')); 
    }

    /**
     * Write CSV row with automatic header handling
     * 
     * @param {Array<string>} headers - Column headers
     * @param {Array} values - Row values
     * 
     * Example:
     *   pf.writeCsv(['timestamp', 'user_id', 'status'], [Date.now(), '123', 'success']);
     */
    writeCsv(headers, values) {
        if (!values || values.length === 0) return;
        
        if (!this._csvHeaderWritten) {
            this.write(headers.join(','));
            this._csvHeaderWritten = true;
        }
        
        const row = values.map(String).join(',');
        this.write(row);
    }

    // =========================================================================
    // 7. UTILITIES
    // =========================================================================

    /**
     * Pause execution for random duration
     * Use for simulating user think time
     * 
     * @param {number} min - Minimum seconds
     * @param {number} max - Maximum seconds
     * 
     * Example:
     *   pf.pause(1, 3); // Random pause between 1-3 seconds
     */
    pause(min = 1, max = 2) { 
        sleep(Math.random() * (max - min) + min); 
    }

    /**
     * Get environment variable with fallback
     * 
     * @param {string} name - Environment variable name
     * @param {any} defaultValue - Default if not set
     * @returns {any} - Variable value or default
     * 
     * Example:
     *   const baseUrl = pf.getEnv('BASE_URL', 'https://api.example.com');
     */
    getEnv(name, defaultValue) {
        const value = __ENV[name];
        return value !== undefined ? value : defaultValue;
    }
}
