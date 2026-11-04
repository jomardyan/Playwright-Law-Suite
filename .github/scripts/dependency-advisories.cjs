'use strict';
const { spawnSync } = require('node:child_process');
const { writeFileSync, appendFileSync } = require('node:fs');

function parseInventory(result) {
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) throw new Error(`npm audit did not complete (${result.status ?? result.signal})`);
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error('npm audit did not return valid JSON'); }
  const counts = report.metadata?.vulnerabilities;
  const severities = ['info', 'low', 'moderate', 'high', 'critical'];
  if (report.error || report.auditReportVersion !== 2 || !counts || !report.vulnerabilities ||
      ![...severities, 'total'].every(key => Number.isInteger(counts[key]) && counts[key] >= 0) ||
      severities.reduce((sum, key) => sum + counts[key], 0) !== counts.total ||
      (result.status === 1 && counts.total === 0)) {
    throw new Error('npm audit returned an error or incomplete advisory inventory');
  }
  return report;
}

if (require.main === module) {
  try {
    // Windows needs cmd.exe for npm.cmd; its command is constant, with no user input.
    const windows = process.platform === 'win32';
    const result = spawnSync(windows ? 'npm.cmd audit --json --audit-level=moderate' : 'npm',
      windows ? [] : ['audit', '--json', '--audit-level=moderate'],
      { encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
        shell: windows });
    const report = parseInventory(result);
    writeFileSync('dependency-advisories.json', JSON.stringify(report, null, 2) + '\n');
    const counts = report.metadata.vulnerabilities;
    const message = `Full dependency inventory: ${counts.total} advisories (${counts.critical} critical, ${counts.high} high, ${counts.moderate} moderate, ${counts.low} low, ${counts.info} informational). The following production audit remains a required gate.`;
    console.log((counts.total ? '::warning::' : '') + message);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { parseInventory };
