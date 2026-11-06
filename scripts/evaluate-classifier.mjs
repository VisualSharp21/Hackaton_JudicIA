import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTriageQuestionSettings } from '../src/repository.js';
import {
  decisionFromAnswers,
  evaluationRequest,
  statusForDescription,
  calibrateDecision,
  applyAutomationGate,
  calculatePriority,
  routeQueue,
} from '../src/triage.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs
    .readFileSync(envPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]])
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const endpoint = process.env.JEVMODEL_BASE_URL || 'http://127.0.0.1:8000/v1/systemone';
const model = process.env.JEVMODEL_NAME || 'multilingual';
const questions = getTriageQuestionSettings();
const baseCases = JSON.parse(fs.readFileSync(path.join(root, 'evaluation', 'cases.json'), 'utf8'));
const feedbackPath = path.join(root, 'evaluation', 'feedback.local.json');
const feedbackCases = fs.existsSync(feedbackPath)
  ? JSON.parse(fs.readFileSync(feedbackPath, 'utf8'))
  : [];
const baseThresholds = {
  minimumCases: 50,
  supportPrecision: 0.95,
  supportRecall: 0.95,
  outOfScopeRecall: 0.95,
  categoryAccuracy: 0.9,
  incidentRecall: 0.9,
};
const benchmarkMeta = JSON.parse(
  fs.readFileSync(path.join(root, 'evaluation', 'benchmark-meta.json'), 'utf8'),
);

