import { Trend, Counter } from 'k6/metrics';
import http from 'k6/http';
import exec from 'k6/execution';
// import { open } from 'k6/fs';
import { group, check } from 'k6';


/**
 * Initialize metrics for APIs, scenarios, AND phases
 */
export function initializeMetrics(apis, scenarios, scenarioConfig) {
    const metrics = {};
    const statusCodes = [400, 401, 403, 404, 500, 502, 503, 504];
    
    for (const scenario of scenarios) {
        metrics[scenario] = {
            phases: {}
        };
        
        // Scenario-level metrics (overall)
        for (const api of apis) {
            metrics[scenario][api] = {
                count: new Counter(`count_${api}_${scenario}`),
                failed: new Counter(`failed_${api}_${scenario}`),
                duration: new Trend(`duration_${api}_${scenario}`, true),
                statusCodes: {}
            };
            
            for (const code of statusCodes) {
                metrics[scenario][api].statusCodes[code] = 
                    new Counter(`status_${code}_${api}_${scenario}`);
            }
        }
        
        // Phase-level metrics
        const config = scenarioConfig[scenario];
        if (config?.phases) {
            config.phases.forEach((phase, phaseIndex) => {
                metrics[scenario].phases[phaseIndex] = {};
                
                for (const api of apis) {
                    metrics[scenario].phases[phaseIndex][api] = {
                        count: new Counter(`count_${api}_${scenario}_phase${phaseIndex}`),
                        failed: new Counter(`failed_${api}_${scenario}_phase${phaseIndex}`),
                        duration: new Trend(`duration_${api}_${scenario}_phase${phaseIndex}`, true),
                        statusCodes: {}
                    };
                    
                    for (const code of statusCodes) {
                        metrics[scenario].phases[phaseIndex][api].statusCodes[code] = 
                            new Counter(`status_${code}_${api}_${scenario}_phase${phaseIndex}`);
                    }
                }
            });
        }
    }
    
    return metrics;
}

/**
 * Print console report with restructured format
 */
export function printConsoleReport(data, SLA, apis, scenarios, scenarioConfig) {
    const summary = buildExecutiveSummary(data);
    
    console.log("\n=== EXECUTION SUMMARY ===");
    asciiTable([{
        start: summary.start,
        end: summary.end,
        duration: summary.duration,
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        passPct: summary.passPct
    }]);

    // Overall aggregate summary (all scenarios combined)
    console.log("\n=== OVERALL SUMMARY (All Scenarios) ===");
    const overallRows = buildOverallAggregateTable(data, SLA, apis, scenarios);
    asciiTable(overallRows);

    // Print each scenario with its breakdown
    for (const scenario of scenarios) {
        const config = scenarioConfig[scenario];
        const scenarioName = config.name || scenario;
        
        console.log(`\n\n========================================`);
        console.log(`  ${scenarioName.toUpperCase()}`);
        console.log(`========================================`);
        
        // Scenario overall summary first
        console.log(`\n--- ${scenarioName} - Overall Summary ---`);
        const overallRows = buildScenarioTable(data, scenario, SLA, apis);
        asciiTable(overallRows);
        
        // Then phase breakdown
        if (config.phases) {
            console.log(`\n--- ${scenarioName} - Phase Breakdown ---`);
            
            let currentOffset = parseDuration(config.startTime || '0s');
            
            config.phases.forEach((phase, phaseIndex) => {
                const phaseDuration = parseDuration(phase.duration);
                const phaseStart = new Date(summary.startTime.getTime() + currentOffset * 1000);
                const phaseEnd = new Date(phaseStart.getTime() + phaseDuration * 1000);
                
                console.log(`\n  ${phase.name} (${formatTime(phaseStart)} - ${formatTime(phaseEnd)})`);
                
                const phaseRows = buildPhaseTable(data, scenario, phaseIndex, SLA, apis);
                if (phaseRows.some(r => r.total > 0)) {
                    asciiTable(phaseRows);
                } else {
                    console.log("  No data for this phase");
                }
                
                currentOffset += phaseDuration;
            });
        }
    }
    
    // Error distribution
    console.log("\n\n=== ERROR DISTRIBUTION BY API ===");
    const errorRows = buildApiErrorCorrelation(data, apis, scenarios);
    asciiTable(errorRows);
}

