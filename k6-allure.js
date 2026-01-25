import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';
import { v4 as uuidv4 } from 'uuid';

/** ------------------ HELP MENU ------------------ */
if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
k6 Allure Reporter CLI
======================
Usage:
  node generate.js <APP_NAME> <RUN_ID> <HTML_FILE> [GENERIC_SLA] [MIN_PASS_COUNT]

Arguments:
  1. APP_NAME        Name of the application (e.g., "PaymentsAPI")
  2. RUN_ID          Identifier for the run (e.g., "Build_104")
  3. HTML_FILE       The k6 html report file (e.g., "report.html")
  4. GENERIC_SLA     (Optional) Fallback P90 SLA in ms if HTML shows "N/A"
  5. MIN_PASS_COUNT  (Optional) Minimum successful transactions required per API

Examples:
  node generate.js "MyApp" "Run_01" "report.html"
  node generate.js "MyApp" "Run_01" "report.html" 500 100

Environment Variables:
  Alternatively, you can set: APP_NAME, RUN_ID, HTML_FILE, GENERIC_SLA, MIN_PASS_COUNT
    `);
    process.exit(0);
}

/** ------------------ CONFIG ------------------ */

const APP_NAME = process.argv[2] || process.env.APP_NAME || 'MyApp';
const RUN_NAME = process.argv[3] || process.env.RUN_ID || 'Complex Load Test Jan24';
const HTML_FILE = process.argv[4] || process.env.HTML_FILE || 'k6-performance-report.html';

// New: Capture generic SLA from CLI (e.g., 500)
const GENERIC_SLA = process.argv[5] || process.env.GENERIC_SLA || null;
// New: Capture generic Min Pass Count (e.g., 100)
const MIN_PASS_COUNT = process.argv[6] || process.env.MIN_PASS_COUNT || null;

const HTML_REPORT_PATH = path.join(process.cwd(), HTML_FILE);
const ALLURE_RESULTS_DIR = path.join(process.cwd(), 'allure-results');

const ERROR_THRESHOLD = 5.0; 

if (!fs.existsSync(ALLURE_RESULTS_DIR)) fs.mkdirSync(ALLURE_RESULTS_DIR, { recursive: true });

/** ------------------ HELPER: Write Allure Test ------------------ */
function writeAllureTest({ parentSuite, suite, subSuite, name, status, statusDetails, steps = [], attachments = [], labels = [], start, stop }) {
    const uuid = uuidv4();
    const result = {
        uuid,
        name,
        status,
        statusDetails,
        stage: 'finished',
        steps: steps.map(s => ({ 
            ...s, 
            stage: 'finished', 
            start: s.start || start, 
            stop: s.stop || stop 
        })),
        attachments: attachments.map(a => ({
            name: a.name,
            source: `${uuid}-${a.name.replace(/\s+/g, '-')}.html`,
            type: a.type
        })),
        labels: [
            { name: 'parentSuite', value: parentSuite },
            { name: 'suite', value: suite },
            { name: 'subSuite', value: subSuite },
            ...labels
        ],
        start: start || Date.now(),
        stop: stop || Date.now()
    };
    // ... write file logic ...

    fs.writeFileSync(path.join(ALLURE_RESULTS_DIR, `${uuid}-result.json`), JSON.stringify(result, null, 2));
    attachments.forEach(a => {
        fs.writeFileSync(path.join(ALLURE_RESULTS_DIR, `${uuid}-${a.name.replace(/\s+/g, '-')}.html`), a.content);
    });
}

/** ------------------ PARSER ------------------ */
function parseK6Report(htmlFilePath) {
    const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
    const dom = new JSDOM(htmlContent);
    const doc = dom.window.document;

    const executionSummary = [];
    const execTable = Array.from(doc.querySelectorAll('h2')).find(h => h.textContent.includes('Execution Summary'))?.nextElementSibling;
    if (execTable) {
        Array.from(execTable.querySelectorAll('tr')).forEach(tr => {
            const key = tr.querySelector('th')?.textContent.trim();
            const value = tr.querySelector('td')?.textContent.trim();
            if (key && value) executionSummary.push({ name: key, value });
        });
    }

    const apiMetrics = [];
    const summaryTable = Array.from(doc.querySelectorAll('h2')).find(h => h.textContent.includes('Overall Summary'))?.nextElementSibling;
    if (summaryTable) {
        Array.from(summaryTable.querySelectorAll('tr')).slice(1).forEach(tr => {
            const tds = tr.querySelectorAll('td');
            apiMetrics.push({
                api: tds[0].textContent.trim(), sla: tds[1].textContent.trim(), min: tds[2].textContent.trim(),
                max: tds[3].textContent.trim(), avg: tds[4].textContent.trim(), p90: tds[5].textContent.trim(),
                p95: tds[6].textContent.trim(), p99: tds[7].textContent.trim(), total: tds[8].textContent.trim(),
                passed: tds[9].textContent.trim(), failed: tds[10].textContent.trim(), errorPct: tds[11].textContent.trim(),
                status: tds[12].textContent.trim()
            });
        });
    }
    return { executionSummary, apiMetrics };
}

/** ------------------ GENERATE ------------------ */
// function generateAllure(htmlFilePath) {
//     const { executionSummary, apiMetrics } = parseK6Report(htmlFilePath);

//     // 1. Transactions Sub-Suite
//     apiMetrics.forEach(api => {
//         const p90Val = parseFloat(api.p90);

//         // Logic: If HTML says N/A and user provided a generic SLA, use generic. 
//         // If HTML has a value, use that value. If both are missing, use 999999 (no fail).
//         let effectiveSla = api.sla;
//         if (api.sla === 'N/A' && GENERIC_SLA !== null) {
//             effectiveSla = GENERIC_SLA;
//         }

//         // const slaVal = api.sla === 'N/A' ? 999999 : parseFloat(api.sla);
//         const slaVal = effectiveSla === 'N/A' ? 999999 : parseFloat(effectiveSla);
//         const errVal = parseFloat(api.errorPct);

//         const steps = [
//             {
//                 name: `Step: Transaction Count Check`,
//                 status: parseInt(api.failed) === 0 ? 'passed' : 'failed',
//                 parameters: [{ name: "Total", value: api.total }, { name: "Passed", value: api.passed }, { name: "Failed", value: api.failed }]
//             },
//             // {
//             //     name: `Step: P90 Response Time Check`,
//             //     status: p90Val <= slaVal ? 'passed' : 'failed',
//             //     parameters: [{ name: "SLA", value: api.sla }, { name: "Actual", value: api.p90 }]
//             // },
//             {
//                 name: `Step: P90 Response Time Check`,
//                 status: p90Val <= slaVal ? 'passed' : 'failed',
//                 // Updated to show the effective SLA being used in the parameters
//                 parameters: [{ name: "SLA Used", value: effectiveSla }, { name: "Actual", value: api.p90 }]
//             },
//             {
//                 name: `Step: Error % Check`,
//                 status: errVal <= ERROR_THRESHOLD ? 'passed' : 'failed',
//                 parameters: [{ name: "Threshold", value: `< ${ERROR_THRESHOLD}%` }, { name: "Actual", value: `${api.errorPct}%` }]
//             }
//         ];

//         writeAllureTest({
//             parentSuite: APP_NAME,
//             suite: RUN_NAME,
//             subSuite: 'Transactions',
//             name: `Test Case: ${api.api} (P90: ${api.p90} | SLA: ${api.sla} | Count: ${api.total})`,
//             status: steps.some(s => s.status === 'failed') ? 'failed' : 'passed',
//             steps,
//             labels: Object.entries(api).map(([k, v]) => ({ name: k, value: String(v) }))
//         });
//     });

//     // 2. Overall Report Summary - Neutral Status with Full Detailed Table
//     const w = { icon: 3, api: 16, p90: 7, sla: 6, p95: 7, p99: 7, min: 7, max: 7, avg: 7, pass: 6, err: 7, tot: 6 };
//     let textTable = "API PERFORMANCE SUMMARY:\n\n";
//     textTable += " ".padEnd(w.icon) + "API".padEnd(w.api) + " | P90".padEnd(w.p90+3) + " | SLA".padEnd(w.sla+3) + " | P95".padEnd(w.p95+3) + " | P99".padEnd(w.p99+3) + " | MIN".padEnd(w.min+3) + " | MAX".padEnd(w.max+3) + " | AVG".padEnd(w.avg+3) + " | PASS".padEnd(w.pass+3) + " | ERR%".padEnd(w.err+3) + " | TOTAL\n";
//     textTable += " ".padEnd(w.icon) + "-".repeat(135) + "\n";

//     apiMetrics.forEach(api => {
//         const icon = (parseFloat(api.errorPct) > ERROR_THRESHOLD || api.status === 'FAIL') ? "❌" : "✅";
//         textTable += icon.padEnd(w.icon) + 
//                      api.api.padEnd(w.api) + " | " + 
//                      api.p90.padEnd(w.p90) + " | " + 
//                      api.sla.padEnd(w.sla) + " | " + 
//                      api.p95.padEnd(w.p95) + " | " + 
//                      api.p99.padEnd(w.p99) + " | " + 
//                      api.min.padEnd(w.min) + " | " + 
//                      api.max.padEnd(w.max) + " | " + 
//                      api.avg.padEnd(w.avg) + " | " + 
//                      api.passed.padEnd(w.pass) + " | " + 
//                      (api.errorPct + "%").padEnd(w.err) + " | " + 
//                      api.total + "\n";
//     });

//     const attachmentHtml = `
//     <table border="1" style="width:100%; font-family: sans-serif; border-collapse: collapse;">
//         <tr style="background: #4CAF50; color: white;"><th>API</th><th>SLA</th><th>Min</th><th>Max</th><th>Avg</th><th>P90</th><th>P95</th><th>P99</th><th>Passed</th><th>Failed</th><th>Err %</th><th>Status</th></tr>
//         ${apiMetrics.map(api => `<tr style="background: ${parseFloat(api.errorPct) > ERROR_THRESHOLD ? '#f8d7da' : '#d4edda'}">
//             <td>${api.api}</td><td>${api.sla}</td><td>${api.min}</td><td>${api.max}</td><td>${api.avg}</td><td>${api.p90}</td><td>${api.p95}</td><td>${api.p99}</td><td>${api.passed}</td><td>${api.failed}</td><td>${api.errorPct}%</td><td>${api.status}</td>
//         </tr>`).join('')}
//     </table>`;

