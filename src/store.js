const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const FILE = path.join(DATA_DIR, 'metrics.json');

const DEFAULT_METRICS = {
  lastUpdated: null,
  sprint: { total: 0, done: 0, qa: 0, inProgress: 0, pending: 0, toFix: 0, bugCount: 0, assignees: [] },
  bugsMeta: { total: 0, resolved: 0, open: 0, avgCycle: 0 },
  recurrence: [],
  openBugs: [],
  openIssues: [],
  cycleMetrics: { steps: [] },
  allBugs: []
};

function read() {
  try {
    if (!fs.existsSync(FILE)) return DEFAULT_METRICS;
    return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  } catch {
    return DEFAULT_METRICS;
  }
}

function write(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = { read, write };