/**
 * Generate HTML report with restructured format
 */
export function generateReport(data, SLA, apis, scenarios, scenarioConfig) {
    const summary = buildExecutiveSummary(data);
    const overallRows = buildOverallAggregateTable(data, SLA, apis, scenarios);
    
    let scenarioSections = '';
    
    for (const scenario of scenarios) {
        const config = scenarioConfig[scenario];
        const scenarioName = config.name || scenario;
        
        scenarioSections += `<h2 style="margin-top: 40px; border-bottom: 3px solid #333; padding-bottom: 10px;">${scenarioName}</h2>`;
        
        // Overall scenario summary
        const overallRows = buildScenarioTable(data, scenario, SLA, apis);
        scenarioSections += `
<h3>Overall Summary</h3>
${renderApiTable('', overallRows)}
`;
        
        // Phase breakdown
        if (config.phases) {
            scenarioSections += `<h3>Phase Breakdown</h3>`;
            
            let currentOffset = parseDuration(config.startTime || '0s');
            
            config.phases.forEach((phase, phaseIndex) => {
                const phaseDuration = parseDuration(phase.duration);
                const phaseStart = new Date(summary.startTime.getTime() + currentOffset * 1000);
                const phaseEnd = new Date(phaseStart.getTime() + phaseDuration * 1000);
                
                const phaseRows = buildPhaseTable(data, scenario, phaseIndex, SLA, apis);
                
                if (phaseRows.some(r => r.total > 0)) {
                    scenarioSections += `
<h4 style="margin-left: 20px; color: #555;">${phase.name} (${formatTime(phaseStart)} - ${formatTime(phaseEnd)})</h4>
${renderApiTable('', phaseRows)}
`;
                } else {
                    scenarioSections += `
<h4 style="margin-left: 20px; color: #999;">${phase.name} (${formatTime(phaseStart)} - ${formatTime(phaseEnd)})</h4>
<p style="margin-left: 20px; color: #999;">No data for this phase</p>
`;
                }
                
                currentOffset += phaseDuration;
            });
        }
    }
    
    const errorRows = buildApiErrorCorrelation(data, apis, scenarios);
    
    const html = `
<html>
<head>
<title>k6 Performance Report</title>
<style>
body { font-family: Arial; padding: 20px; background: #f5f5f5; }
table { border-collapse: collapse; width: 100%; margin-bottom: 20px; background: white; }
th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
th { background: #4CAF50; color: white; font-weight: bold; }
.pass { background: #d4edda; }
.fail { background: #f8d7da; }
h2 { margin-top: 30px; color: #333; }
h3 { margin-top: 20px; color: #555; }
h4 { margin-top: 15px; color: #666; }
</style>
</head>
<body>

<h1>k6 Performance Test Report</h1>

${renderExecutiveSummary(summary)}

<h2>Overall Summary (All Scenarios)</h2>
${renderApiTable('', overallRows)}

${scenarioSections}

${renderErrorTable(errorRows)}

</body>
</html>
`;

    return { 'k6-performance-report.html': html };
}

