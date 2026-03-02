import http from 'k6/http';
import { check, sleep } from 'k6';
import { faker } from 'https://cdn.skypack.dev/@faker-js/faker';

export const options = {
    scenarios: {
        consumer_scenario: {
            executor: 'constant-arrival-rate',
            rate: 2,
            timeUnit: '1s',
            duration: '10m',
            preAllocatedVUs: 10,
            maxVUs: 50,
        },
        ramp_up_scenario: {
            executor: 'ramping-arrival-rate',
            startRate: 2,
            stages: [{ target: 5, duration: '1m' }],
            timeUnit: '1s',
            preAllocatedVUs: 10,
            maxVUs: 50,
            startTime: '10m',
        },
        high_load_scenario: {
            executor: 'constant-arrival-rate',
            rate: 5,
            timeUnit: '1s',
            duration: '5m',
            preAllocatedVUs: 10,
            maxVUs: 50,
            startTime: '11m',
        },
        ramp_down_scenario: {
            executor: 'ramping-arrival-rate',
            startRate: 5,
            stages: [{ target: 1, duration: '1m' }],
            timeUnit: '1s',
            preAllocatedVUs: 10,
            maxVUs: 50,
            startTime: '16m',
        },
        final_phase: {
            executor: 'constant-arrival-rate',
            rate: 1,
            timeUnit: '1s',
            duration: '1m',
            preAllocatedVUs: 5,
            maxVUs: 20,
            startTime: '17m',
        },
    },
};

const SERVICE_URL = __ENV.SERVICE_URL || 'service-url';
const API_KEY = __ENV.API_KEY || 'your-api-key-here';

export default function () {
    // Determine current phase by VU iteration or startTime
    // For simplicity, we tag by scenario name using __VU and __ITER
    const phaseTag = __SCENARIO; // k6 automatically sets this to the scenario name

    const firstName = faker.name.firstName();
    const lastName = faker.name.lastName();
    const email = faker.internet.email(firstName, lastName);
    const phone = faker.phone.number('+1##########');
    const gender = faker.helpers.arrayElement(['MALE', 'FEMALE', 'OTHER']);
    const language = faker.helpers.arrayElement(['en', 'fr', 'es']);
    const country = faker.helpers.arrayElement(['USA', 'CAN', 'FRA', 'GBR']);

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

    // CREATE consumer
    const createRes = http.post(`${SERVICE_URL}/api/v1/consumers`, payload, {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        tags: { phase: phaseTag, action: 'create' },
    });
    check(createRes, { 'create consumer status 201': (r) => r.status === 201 });
    const consumer = createRes.json();
    const CONSUMER_ID = consumer.id;

    // OPTIONAL duplicate insert (50% chance)
    if (Math.random() < 0.1) {
        const dupRes = http.post(`${SERVICE_URL}/api/v1/consumers`, payload, {
            headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
            tags: { phase: phaseTag, action: 'duplicate_insert' },
        });
        check(dupRes, { 'duplicate email status 409': (r) => r.status === 409 });
    }

    // PATCH last name
    const patchRes = http.patch(`${SERVICE_URL}/api/v1/consumers/${CONSUMER_ID}`, JSON.stringify({ lastName: faker.name.lastName() }), {
        headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
        tags: { phase: phaseTag, action: 'patch' },
    });
    check(patchRes, { 'patch consumer status 200': (r) => r.status === 200 });

    // LIST consumers
    http.get(`${SERVICE_URL}/api/v1/consumers?page=1&pageSize=10`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        tags: { phase: phaseTag, action: 'list' },
    });

    // DELETE consumer
    http.del(`${SERVICE_URL}/api/v1/consumers/${CONSUMER_ID}`, null, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        tags: { phase: phaseTag, action: 'delete' },
    });

    sleep(1);
}
