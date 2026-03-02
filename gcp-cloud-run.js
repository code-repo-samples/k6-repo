import http from 'k6/http';
import { check, sleep } from 'k6';
import { faker } from 'https://cdn.skypack.dev/@faker-js/faker';

export const options = {
    scenarios: {
        initial_phase: {
            executor: 'constant-arrival-rate',
            rate: 2, // 2 TPS
            timeUnit: '1s',
            duration: '10m',
            preAllocatedVUs: 10,
            maxVUs: 50,
            exec: 'runInitialPhase',
        },
        ramp_up_phase: {
            executor: 'ramping-arrival-rate',
            startRate: 2,
            stages: [{ target: 5, duration: '1m' }], // ramp to 5 TPS
            timeUnit: '1s',
            preAllocatedVUs: 10,
            maxVUs: 50,
            exec: 'runRampUpPhase',
            startTime: '10m',
        },
        high_load_phase: {
            executor: 'constant-arrival-rate',
            rate: 5, // 5 TPS
            timeUnit: '1s',
            duration: '5m',
            preAllocatedVUs: 10,
            maxVUs: 50,
            exec: 'runHighLoadPhase',
            startTime: '11m',
        },
        ramp_down_phase: {
            executor: 'ramping-arrival-rate',
            startRate: 5,
            stages: [{ target: 1, duration: '1m' }], // ramp down to 1 TPS
            timeUnit: '1s',
            preAllocatedVUs: 10,
            maxVUs: 50,
            exec: 'runRampDownPhase',
            startTime: '16m',
        },
        final_phase: {
            executor: 'constant-arrival-rate',
            rate: 1, // 1 TPS
            timeUnit: '1s',
            duration: '1m',
            preAllocatedVUs: 5,
            maxVUs: 20,
            exec: 'runFinalPhase',
            startTime: '17m',
        },
    },
};

// Environment variables
const SERVICE_URL = __ENV.SERVICE_URL || 'https://consumer-api-830317852816.us-central1.run.app';
const API_KEY = __ENV.API_KEY || 'your-api-key-here';

// ------------------------------
// Scenario functions with phase logging
// ------------------------------
export function runInitialPhase() { 
    console.log('=== Starting phase: initial ==='); 
    runConsumerTest('initial'); 
}

export function runRampUpPhase() { 
    console.log('=== Starting phase: ramp_up ==='); 
    runConsumerTest('ramp_up'); 
}

export function runHighLoadPhase() { 
    console.log('=== Starting phase: high_load ==='); 
    runConsumerTest('high_load'); 
}

export function runRampDownPhase() { 
    console.log('=== Starting phase: ramp_down ==='); 
    runConsumerTest('ramp_down'); 
}

export function runFinalPhase() { 
    console.log('=== Starting phase: final ==='); 
    runConsumerTest('final'); 
}

// ------------------------------
// Core consumer test logic
// ------------------------------
function runConsumerTest(phaseTag) {
    const firstName = faker.name.firstName();
    const lastName = faker.name.lastName();
    const email = faker.internet.email(firstName, lastName);
    const phone = faker.phone.number('+1##########');
    const gender = faker.helpers.arrayElement(['MALE','FEMALE','OTHER']);
    const language = faker.helpers.arrayElement(['en','fr','es']);
    const country = faker.helpers.arrayElement(['USA','CAN','FRA','GBR']);

    const payload = JSON.stringify({
        firstName,
        lastName,
        emailAddress: email,
        phoneNumber: phone,
        countryCode: "+1",
        phoneType: "MOBILE",
        gender,
        language,
        countryOfResidence: country,
        acquisitionSrc: "WEB_SIGNUP"
    });

    // 1. CREATE consumer
    const createRes = http.post(`${SERVICE_URL}/api/v1/consumers`, payload, {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        tags: { phase: phaseTag, action: 'create' },
    });
    check(createRes, { 'status 201': r => r.status === 201 });
    const consumer = createRes.json();
    const CONSUMER_ID = consumer.id;

    // 2. DUPLICATE attempt (5% chance)
    if (Math.random() < 0.05) {
        const dupRes = http.post(`${SERVICE_URL}/api/v1/consumers`, payload, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
            tags: { phase: phaseTag, action: 'duplicate_insert' },
        });
        check(dupRes, { 'status 409': r => r.status === 409 });
    }

    // 3. PATCH last name
    const patchRes = http.patch(`${SERVICE_URL}/api/v1/consumers/${CONSUMER_ID}`, JSON.stringify({ lastName: faker.name.lastName() }), {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        tags: { phase: phaseTag, action: 'patch' },
    });
    check(patchRes, { 'status 200': r => r.status === 200 });

    // 4. LIST consumers
    http.get(`${SERVICE_URL}/api/v1/consumers?page=1&pageSize=10`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        tags: { phase: phaseTag, action: 'list' },
    });

    // 5. DELETE consumer (10% chance)
    if (Math.random() < 0.1) {
        const deleteRes = http.del(`${SERVICE_URL}/api/v1/consumers/${CONSUMER_ID}`, null, {
            headers: { 'Authorization': `Bearer ${API_KEY}` },
            tags: { phase: phaseTag, action: 'delete' },
        });
        check(deleteRes, { 'delete status 200': r => r.status === 200 });
    }

    sleep(1);
}