/* ------------------- BUILD OVERALL AGGREGATE TABLE (ALL SCENARIOS) ------------------- */
function buildOverallAggregateTable(data, SLA, apis, scenarios) {
    const rows = [];

    for (const api of apis) {
        let total = 0;
        let failed = 0;
        const allDurations = [];

        // Aggregate across all scenarios
        for (const scenario of scenarios) {
            const countMetricName = `count_${api}_${scenario}`;
            const failedMetricName = `failed_${api}_${scenario}`;
            const durationMetricName = `duration_${api}_${scenario}`;

            if (data.metrics[countMetricName]?.values?.count) {
                total += data.metrics[countMetricName].values.count;
            }
            if (data.metrics[failedMetricName]?.values?.count) {
                failed += data.metrics[failedMetricName].values.count;
            }
            if (data.metrics[durationMetricName]?.values) {
                allDurations.push(data.metrics[durationMetricName].values);
            }
        }

        let min = 0, max = 0, avg = 0, p90 = 0, p95 = 0, p99 = 0;

        if (allDurations.length > 0) {
            const validMins = allDurations.map(d => d.min).filter(v => v !== undefined && v !== null && isFinite(v));
            const validMaxs = allDurations.map(d => d.max).filter(v => v !== undefined && v !== null && isFinite(v));
            
            min = validMins.length > 0 ? Math.min(...validMins) : 0;
            max = validMaxs.length > 0 ? Math.max(...validMaxs) : 0;
            avg = allDurations.reduce((sum, d) => sum + (d.avg || 0), 0) / allDurations.length;
            p90 = allDurations.reduce((sum, d) => sum + (d['p(90)'] || 0), 0) / allDurations.length;
            p95 = allDurations.reduce((sum, d) => sum + (d['p(95)'] || 0), 0) / allDurations.length;
            p99 = allDurations.reduce((sum, d) => sum + (d['p(99)'] || 0), 0) / allDurations.length;
        }

        const passed = total - failed;
        const errorPct = total ? ((failed / total) * 100).toFixed(2) : '0.00';

        const hasSLA = SLA && SLA[api];
        const slaP90 = hasSLA && SLA[api].p90 !== undefined ? SLA[api].p90 : 'N/A';

        let status = 'N/A';
        if (hasSLA && total > 0) {
            const p90Fail = slaP90 !== 'N/A' && p90 > slaP90;
            status = p90Fail ? 'FAIL' : 'PASS';
        }

        rows.push({
            api,
            sla: slaP90,
            min: min.toFixed(2),
            max: max.toFixed(2),
            avg: avg.toFixed(2),
            p90: p90.toFixed(2),
            p95: p95.toFixed(2),
            p99: p99.toFixed(2),
            total,
            passed,
            failed,
            errorPct,
            status
        });
    }

    return rows;
}

/* ------------------- BUILD PHASE TABLE ------------------- */
function buildPhaseTable(data, scenario, phaseIndex, SLA, apis) {
    const rows = [];
    
    for (const api of apis) {
        const countMetricName = `count_${api}_${scenario}_phase${phaseIndex}`;
        const durationMetricName = `duration_${api}_${scenario}_phase${phaseIndex}`;
        const failedMetricName = `failed_${api}_${scenario}_phase${phaseIndex}`;
        
        let total = data.metrics[countMetricName]?.values?.count || 0;
        let failed = data.metrics[failedMetricName]?.values?.count || 0;
        
        let min = 0, max = 0, avg = 0, p90 = 0, p95 = 0, p99 = 0;
        
        if (data.metrics[durationMetricName]?.values) {
            const dv = data.metrics[durationMetricName].values;
            min = dv.min || 0;
            max = dv.max || 0;
            avg = dv.avg || 0;
            p90 = dv['p(90)'] || 0;
            p95 = dv['p(95)'] || 0;
            p99 = dv['p(99)'] || 0;
        }
        
        const passed = total - failed;
        const errorPct = total ? ((failed / total) * 100).toFixed(2) : '0.00';
        
        const hasSLA = SLA && SLA[api];
        const slaP90 = hasSLA && SLA[api].p90 !== undefined ? SLA[api].p90 : 'N/A';
        
        let status = 'N/A';
        if (hasSLA && total > 0) {
            const p90Fail = slaP90 !== 'N/A' && p90 > slaP90;
            status = p90Fail ? 'FAIL' : 'PASS';
        }
        
        rows.push({
            api,
            sla: slaP90,
            min: min.toFixed(2),
            max: max.toFixed(2),
            avg: avg.toFixed(2),
            p90: p90.toFixed(2),
            p95: p95.toFixed(2),
            p99: p99.toFixed(2),
            total,
            passed,
            failed,
            errorPct,
            status
        });
    }
    
    return rows;
}

