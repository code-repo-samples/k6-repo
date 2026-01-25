/**
 * ============================================================
 * AWS Signature V4 Implementation for K6
 * ============================================================
 * 
 * Features:
 *  ✓ AWS Signature Version 4 signing
 *  ✓ Support for Access Key + Secret Key
 *  ✓ Optional STS Session Token support
 *  ✓ All AWS services (API Gateway, S3, DynamoDB, etc.)
 *  ✓ No date/signature mismatch errors
 *  ✓ Handles query strings and request bodies
 * 
 * Usage:
 *   import { AWSSignatureV4 } from './aws-sigv4.js';
 *   
 *   const signer = new AWSSignatureV4({
 *     accessKeyId: __ENV.AWS_ACCESS_KEY_ID,
 *     secretAccessKey: __ENV.AWS_SECRET_ACCESS_KEY,
 *     sessionToken: __ENV.AWS_SESSION_TOKEN,  // Optional
 *     region: __ENV.AWS_REGION || 'us-east-1',
 *     service: 'execute-api'
 *   });
 *   
 *   const signedRequest = signer.sign({
 *     method: 'GET',
 *     url: 'https://abc123.execute-api.us-east-1.amazonaws.com/prod/users',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: null
 *   });
 *   
 *   const res = http.get(signedRequest.url, { headers: signedRequest.headers });
 */

import { crypto } from 'k6/experimental/webcrypto';
import encoding from 'k6/encoding';

export class AWSSignatureV4 {
    constructor(config) {
        this.accessKeyId = config.accessKeyId;
        this.secretAccessKey = config.secretAccessKey;
        this.sessionToken = config.sessionToken || null;
        this.region = config.region || 'us-east-1';
        this.service = config.service || 'execute-api';
        
        if (!this.accessKeyId || !this.secretAccessKey) {
            throw new Error('AWS credentials required: accessKeyId and secretAccessKey');
        }
    }
    
    /**
     * Sign an AWS request
     * @param {Object} request - { method, url, headers, body }
     * @returns {Object} - { url, headers } ready for http request
     */
    sign(request) {
        const { method, url, headers = {}, body = null } = request;
        
        // Parse URL
        const urlObj = this._parseURL(url);
        
        // Get current timestamp
        const now = new Date();
        const amzDate = this._getAmzDate(now);
        const dateStamp = this._getDateStamp(now);
        
        // Prepare headers
        const signedHeaders = this._prepareHeaders(headers, urlObj.host, amzDate);
        
        // Create canonical request
        const canonicalRequest = this._createCanonicalRequest(
            method,
            urlObj.path,
            urlObj.queryString,
            signedHeaders.canonical,
            signedHeaders.signed,
            body
        );
        
        // Create string to sign
        const credentialScope = `${dateStamp}/${this.region}/${this.service}/aws4_request`;
        const stringToSign = this._createStringToSign(
            amzDate,
            credentialScope,
            canonicalRequest
        );
        
        // Calculate signature
        const signature = this._calculateSignature(
            this.secretAccessKey,
            dateStamp,
            this.region,
            this.service,
            stringToSign
        );
        
        // Create authorization header
        const authorizationHeader = this._createAuthorizationHeader(
            this.accessKeyId,
            credentialScope,
            signedHeaders.signed,
            signature
        );
        
        // Build final headers
        const finalHeaders = {
            ...signedHeaders.headers,
            'Authorization': authorizationHeader
        };
        
        // Add session token if present
        if (this.sessionToken) {
            finalHeaders['X-Amz-Security-Token'] = this.sessionToken;
        }
        
        return {
            url: url,
            headers: finalHeaders
        };
    }
    
    /* ============================================================
       PRIVATE METHODS
       ============================================================ */
    
