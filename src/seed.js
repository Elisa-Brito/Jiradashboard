const https = require('https');
const store = require('./store');
const { buildSprintMetrics, buildBugMetrics } = require('./processor');

const CLOUD_ID = '8727a4ee-ae24-46f3-9330-a06732d0b2dd';
const BASE_URL = `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3`;

function jiraRequest(jql, fields) {
  const token = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  const url = `${BASE_URL}/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=100`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'Authorization': `Basic ${token}`, 'Accept': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errorMessages?.length) reject(new Error(parsed.errorMessages.join(', ')));
          else resolve(parsed);
        } catch (e) {
          reject(new Error('Resposta inválida do Jira: ' + data.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
  });
}

async function runSeed() {
  if (!process.env.JIRA_EMAIL || !process.env.JIRA_API_TOKEN) {
    console.log('[Seed] JIRA_EMAIL ou JIRA_API_TOKEN não configurados — seed ignorado');
    return;
  }

  console.log('[Seed] Buscando dados do Jira...');

  const [sprintData, bugData] = await Promise.all([
    jiraRequest('project = "IrisLoan - V2" AND sprint in openSprints()', 'summary,status,issuetype,assignee'),
    jiraRequest('project = "IrisLoan - V2" AND issuetype = Bug ORDER BY created ASC', 'summary,status,created,resolutiondate,assignee'),
  ]);

  const sprint = buildSprintMetrics(sprintData.issues || []);
  const { bugsMeta, recurrence, openBugs } = buildBugMetrics(bugData.issues || []);

  const metrics = {
    lastUpdated: new Date().toISOString(),
    sprint,
    bugsMeta,
    recurrence,
    openBugs,
    allBugs: (bugData.issues || []).map(i => ({
      key: i.key,
      summary: i.fields.summary,
      status: i.fields.status?.name,
      status_cat: i.fields.status?.statusCategory?.key === 'done' ? 'done' : 'open',
      created: i.fields.created,
      resolved: i.fields.resolutiondate,
      assignee: i.fields.assignee?.displayName || 'Unassigned',
    }))
  };

  store.write(metrics);
  console.log(`[Seed] ✅ Sprint: ${sprint.total} issues | Bugs: ${bugsMeta.total} total, ${bugsMeta.open} abertos`);
}

module.exports = { runSeed };