/* ------------------- SCENARIO TABLE (Overall) ------------------- */
function buildScenarioTable(data, scenario, SLA, apis) {
    const rows = [];

    for (const api of apis) {
        const countMetricName = `count_${api}_${scenario}`;
        const durationMetricName = `duration_${api}_${scenario}`;
        const failedMetricName = `failed_${api}_${scenario}`;

        let total = data.metrics[countMetricName]?.values?.count || 0;
        let failed = data.metrics[failedMetricName]?.values?.count || 0;

        let min = 0, max = 0, avg = 0, p90 = 0, p95 = 0, p99 = 0;

        if (data.metrics[durationMetricName]?.values) {
            const dv = data.metrics[durationMetricName].values;
            min = dv.min || 0;
            max = dv.max || 0;
            avg = dv.avg || 0;
            p90 = dv['p(90)'] || 0;
            p95 = dv['p(95)'] || 0;
            p99 = dv['p(99)'] || 0;
        }

        const passed = total - failed;
        const errorPct = total ? ((failed / total) * 100).toFixed(2) : '0.00';

        const hasSLA = SLA && SLA[api];
        const slaP90 = hasSLA && SLA[api].p90 !== undefined ? SLA[api].p90 : 'N/A';

        let status = 'N/A';
        if (hasSLA && total > 0) {
            const p90Fail = slaP90 !== 'N/A' && p90 > slaP90;
            status = p90Fail ? 'FAIL' : 'PASS';
        }

        rows.push({
            api,
            sla: slaP90,
            min: min.toFixed(2),
            max: max.toFixed(2),
            avg: avg.toFixed(2),
            p90: p90.toFixed(2),
            p95: p95.toFixed(2),
            p99: p99.toFixed(2),
            total,
            passed,
            failed,
            errorPct,
            status
        });
    }

    return rows;
}

/* ------------------- HELPER FUNCTIONS ------------------- */
function buildExecutiveSummary(data) {
    const durationMs = data.state.testRunDurationMs || 0;
    const now = new Date();
    const end = now.toLocaleString();
    const startTime = new Date(now.getTime() - durationMs);
    const start = startTime.toLocaleString();

    const total = data.metrics.http_reqs?.values?.count || 0;
    const failRate = data.metrics.http_req_failed?.values?.rate || 0;
    const failed = Math.round(total * failRate);
    const passed = total - failed;

    return {
        start,
        end,
        duration: (durationMs / 1000).toFixed(2),
        total,
        passed,
        failed,
        passPct: total ? ((passed / total) * 100).toFixed(2) : '0.00',
        startTime: startTime,
    };
}

function renderExecutiveSummary(s) {
    return `
<h2>Execution Summary</h2>
<table>
<tr><th>Start Time</th><td>${s.start}</td></tr>
<tr><th>End Time</th><td>${s.end}</td></tr>
<tr><th>Duration (sec)</th><td>${s.duration}</td></tr>
<tr><th>Total Transactions</th><td>${s.total}</td></tr>
<tr><th>Passed</th><td>${s.passed}</td></tr>
<tr><th>Failed</th><td>${s.failed}</td></tr>
<tr><th>Pass %</th><td>${s.passPct}%</td></tr>
</table>`;
}

function buildApiErrorCorrelation(data, apis, scenarios) {
    const finalRows = [];

    for (const api of apis) {
        for (const status of [400, 401, 403, 404, 500, 502, 503, 504]) {
            let totalCount = 0;

            // Sum only once across scenarios
            for (const scenario of scenarios) {
                const metricName = `status_${status}_${api}_${scenario}`;
                totalCount += data.metrics[metricName]?.values?.count || 0;
            }

            if (totalCount > 0) {
                finalRows.push({
                    api,
                    status,
                    count: totalCount,
                });
            }
        }
    }

    // Compute percentage relative to total errors
    const totalErrors = finalRows.reduce((sum, r) => sum + r.count, 0);
    finalRows.forEach(r => {
        r.pct = totalErrors ? ((r.count / totalErrors) * 100).toFixed(2) : '0.00';
    });

    return finalRows;
}

