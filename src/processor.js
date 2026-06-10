const KEYWORD_MAP = {
  'Responsiveness': ['responsiv', 'padding', 'layout', 'font issue', 'calendar gap', 'larger than', 'header layout', 'centralize'],
  'FAQ': ['faq', 'help section'],
  'Payment auth': ['payment auth', 'authorization', 'auth icon', 'auth flow'],
  'Hardcoded': ['hardcoded', 'hardcode'],
  'Navigation': ['navigation', 'navbar', 'back button'],
  'Branding': ['brand', 'theme', 'color of the app', 'favicon'],
  'Banners': ['banner', 'marketing card'],
  'Payment flow': ['payment flow', 'payment selection', 'make a payment', 'deleting payment'],
  'Autopay': ['autopay', 'auto pay'],
};

function detectArea(summary = '') {
  const lower = summary.toLowerCase();
  for (const [area, keywords] of Object.entries(KEYWORD_MAP)) {
    if (keywords.some(kw => lower.includes(kw))) return area;
  }
  return 'Other';
}

function buildSprintMetrics(issues) {
  const s = {
    total: issues.length,
    done: 0, qa: 0, inProgress: 0, pending: 0, toFix: 0, bugCount: 0,
    assignees: {}
  };

  for (const issue of issues) {
    const fields = issue.fields || issue;
    const statusName = (fields.status?.name || fields.status || '').toLowerCase();
    const statusCat = (fields.status?.statusCategory?.key || fields.status_cat || '').toLowerCase();
    const issueType = (fields.issuetype?.name || fields.issuetype || '').toLowerCase();
    const assigneeName = fields.assignee?.displayName || fields.assignee || 'Unassigned';

    if (statusCat === 'done' || statusName.includes('conclu')) s.done++;
    else if (statusName.includes('qa')) s.qa++;
    else if (statusName.includes('andamento')) s.inProgress++;
    else if (statusName.includes('fix')) s.toFix++;
    else s.pending++;

    if (issueType === 'bug') s.bugCount++;

    // Conta apenas issues não-concluídas para refletir carga atual
    const isDone = statusCat === 'done' || statusName.includes('conclu');
    if (!isDone) {
      const shortName = assigneeName.split(' ')[0];
      s.assignees[shortName] = (s.assignees[shortName] || 0) + 1;
    }
  }

  s.assignees = Object.entries(s.assignees)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));

  return s;
}

function buildBugMetrics(bugs) {
  const resolved = [];
  const open = [];

  for (const bug of bugs) {
    const fields = bug.fields || bug;
    const statusCat = (fields.status?.statusCategory?.key || fields.status_cat || '').toLowerCase();
    const isDone = statusCat === 'done' || (fields.status?.name || '').toLowerCase().includes('conclu');

    const normalized = {
      key: bug.key,
      summary: fields.summary || '',
      status: fields.status?.name || fields.status || '',
      status_cat: isDone ? 'done' : 'open',
      created: fields.created || null,
      resolved: fields.resolutiondate || null,
      assignee: fields.assignee?.displayName || fields.assignee || 'Unassigned',
    };

    if (isDone) resolved.push(normalized);
    else open.push(normalized);
  }

  const cycles = resolved
    .filter(b => b.created && b.resolved)
    .map(b => (new Date(b.resolved) - new Date(b.created)) / 86400000);
  const avgCycle = cycles.length
    ? Math.round((cycles.reduce((a, c) => a + c, 0) / cycles.length) * 10) / 10
    : 0;

  const groups = {};
  const allBugs = [...resolved, ...open];
  for (const bug of allBugs) {
    const area = detectArea(bug.summary);
    if (!groups[area]) groups[area] = { area, total: 0, resolved: 0, open: 0 };
    groups[area].total++;
    if (bug.status_cat === 'done') groups[area].resolved++;
    else groups[area].open++;
  }
  const recurrence = Object.values(groups)
    .filter(g => g.total >= 2)
    .sort((a, b) => b.total - a.total);

  const recurrentAreas = new Set(recurrence.map(g => g.area));
  const today = new Date();
  const openBugs = open.slice(0, 15).map(b => ({
    key: b.key,
    summary: b.summary.slice(0, 65),
    status: b.status,
    assignee: b.assignee,
    days: b.created ? Math.round((today - new Date(b.created)) / 86400000) : 0,
    area: detectArea(b.summary),
    recurrent: recurrentAreas.has(detectArea(b.summary)),
  }));

  return {
    bugsMeta: {
      total: allBugs.length,
      resolved: resolved.length,
      open: open.length,
      avgCycle
    },
    recurrence,
    openBugs
  };
}