function ratio(n, d) {
  return d ? n / d : null;
}
function scoreField(cases, report, field, predicate) {
  let tp = 0,
    fp = 0,
    fn = 0;
  for (const item of cases) {
    if (!(field in item.expected)) continue;
    const expected = item.expected[field];
    const actualPositive =
      field === 'supportRequest'
        ? report._actual.get(item.id)?.supportRequest
        : report._actual.get(item.id)?.[field];
    if (predicate(expected) && predicate(actualPositive)) tp++;
    else if (!predicate(expected) && predicate(actualPositive)) fp++;
    else if (predicate(expected) && !predicate(actualPositive)) fn++;
  }
  return { precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
}

// Keep the baseline report independent from feedback cases so corrected examples never inflate its score.
async function runSuite(cases, label) {
  const fields = [
    'supportRequest',
    'category',
    'system',
    'impact',
    'urgency',
    'possibleIncident',
    'outage',
    'status',
  ];
  const report = Object.fromEntries(
    fields.map((field) => [field, { correct: 0, total: 0, confusion: {} }]),
  );
  const outcomes = new Map();
  for (const item of cases) {
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.JEVMODEL_API_KEY)
      headers.Authorization = `Bearer ${process.env.JEVMODEL_API_KEY}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(evaluationRequest(item.text, model, questions)),
      signal: AbortSignal.timeout(120000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        `Caso ${item.id}: HTTP ${response.status} ${result?.detail?.[0]?.msg || result?.error?.message || ''}`,
      );
    const decision = calibrateDecision(item.text, decisionFromAnswers(result.answers || {}));
    const triage = applyAutomationGate(
      { triageStatus: statusForDescription(item.text, decision) },
      false,
    );
    const actual = {
      ...decision,
      supportRequest: decision.isSupportRequest,
      status: triage.triageStatus,
      priority: calculatePriority(decision),
      queue: routeQueue(decision),
    };
    outcomes.set(item.id, actual);
    for (const field of fields) {
      if (!(field in item.expected)) continue;
      const expected = item.expected[field],
        got = actual[field],
        stats = report[field];
      stats.total++;
      if (got === expected) stats.correct++;
      else (stats.mismatches ||= []).push({ id: item.id, expected, got });
      const key = `${String(expected)} → ${String(got)}`;
      stats.confusion[key] = (stats.confusion[key] || 0) + 1;
    }
    console.log(
      `${label}/${item.id} | confiança=${decision.confidence.toFixed(2)} | fila=${actual.queue}`,
    );
  }
  report._actual = outcomes;
  return report;
}

const baseline = await runSuite(baseCases, 'benchmark');
console.log('\nResultado do conjunto-base (desenvolvimento):');
for (const [field, stats] of Object.entries(baseline)) {
  if (field.startsWith('_') || !stats.total) continue;
  console.log(
    `- ${field}: ${stats.correct}/${stats.total} (${Math.round((stats.correct / stats.total) * 100)}%)`,
  );
  if (stats.mismatches?.length)
    console.log(
      `  erros: ${stats.mismatches.map((item) => `${item.id} ${String(item.expected)} → ${String(item.got)}`).join('; ')}`,
    );
}

const support = scoreField(baseCases, baseline, 'supportRequest', Boolean);
const outOfScope = scoreField(baseCases, baseline, 'supportRequest', (value) => !value);
const incident = scoreField(baseCases, baseline, 'possibleIncident', Boolean);
const category = baseline.category;
const checks = [
  [
    'mínimo de casos',
    baseCases.length >= baseThresholds.minimumCases,
    `${baseCases.length}/${baseThresholds.minimumCases}`,
  ],
  [
    'precisão de solicitações TIC',
    support.precision != null && support.precision >= baseThresholds.supportPrecision,
    support.precision == null
      ? 'sem amostras'
      : `${Math.round(support.precision * 100)}% (meta 95%)`,
  ],
  [
    'revocação de solicitações TIC',
    support.recall != null && support.recall >= baseThresholds.supportRecall,
    support.recall == null ? 'sem amostras' : `${Math.round(support.recall * 100)}% (meta 95%)`,
  ],
  [
    'revocação fora do escopo',
    outOfScope.recall != null && outOfScope.recall >= baseThresholds.outOfScopeRecall,
    outOfScope.recall == null
      ? 'sem amostras'
      : `${Math.round(outOfScope.recall * 100)}% (meta 95%)`,
  ],
  [
    'acurácia de categoria',
    ratio(category.correct, category.total) != null &&
      ratio(category.correct, category.total) >= baseThresholds.categoryAccuracy,
    category.total
      ? `${Math.round((category.correct / category.total) * 100)}% (meta 90%)`
      : 'sem amostras',
  ],
  [
    'revocação de incidentes',
    incident.recall != null && incident.recall >= baseThresholds.incidentRecall,
    incident.recall == null ? 'sem amostras' : `${Math.round(incident.recall * 100)}% (meta 90%)`,
  ],
  [
    'revisão por especialista de suporte',
    benchmarkMeta.domainReviewed === true,
    benchmarkMeta.domainReviewed === true
      ? 'registrada'
      : 'pendente; casos-base ainda precisam validação humana',
  ],
];
console.log('\nCritérios de liberação de automação:');
for (const [name, passed, value] of checks)
  console.log(`${passed ? 'APROVADO' : 'PENDENTE'} ${name}: ${value}`);
console.log(
  `\nLiberação: ${checks.every(([, passed]) => passed) ? 'PRONTA PARA AVALIAÇÃO CONTROLADA' : 'NÃO LIBERAR AUTOMATIZAÇÃO; manter revisão humana.'}`,
);
console.log(
  `Casos de feedback corrigidos disponíveis: ${feedbackCases.length}. Eles são avaliados separadamente e ficam separados do conjunto-base.`,
);
console.log(`Endpoint: ${endpoint} · Modelo: ${model}`);
console.log('Instruções e critérios: configuração salva na tela de triagem.');

if (feedbackCases.length) {
  const feedback = await runSuite(feedbackCases, 'feedback');
  console.log('\nConcordância no conjunto de feedback (não independente):');
  for (const [field, stats] of Object.entries(feedback))
    if (!field.startsWith('_') && stats.total)
      console.log(
        `- ${field}: ${stats.correct}/${stats.total} (${Math.round((stats.correct / stats.total) * 100)}%)`,
      );
}