function parseDuration(duration) {
    if (!duration || duration === '0s') return 0;
    
    let totalSeconds = 0;
    const regex = /(\d+)([smh])/g;
    let match;
    
    while ((match = regex.exec(duration)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2];
        
        switch (unit) {
            case 's': totalSeconds += value; break;
            case 'm': totalSeconds += value * 60; break;
            case 'h': totalSeconds += value * 3600; break;
        }
    }
    
    return totalSeconds;
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour12: false });
}

function asciiTable(data) {
    if (!data || data.length === 0) {
        console.log("No data available");
        return;
    }

    const keys = Object.keys(data[0]);
    
    const colWidths = keys.map(key => {
        return Math.max(
            key.length,
            ...data.map(row => String(row[key] ?? "").length)
        );
    });

    const separator = "+" + colWidths.map(w => "-".repeat(w + 2)).join("+") + "+";
    const header = "|" + keys.map((key, i) => ` ${key.padEnd(colWidths[i])} `).join("|") + "|";

    console.log(separator);
    console.log(header);
    console.log(separator);

    data.forEach(row => {
        const line = "|" + keys.map((key, i) => {
            const val = String(row[key] ?? "");
            return ` ${val.padEnd(colWidths[i])} `;
        }).join("|") + "|";
        console.log(line);
    });

    console.log(separator);
}



function renderApiTable(title, rows) {
    if (title) {
        return `
<h2>${title}</h2>
<table>
<tr>
<th>API</th><th>SLA P90</th><th>Min</th><th>Max</th><th>Avg</th>
<th>P90</th><th>P95</th><th>P99</th>
<th>Total</th><th>Passed</th><th>Failed</th><th>Error %</th><th>Status</th>
</tr>
${rows.map(r => `
<tr>
<td>${r.api}</td><td>${r.sla}</td><td>${r.min}</td><td>${r.max}</td><td>${r.avg}</td>
<td>${r.p90}</td><td>${r.p95}</td><td>${r.p99}</td>
<td>${r.total}</td><td>${r.passed}</td><td>${r.failed}</td>
<td>${r.errorPct}</td><td class="${r.status === 'FAIL' ? 'fail' : 'pass'}">${r.status}</td>
</tr>`).join('')}
</table>`;
    }
    
    return `
<table>
<tr>
<th>API</th><th>SLA P90</th><th>Min</th><th>Max</th><th>Avg</th>
<th>P90</th><th>P95</th><th>P99</th>
<th>Total</th><th>Passed</th><th>Failed</th><th>Error %</th><th>Status</th>
</tr>
${rows.map(r => `
<tr>
<td>${r.api}</td><td>${r.sla}</td><td>${r.min}</td><td>${r.max}</td><td>${r.avg}</td>
<td>${r.p90}</td><td>${r.p95}</td><td>${r.p99}</td>
<td>${r.total}</td><td>${r.passed}</td><td>${r.failed}</td>
<td>${r.errorPct}</td><td class="${r.status === 'FAIL' ? 'fail' : 'pass'}">${r.status}</td>
</tr>`).join('')}
</table>`;
}

function renderErrorTable(rows) {
    if (!rows || rows.length === 0) {
        return '<h2>Error Distribution by API</h2><p>No errors recorded</p>';
    }
    
    return `
<h2>Error Distribution by API</h2>
<table>
<tr><th>API</th><th>Status Code</th><th>Error Count</th><th>Error %</th></tr>
${rows.map(r => `
<tr>
<td>${r.api}</td><td>${r.status}</td><td>${r.count}</td><td>${r.pct}%</td>
</tr>`).join('')}
</table>`;
}

/**
 * Record metrics for API requests (scenario-level and phase-level)
 * @param {Object} metrics - Metrics object returned from initializeMetrics
 * @param {string} api - API name
 * @param {string} scenario - Scenario name
 * @param {number|null} phaseIndex - Index of current phase, or null
 * @param {Object} res - k6 HTTP response object
 */