function processWebhookEvent(event, currentMetrics) {
  const issue = event.issue;
  if (!issue) return currentMetrics;

  const fields = issue.fields;
  const issueType = (fields.issuetype?.name || '').toLowerCase();
  const statusCat = fields.status?.statusCategory?.key || '';
  const inSprint = Array.isArray(fields.sprint)
    ? fields.sprint.some(s => s.state === 'active')
    : fields.sprint?.state === 'active';

  let allBugs = currentMetrics.allBugs || [];

  if (issueType === 'bug') {
    const idx = allBugs.findIndex(b => b.key === issue.key);
    const normalized = {
      key: issue.key,
      summary: fields.summary || '',
      status: fields.status?.name || '',
      status_cat: statusCat === 'done' ? 'done' : 'open',
      created: fields.created || null,
      resolved: fields.resolutiondate || null,
      assignee: fields.assignee?.displayName || 'Unassigned',
    };

    if (idx >= 0) allBugs[idx] = normalized;
    else allBugs.push(normalized);
  }

  const { bugsMeta, recurrence, openBugs } = buildBugMetrics(allBugs);

  const sprint = currentMetrics.sprint;
  if (inSprint) {
    sprint._stale = true;
  }

  return {
    lastUpdated: new Date().toISOString(),
    sprint,
    bugsMeta,
    recurrence,
    openBugs,
    allBugs,
  };
}

// Bugs abertos na sprint atual com detecção de retorno ao To Fix via changelog
function buildSprintOpenBugs(issues) {
  const today = new Date();

  return issues
    .filter(issue => {
      const fields = issue.fields || issue;
      const type = (fields.issuetype?.name || '').toLowerCase();
      const statusCat = (fields.status?.statusCategory?.key || '').toLowerCase();
      return type === 'bug' && statusCat !== 'done';
    })
    .map(issue => {
      const fields = issue.fields || issue;
      const histories = issue.changelog?.histories || [];

      // Conta quantas vezes voltou para "To Fix"
      let toFixCount = 0;
      for (const h of histories) {
        for (const item of (h.items || [])) {
          if (item.field === 'status' && (item.toString || '').toLowerCase().includes('fix')) {
            toFixCount++;
          }
        }
      }

      const area = detectArea(fields.summary || '');
      return {
        key: issue.key,
        summary: (fields.summary || '').slice(0, 65),
        status: fields.status?.name || '',
        assignee: fields.assignee?.displayName || 'Unassigned',
        days: fields.created ? Math.round((today - new Date(fields.created)) / 86400000) : 0,
        area,
        toFixCount,
        recurrent: toFixCount >= 1,
      };
    })
    .sort((a, b) => b.days - a.days)
    .slice(0, 15);
}

// Calcula tempo médio gasto em cada status com base no changelog das issues
// Só exibe steps de statuses que atualmente têm pelo menos uma issue aberta na sprint
function buildCycleMetrics(issues) {
  const statusTimes = {};

  // Coleta statuses atualmente ocupados por issues abertas
  const activeStatuses = new Set();
  for (const issue of issues) {
    const fields = issue.fields || issue;
    const statusCat = (fields.status?.statusCategory?.key || '').toLowerCase();
    const statusName = (fields.status?.name || '').toLowerCase();
    const isDone = statusCat === 'done' || statusName.includes('conclu');
    if (!isDone) {
      activeStatuses.add(fields.status?.name || '');
    }
  }

  for (const issue of issues) {
    const fields = issue.fields || issue;
    const histories = issue.changelog?.histories || [];

    const transitions = [];
    for (const h of histories) {
      for (const item of (h.items || [])) {
        if (item.field === 'status') {
          transitions.push({ date: new Date(h.created), from: item.fromString, to: item.toString });
        }
      }
    }
    transitions.sort((a, b) => a.date - b.date);

    let prevDate = new Date(fields.created || Date.now());
    for (const t of transitions) {
      const days = (t.date - prevDate) / 86400000;
      if (t.from && days >= 0) {
        if (!statusTimes[t.from]) statusTimes[t.from] = [];
        statusTimes[t.from].push(days);
      }
      prevDate = t.date;
    }
  }

  const IGNORED = ['backlog', 'to do', 'open', 'concluído', 'done', 'closed'];
  const steps = Object.entries(statusTimes)
    .filter(([status]) => activeStatuses.has(status))
    .map(([status, times]) => ({
      status,
      avgDays: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10,
      count: times.length,
    }))
    .filter(s => s.avgDays > 0 && s.count >= 1 && !IGNORED.some(i => s.status.toLowerCase().includes(i)))
    .sort((a, b) => b.avgDays - a.avgDays);

  return { steps };
}

// Retorna todas as issues não-concluídas da sprint para exibição na tabela completa
function buildOpenIssues(issues) {
  const today = new Date();
  return issues
    .filter(issue => {
      const fields = issue.fields || issue;
      const statusCat = (fields.status?.statusCategory?.key || '').toLowerCase();
      return statusCat !== 'done';
    })
    .map(issue => {
      const fields = issue.fields || issue;
      return {
        key: issue.key,
        summary: (fields.summary || '').slice(0, 70),
        status: fields.status?.name || '',
        type: fields.issuetype?.name || 'Task',
        assignee: fields.assignee?.displayName || 'Unassigned',
        days: fields.created ? Math.round((today - new Date(fields.created)) / 86400000) : 0,
      };
    });
}

module.exports = { buildSprintMetrics, buildBugMetrics, buildOpenIssues, buildSprintOpenBugs, buildCycleMetrics, processWebhookEvent, detectArea };
