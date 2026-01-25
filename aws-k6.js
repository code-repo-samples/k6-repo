/**
 * ============================================================
 * K6 Script with AWS Signature V4 Authentication
 * ============================================================
 * 
 * This script demonstrates how to make authenticated requests to AWS services
 * using AWS Signature Version 4 (SigV4) with proper signing to avoid errors.
 * 
 * Supports:
 *  ✓ API Gateway
 *  ✓ Lambda Function URLs
 *  ✓ S3
 *  ✓ DynamoDB
 *  ✓ Any AWS service requiring SigV4
 *  ✓ STS Session Tokens (optional)
 * 
 * USAGE:
 *   k6 run aws_sigv4_test.js \
 *     --env AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE \
 *     --env AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY \
 *     --env AWS_REGION=us-east-1 \
 *     --env AWS_SERVICE=execute-api \
 *     --env API_ENDPOINT=https://abc123.execute-api.us-east-1.amazonaws.com/prod \
 *     --env AWS_SESSION_TOKEN=optional_sts_token \
 *     2> error.log
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
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

// Import AWS SigV4 signer (use k6/experimental/webcrypto version)
import { crypto } from 'k6/experimental/webcrypto';

/* ============================================================
   AWS SIGNATURE V4 SIGNER CLASS
   ============================================================ */

class AWSSignatureV4 {
    constructor(config) {
        this.accessKeyId = config.accessKeyId;
        this.secretAccessKey = config.secretAccessKey;
        this.sessionToken = config.sessionToken || null;
        this.region = config.region || 'us-east-1';
        this.service = config.service || 'execute-api';
        
        if (!this.accessKeyId || !this.secretAccessKey) {
            throw new Error('AWS credentials required');
        }
    }
    
