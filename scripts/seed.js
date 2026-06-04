// Popula data/metrics.json com o estado atual do Jira.
// Executar uma vez na primeira configuração:  node scripts/seed.js
require('dotenv').config();
const { runSeed } = require('../src/seed');

runSeed().catch(err => {
  console.error('❌ Erro no seed:', err.message);
  process.exit(1);
});