export function recordMetrics(metrics, api, scenario, phaseIndex, res) {
    // Scenario-level metrics
    if (metrics[scenario]?.[api]) {
        metrics[scenario][api].count.add(1);
        metrics[scenario][api].duration.add(res.timings.duration);
        
        if (res.status >= 400) {
            metrics[scenario][api].failed.add(1);
            const statusMetric = metrics[scenario][api].statusCodes[res.status];
            if (statusMetric) statusMetric.add(1);
        }
    }
    
    // Phase-level metrics
    if (phaseIndex !== null && metrics[scenario]?.phases?.[phaseIndex]?.[api]) {
        metrics[scenario].phases[phaseIndex][api].count.add(1);
        metrics[scenario].phases[phaseIndex][api].duration.add(res.timings.duration);
        
        if (res.status >= 400) {
            metrics[scenario].phases[phaseIndex][api].failed.add(1);
            const statusMetric = metrics[scenario].phases[phaseIndex][api].statusCodes[res.status];
            if (statusMetric) statusMetric.add(1);
        }
    }
}


/**
 * Determine the current phase index based on scenario and elapsed time
 * @param {string} scenarioName - Scenario name
 * @param {Object} scenarioConfig - Scenario configuration
 * @param {number} testStartTime - Timestamp when test started
 * @returns {number|null} phase index, or null if not in any phase
 */
export function getCurrentPhase(scenarioName, scenarioConfig, testStartTime) {
    const config = scenarioConfig[scenarioName];
    if (!config?.phases) return null;
    
    const now = Date.now();
    const elapsedMs = now - testStartTime;
    const elapsedSeconds = elapsedMs / 1000;
    
    const scenarioStartOffset = parseDuration(config.startTime || '0s');
    const scenarioElapsed = elapsedSeconds - scenarioStartOffset;
    
    if (scenarioElapsed < 0) return null; // Scenario hasn't started yet
    
    let cumulativeDuration = 0;
    for (let i = 0; i < config.phases.length; i++) {
        const phaseDuration = parseDuration(config.phases[i].duration);
        if (scenarioElapsed < cumulativeDuration + phaseDuration) {
            return i;
        }
        cumulativeDuration += phaseDuration;
    }
    
    return null; // In graceful shutdown phase
}

/**
 * Convert a duration string (e.g., "10s", "5m") to seconds
 * @param {string} duration
 * @returns {number} seconds
 */
export function parseDuration(duration) {
    if (!duration || duration === '0s') return 0;
    
    let totalSeconds = 0;
    const regex = /(\d+)([smh])/g;
    let match;
    
    while ((match = regex.exec(duration)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2];
        
        switch (unit) {
            case 's': totalSeconds += value; break;
            case 'm': totalSeconds += value * 60; break;
            case 'h': totalSeconds += value * 3600; break;
        }
    }
    
    return totalSeconds;
}

/**
 * Format a Date object into HH:MM:SS
 * @param {Date} date
 * @returns {string} formatted time
 */
export function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour12: false });
}

/* ----------------- Helper: Request with checks ----------------- */
export function makeRequest(
    apiName, 
    url, 
    inputParam, 
    scenarioConfig, 
    metrics, 
    testStartTime, 
    expectedText = null, 
    printErrors = true // flag to control console.error
) {
    const res = http.get(url);

    // k6 built-in checks
    const passed = check(res, {
        'status is 2xx': r => r.status >= 200 && r.status < 300,
        ...(expectedText ? { 'body contains expected text': r => r.body.includes(expectedText) } : {}),
    });

    // Record metrics (phase-aware)
    const scenarioName = exec.scenario.name;
    const currentPhase = getCurrentPhase(scenarioName, scenarioConfig, testStartTime);
    recordMetrics(metrics, apiName, scenarioName, currentPhase, res);

    // Conditional logging only on failures and if flag is true
    if (!passed && printErrors) {
        // Replace newlines and extra spaces to make single-line output
        const bodySingleLine = res.body.replace(/\s+/g, ' ').trim();
        console.error(`API: ${apiName} Status: ${res.status} ${res.status_text} Input: ${inputParam} Body: ${bodySingleLine}`);
    }

    return res;
}