    sign(request) {
        const { method, url, headers = {}, body = null } = request;
        
        const urlObj = this._parseURL(url);
        const now = new Date();
        const amzDate = this._getAmzDate(now);
        const dateStamp = this._getDateStamp(now);
        
        const requestHeaders = {
            'Host': urlObj.host,
            'X-Amz-Date': amzDate,
            ...headers
        };
        
        if (this.sessionToken) {
            requestHeaders['X-Amz-Security-Token'] = this.sessionToken;
        }
        
        const sortedKeys = Object.keys(requestHeaders).sort((a, b) => 
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
        
        const canonicalHeaders = sortedKeys
            .map(key => `${key.toLowerCase()}:${requestHeaders[key].trim()}`)
            .join('\n') + '\n';
        
        const signedHeaders = sortedKeys.map(key => key.toLowerCase()).join(';');
        
        const payloadHash = this._sha256Hash(body || '');
        
        const canonicalRequest = [
            method.toUpperCase(),
            urlObj.path,
            urlObj.queryString,
            canonicalHeaders,
            signedHeaders,
            payloadHash
        ].join('\n');
        
        const credentialScope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
        
        const stringToSign = [
            'AWS4-HMAC-SHA256',
            amzDate,
            credentialScope,
            this._sha256Hash(canonicalRequest)
        ].join('\n');
        
        const signature = this._calculateSignature(dateStamp, stringToSign);
        
        requestHeaders['Authorization'] = 
            `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
        
        return { url, headers: requestHeaders };
    }
    
    _parseURL(url) {
        const match = url.match(/^(https?):\/\/([^\/\?]+)(\/[^\?]*)?(\?.*)?$/);
        return {
            host: match[2],
            path: match[3] || '/',
            queryString: match[4] ? match[4].substring(1) : ''
        };
    }
    
    _getAmzDate(date) {
        return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
    }
    
    _getDateStamp(date) {
        return date.toISOString().substring(0, 10).replace(/-/g, '');
    }
    
    _sha256Hash(data) {
        const bytes = new TextEncoder().encode(data);
        const hashBuffer = crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    _hmacSha256(key, data) {
        const keyBytes = typeof key === 'string' ? new TextEncoder().encode(key) : key;
        const dataBytes = new TextEncoder().encode(data);
        
        const cryptoKey = crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        
        return crypto.subtle.sign('HMAC', cryptoKey, dataBytes);
    }
    
    _calculateSignature(dateStamp, stringToSign) {
        const kDate = this._hmacSha256(`AWS4${this.secretAccessKey}`, dateStamp);
        const kRegion = this._hmacSha256(kDate, this.region);
        const kService = this._hmacSha256(kRegion, this.service);
        const kSigning = this._hmacSha256(kService, 'aws4_request');
        const signature = this._hmacSha256(kSigning, stringToSign);
        
        return Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}

/* ============================================================
   CONFIGURATION
   ============================================================ */

const AWS_ACCESS_KEY_ID = __ENV.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = __ENV.AWS_SECRET_ACCESS_KEY;
const AWS_SESSION_TOKEN = __ENV.AWS_SESSION_TOKEN || null;
const AWS_REGION = __ENV.AWS_REGION || 'us-east-1';
const AWS_SERVICE = __ENV.AWS_SERVICE || 'execute-api';
const API_ENDPOINT = __ENV.API_ENDPOINT;
const PRINT_CONSOLE_REPORT = __ENV.PRINT_CONSOLE_REPORT === 'true';

if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !API_ENDPOINT) {
    throw new Error('Required: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, API_ENDPOINT');
}

const SLA = {
    get_users: { p90: 500, p95: 800, p99: 1200 },
    create_user: { p90: 800, p95: 1200, p99: 2000 },
    update_user: { p90: 600, p95: 900, p99: 1500 }
};

const TEST_APIS = ['get_users', 'create_user', 'update_user'];

/* ============================================================
   SCENARIO CONFIGURATION
   ============================================================ */

const SCENARIO_CONFIG = {
    aws_api_test: {
        name: 'AWS API Gateway Test',
        startTime: '0s',
        phases: [
            { name: 'Ramp Up', duration: '1m', target: 5 },
            { name: 'Steady State', duration: '5m', target: 5 },
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
let awsSigner = null;

/* ============================================================
   K6 OPTIONS
   ============================================================ */

export const options = {
    scenarios: {
        aws_api_test: {
            executor: 'ramping-vus',
            startTime: SCENARIO_CONFIG.aws_api_test.startTime,
            startVUs: 0,
            stages: SCENARIO_CONFIG.aws_api_test.phases.map(p => ({
                duration: p.duration,
                target: p.target
            })),
            gracefulRampDown: SCENARIO_CONFIG.aws_api_test.gracefulRampDown,
            gracefulStop: SCENARIO_CONFIG.aws_api_test.gracefulStop,
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
    console.log('=== SETUP: Initializing AWS SigV4 Signer ===');
    
    testStartTime = Date.now();
    
    // Initialize AWS Signature V4 signer
    awsSigner = new AWSSignatureV4({
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
        sessionToken: AWS_SESSION_TOKEN,
        region: AWS_REGION,
        service: AWS_SERVICE
    });
    
    console.log(`✓ AWS Signer initialized`);
    console.log(`  Region: ${AWS_REGION}`);
    console.log(`  Service: ${AWS_SERVICE}`);
    console.log(`  Endpoint: ${API_ENDPOINT}`);
    console.log(`  STS Token: ${AWS_SESSION_TOKEN ? 'Yes' : 'No'}`);
    console.log('✓ Setup complete\n');
    
    return { testStartTime };
}

/* ============================================================
   MAIN TEST EXECUTION
   ============================================================ */

export default function (data) {
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, SCENARIO_CONFIG, data.testStartTime);
    
    /* --------------------------------------------------------
       TEST FLOW 1: GET Users (Signed Request)
       -------------------------------------------------------- */
    group('GET Users', () => {
        const signedRequest = awsSigner.sign({
            method: 'GET',
            url: `${API_ENDPOINT}/users`,
            headers: {
                'Content-Type': 'application/json'
            },
            body: null
        });
        
        const res = http.get(signedRequest.url, {
            headers: signedRequest.headers
        });
        
        const statusOk = check(res, {
            'GET status 200': r => r.status === 200,
            'GET has users': r => {
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
       TEST FLOW 2: POST Create User (Signed Request with Body)
       -------------------------------------------------------- */
    group('POST Create User', () => {
        const synth = pf.generateSynthetic();
        
        const requestBody = JSON.stringify({
            first_name: synth.firstName,
            last_name: synth.lastName,
            email: synth.email,
            phone: synth.phone
        });
        
        const signedRequest = awsSigner.sign({
            method: 'POST',
            url: `${API_ENDPOINT}/users`,
            headers: {
                'Content-Type': 'application/json'
            },
            body: requestBody
        });
        
        const res = http.post(
            signedRequest.url,
            requestBody,
            { headers: signedRequest.headers }
        );
        
        const statusOk = check(res, {
            'POST status 200/201': r => r.status === 200 || r.status === 201,
            'POST has user_id': r => r.body.includes('user_id') || r.body.includes('id')
        });
        
        recordMetrics(metrics, 'create_user', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            console.error(`[POST FAILED] Email: ${synth.email} | Status: ${res.status} | Body: ${res.body.slice(0, 200)}`);
        } else {
            // Extract user_id for next request
            try {
                const userId = pf.extract(res, 'user_id') || pf.extract(res, 'id');
                if (userId) {
                    // Update user
                    updateUser(userId, synth.email, scenarioName, currentPhase);
                }
            } catch (e) {
                // Continue
            }
        }
    });
    
    pf.pause(1, 3);
}

/* ============================================================
   HELPER: UPDATE USER
   ============================================================ */

function updateUser(userId, email, scenarioName, currentPhase) {
    group('PUT Update User', () => {
        const updateBody = JSON.stringify({
            email: email,
            phone: `555${Math.floor(1000000 + Math.random() * 8999999)}`
        });
        
        const signedRequest = awsSigner.sign({
            method: 'PUT',
            url: `${API_ENDPOINT}/users/${userId}`,
            headers: {
                'Content-Type': 'application/json'
            },
            body: updateBody
        });
        
        const res = http.put(
            signedRequest.url,
            updateBody,
            { headers: signedRequest.headers }
        );
        
        const statusOk = check(res, {
            'PUT status 200': r => r.status === 200,
            'PUT has success': r => {
                const body = r.body.toLowerCase();
                return body.includes('success') || body.includes('updated');
            }
        });
        
        recordMetrics(metrics, 'update_user', scenarioName, currentPhase, res);
        
        if (!statusOk) {
            console.error(`[PUT FAILED] UserID: ${userId} | Status: ${res.status} | Body: ${res.body.slice(0, 200)}`);
        }
    });
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
   RUN COMMANDS
   ============================================================
   
   # Basic run with AWS credentials
   k6 run aws_sigv4_test.js \
     --env AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE \
     --env AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY \
     --env AWS_REGION=us-east-1 \
     --env AWS_SERVICE=execute-api \
     --env API_ENDPOINT=https://abc123.execute-api.us-east-1.amazonaws.com/prod \
     2> error.log
   
   # With STS Session Token
   k6 run aws_sigv4_test.js \
     --env AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE \
     --env AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY \
     --env AWS_SESSION_TOKEN=FwoGZXIvYXdzEBQaD... \
     --env AWS_REGION=us-east-1 \
     --env AWS_SERVICE=execute-api \
     --env API_ENDPOINT=https://abc123.execute-api.us-east-1.amazonaws.com/prod \
     --env PRINT_CONSOLE_REPORT=true \
     2> error.log
   
   # Using environment variables
   export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
   export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG
   export AWS_REGION=us-east-1
   export AWS_SERVICE=execute-api
   export API_ENDPOINT=https://abc123.execute-api.us-east-1.amazonaws.com/prod
   
   k6 run aws_sigv4_test.js 2> error.log
   
   # For S3
   k6 run aws_sigv4_test.js \
     --env AWS_SERVICE=s3 \
     --env API_ENDPOINT=https://my-bucket.s3.us-east-1.amazonaws.com \
     ...
   
   # For DynamoDB
   k6 run aws_sigv4_test.js \
     --env AWS_SERVICE=dynamodb \
     --env AWS_REGION=us-west-2 \
     --env API_ENDPOINT=https://dynamodb.us-west-2.amazonaws.com \
     ...
   
   ============================================================ */