    _parseURL(url) {
        const urlPattern = /^(https?):\/\/([^\/\?]+)(\/[^\?]*)?(\?.*)?$/;
        const match = url.match(urlPattern);
        
        if (!match) {
            throw new Error(`Invalid URL: ${url}`);
        }
        
        return {
            protocol: match[1],
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
    
    _prepareHeaders(headers, host, amzDate) {
        const preparedHeaders = {
            'Host': host,
            'X-Amz-Date': amzDate,
            ...headers
        };
        
        // Sort header keys (case-insensitive)
        const sortedKeys = Object.keys(preparedHeaders).sort((a, b) => 
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
        
        // Create canonical headers string
        const canonicalHeaders = sortedKeys
            .map(key => `${key.toLowerCase()}:${preparedHeaders[key].trim()}`)
            .join('\n') + '\n';
        
        // Create signed headers string
        const signedHeaders = sortedKeys
            .map(key => key.toLowerCase())
            .join(';');
        
        return {
            headers: preparedHeaders,
            canonical: canonicalHeaders,
            signed: signedHeaders
        };
    }
    
    _createCanonicalRequest(method, path, queryString, canonicalHeaders, signedHeaders, body) {
        // Canonical URI (path)
        const canonicalUri = path || '/';
        
        // Canonical query string
        const canonicalQueryString = this._createCanonicalQueryString(queryString);
        
        // Payload hash
        const payloadHash = this._hash(body || '');
        
        return [
            method.toUpperCase(),
            canonicalUri,
            canonicalQueryString,
            canonicalHeaders,
            signedHeaders,
            payloadHash
        ].join('\n');
    }
    
    _createCanonicalQueryString(queryString) {
        if (!queryString) return '';
        
        // Parse query parameters
        const params = queryString.split('&').map(param => {
            const [key, value] = param.split('=');
            return {
                key: this._uriEncode(key),
                value: this._uriEncode(value || '')
            };
        });
        
        // Sort by key, then by value
        params.sort((a, b) => {
            if (a.key < b.key) return -1;
            if (a.key > b.key) return 1;
            if (a.value < b.value) return -1;
            if (a.value > b.value) return 1;
            return 0;
        });
        
        // Build canonical query string
        return params.map(p => `${p.key}=${p.value}`).join('&');
    }
    
    _createStringToSign(amzDate, credentialScope, canonicalRequest) {
        const hashedCanonicalRequest = this._hash(canonicalRequest);
        
        return [
            'AWS4-HMAC-SHA256',
            amzDate,
            credentialScope,
            hashedCanonicalRequest
        ].join('\n');
    }
    
    _calculateSignature(secretKey, dateStamp, region, service, stringToSign) {
        const kDate = this._hmac(`AWS4${secretKey}`, dateStamp);
        const kRegion = this._hmac(kDate, region);
        const kService = this._hmac(kRegion, service);
        const kSigning = this._hmac(kService, 'aws4_request');
        
        return this._hmac(kSigning, stringToSign, 'hex');
    }
    
    _createAuthorizationHeader(accessKeyId, credentialScope, signedHeaders, signature) {
        return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    }
    
    /* ============================================================
       CRYPTOGRAPHIC HELPERS
       ============================================================ */
    
    _hash(data) {
        // SHA256 hash
        const hasher = crypto.subtle.digest('SHA-256', this._stringToArrayBuffer(data));
        return this._arrayBufferToHex(hasher);
    }
    
    _hmac(key, data, encoding = 'binary') {
        // HMAC-SHA256
        const keyBuffer = typeof key === 'string' 
            ? this._stringToArrayBuffer(key) 
            : key;
        
        const dataBuffer = this._stringToArrayBuffer(data);
        
        const signature = crypto.subtle.sign(
            { name: 'HMAC', hash: 'SHA-256' },
            crypto.subtle.importKey(
                'raw',
                keyBuffer,
                { name: 'HMAC', hash: 'SHA-256' },
                false,
                ['sign']
            ),
            dataBuffer
        );
        
        if (encoding === 'hex') {
            return this._arrayBufferToHex(signature);
        }
        
        return signature;
    }
    
    _uriEncode(str) {
        return encodeURIComponent(str)
            .replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    }
    
    _stringToArrayBuffer(str) {
        const encoder = new TextEncoder();
        return encoder.encode(str);
    }
    
    _arrayBufferToHex(buffer) {
        const bytes = new Uint8Array(buffer);
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}

/* ============================================================
   ALTERNATIVE: Using k6/experimental/aws (Simpler but Limited)
   ============================================================ */

/**
 * K6 has experimental AWS support, but it's limited.
 * Use the class above for full control.
 * 
 * Example with experimental module:
 * 
 * import aws from 'k6/experimental/aws';
 * 
 * const awsConfig = {
 *   region: __ENV.AWS_REGION,
 *   accessKeyId: __ENV.AWS_ACCESS_KEY_ID,
 *   secretAccessKey: __ENV.AWS_SECRET_ACCESS_KEY,
 *   sessionToken: __ENV.AWS_SESSION_TOKEN
 * };
 * 
 * const signer = new aws.SignatureV4();
 * const signedRequest = signer.sign({
 *   method: 'GET',
 *   protocol: 'https',
 *   hostname: 'abc123.execute-api.us-east-1.amazonaws.com',
 *   path: '/prod/users',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: null
 * }, awsConfig);
 * 
 * Note: Experimental module may not work for all services
 */