//     writeAllureTest({
//         parentSuite: APP_NAME,
//         suite: RUN_NAME,
//         subSuite: 'Overall Report Summary',
//         name: 'Test Case: Overall Report',
//         status: 'passed',
//         statusDetails: { message: textTable },
//         labels: executionSummary,
//         attachments: [{ name: 'Full Metrics Table', content: attachmentHtml, type: 'text/html' }]
//     });

//     console.log(`✅ Success: Allure results generated in ${ALLURE_RESULTS_DIR}`);
// }
function generateAllure(htmlFilePath) {
    const { executionSummary, apiMetrics } = parseK6Report(htmlFilePath);

    // Get duration for timestamp logic (prevents "0s" duration in Allure)
    const durationObj = executionSummary.find(m => m.name.includes('Duration'));
    const durationMs = durationObj ? parseFloat(durationObj.value) * 1000 : 1000;
    const now = Date.now();
    const startTime = now - durationMs;

    // 1. Transactions Sub-Suite
    apiMetrics.forEach(api => {
        const p90Val = parseFloat(api.p90);
        const errVal = parseFloat(api.errorPct);
        const passedCount = parseInt(api.passed);
        const failedCount = parseInt(api.failed);

        /** --- SLA Fallback Logic --- */
        // P90 SLA: Use generic if HTML shows N/A
        let effectiveSla = api.sla;
        if (api.sla === 'N/A' && GENERIC_SLA !== null) {
            effectiveSla = GENERIC_SLA;
        }
        const slaVal = effectiveSla === 'N/A' ? 999999 : parseFloat(effectiveSla);

        // Transaction Count Status: Use MIN_PASS_COUNT if provided, else check for 0 failures
        const countStatus = MIN_PASS_COUNT !== null 
            ? (passedCount >= parseInt(MIN_PASS_COUNT) ? 'passed' : 'failed')
            : (failedCount === 0 ? 'passed' : 'failed');

        const steps = [
            {
                name: `Step: Transaction Count Check`,
                status: countStatus,
                parameters: [
                    { name: "Total", value: api.total }, 
                    { name: "Passed", value: api.passed }, 
                    { name: "Min Required", value: MIN_PASS_COUNT || "Any (Zero Failures)" }
                ]
            },
            {
                name: `Step: P90 Response Time Check`,
                status: p90Val <= slaVal ? 'passed' : 'failed',
                parameters: [{ name: "SLA Used", value: effectiveSla }, { name: "Actual", value: api.p90 }]
            },
            {
                name: `Step: Error % Check`,
                status: errVal <= ERROR_THRESHOLD ? 'passed' : 'failed',
                parameters: [{ name: "Threshold", value: `< ${ERROR_THRESHOLD}%` }, { name: "Actual", value: `${api.errorPct}%` }]
            }
        ];

        writeAllureTest({
            parentSuite: APP_NAME,
            suite: RUN_NAME,
            subSuite: 'Transactions',
            // name: `Test Case: ${api.api} (P90: ${api.p90} | SLA: ${effectiveSla})`,
            name: `Test Case: ${api.api} (P90: ${api.p90} | SLA: ${effectiveSla} | Count: ${api.total})`,
            status: steps.some(s => s.status === 'failed') ? 'failed' : 'passed',
            steps,
            // start: startTime,
            // stop: now,
            labels: Object.entries(api).map(([k, v]) => ({ name: k, value: String(v) }))
        });
    });

    // 2. Overall Report Summary - Neutral Status with Full Detailed Table
    const w = { icon: 3, api: 16, p90: 7, sla: 6, p95: 7, p99: 7, min: 7, max: 7, avg: 7, pass: 6, err: 7, tot: 6 };
    let textTable = "API PERFORMANCE SUMMARY:\n\n";
    textTable += " ".padEnd(w.icon) + "API".padEnd(w.api) + " | P90".padEnd(w.p90+3) + " | SLA".padEnd(w.sla+3) + " | P95".padEnd(w.p95+3) + " | P99".padEnd(w.p99+3) + " | MIN".padEnd(w.min+3) + " | MAX".padEnd(w.max+3) + " | AVG".padEnd(w.avg+3) + " | PASS".padEnd(w.pass+3) + " | ERR%".padEnd(w.err+3) + " | TOTAL\n";
    textTable += " ".padEnd(w.icon) + "-".repeat(135) + "\n";

    apiMetrics.forEach(api => {
        const icon = (parseFloat(api.errorPct) > ERROR_THRESHOLD || api.status === 'FAIL') ? "❌" : "✅";
        textTable += icon.padEnd(w.icon) + 
                     api.api.padEnd(w.api) + " | " + 
                     api.p90.padEnd(w.p90) + " | " + 
                     api.sla.padEnd(w.sla) + " | " + 
                     api.p95.padEnd(w.p95) + " | " + 
                     api.p99.padEnd(w.p99) + " | " + 
                     api.min.padEnd(w.min) + " | " + 
                     api.max.padEnd(w.max) + " | " + 
                     api.avg.padEnd(w.avg) + " | " + 
                     api.passed.padEnd(w.pass) + " | " + 
                     (api.errorPct + "%").padEnd(w.err) + " | " + 
                     api.total + "\n";
    });

    const attachmentHtml = `
    <table border="1" style="width:100%; font-family: sans-serif; border-collapse: collapse;">
        <tr style="background: #4CAF50; color: white;"><th>API</th><th>SLA</th><th>Min</th><th>Max</th><th>Avg</th><th>P90</th><th>P95</th><th>P99</th><th>Passed</th><th>Failed</th><th>Err %</th><th>Status</th></tr>
        ${apiMetrics.map(api => `<tr style="background: ${parseFloat(api.errorPct) > ERROR_THRESHOLD ? '#f8d7da' : '#d4edda'}">
            <td>${api.api}</td><td>${api.sla}</td><td>${api.min}</td><td>${api.max}</td><td>${api.avg}</td><td>${api.p90}</td><td>${api.p95}</td><td>${api.p99}</td><td>${api.passed}</td><td>${api.failed}</td><td>${api.errorPct}%</td><td>${api.status}</td>
        </tr>`).join('')}
    </table>`;

    writeAllureTest({
        parentSuite: APP_NAME,
        suite: RUN_NAME,
        subSuite: 'Overall Report Summary',
        name: 'Test Case: Overall Report',
        status: 'passed',
        statusDetails: { message: textTable },
        labels: executionSummary,
        start: startTime,
        stop: now,
        attachments: [{ name: 'Full Metrics Table', content: attachmentHtml, type: 'text/html' }]
    });

    console.log(`✅ Success: Allure results generated in ${ALLURE_RESULTS_DIR}`);
}
generateAllure(HTML_REPORT_PATH);