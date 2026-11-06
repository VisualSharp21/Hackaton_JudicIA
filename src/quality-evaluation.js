import { classifyWithProvider } from './decision-provider.js';
import {
  evaluationCases,
  getFeedbackEvaluationReport,
  getTriageQuestionSettings,
  getTriageConfiguration,
  saveFeedbackEvaluationReport,
} from './repository.js';
import { calibrateDecision } from './triage.js';

const evaluatedFields = [
  'supportRequest',
  'category',
  'system',
  'impact',
  'urgency',
  'possibleIncident',
  'outage',
  'status',
];

function actualLabels(decision) {
  return {
    supportRequest: decision.isSupportRequest,
    category: decision.category,
    system: decision.system,
    impact: decision.impact,
    urgency: decision.urgency,
    possibleIncident: decision.possibleIncident,
    outage: decision.outage,
  };
}

function feedbackCaseFingerprint(item) {
  return JSON.stringify([item.text, item.expected || {}]);
}

export async function evaluateSavedFeedbackCases() {
  const cases = evaluationCases();
  if (!cases.length) throw new Error('Salve pelo menos um caso revisado antes de avaliar.');

  const previousOutcomes = getFeedbackEvaluationReport()?.cases || [];
  const outcomesById = new Map(
    previousOutcomes
      .filter((item) => item.evaluationCaseId)
      .map((item) => [String(item.evaluationCaseId), item]),
  );
  const pending = cases.filter(
    (item) => {
      const previous = outcomesById.get(String(item.id));
      return (
        previous?.status !== 'evaluated' ||
        previous.fingerprint !== feedbackCaseFingerprint(item)
      );
    },
  );
  if (pending.length > 100)
    throw new Error('A avaliação pela tela aceita até 100 casos por execução.');

  const triageConfig = getTriageConfiguration();
  const questions = triageConfig.questions;
  for (const item of pending) {
    const caseNumber = cases.findIndex((candidate) => String(candidate.id) === String(item.id)) + 1;
    try {
      const evaluated = await classifyWithProvider(item.text, questions, triageConfig);
      const decision = calibrateDecision(item.text, evaluated.decision, triageConfig.calibrationRules, Object.keys(questions.category.criteria), Object.keys(questions.system.criteria));
      const actual = actualLabels(decision);
      const expected = item.expected || {};
      const compared = evaluatedFields.filter((field) => Object.hasOwn(expected, field));
      const mismatches = compared.filter((field) => expected[field] !== actual[field]);
      outcomesById.set(String(item.id), {
        evaluationCaseId: item.id,
        fingerprint: feedbackCaseFingerprint(item),
        caseNumber,
        status: 'evaluated',
        provider: evaluated.provider,
        expected: Object.fromEntries(compared.map((field) => [field, expected[field]])),
        actual: Object.fromEntries(compared.map((field) => [field, actual[field]])),
        mismatches,
      });
    } catch (error) {
      outcomesById.set(String(item.id), {
        evaluationCaseId: item.id,
        fingerprint: feedbackCaseFingerprint(item),
        caseNumber,
        status: 'error',
        error: error.message || 'Falha ao avaliar este caso.',
      });
    }
  }

  const outcomes = cases
    .map((item, index) => {
      const result = outcomesById.get(String(item.id));
      return result ? { ...result, caseNumber: index + 1 } : null;
    })
    .filter(Boolean);
  const fields = Object.fromEntries(
    evaluatedFields.map((field) => [field, { correct: 0, total: 0, accuracy: null }]),
  );
  for (const outcome of outcomes.filter((item) => item.status === 'evaluated'))
    for (const field of Object.keys(outcome.expected || {})) {
      fields[field].total++;
      if (!(outcome.mismatches || []).includes(field)) fields[field].correct++;
    }
  for (const result of Object.values(fields))
    result.accuracy = result.total ? Math.round((result.correct / result.total) * 100) : null;

  const evaluatedCount = outcomes.filter((item) => item.status === 'evaluated').length;
  const failedCount = outcomes.filter((item) => item.status === 'error').length;
  const exactMatchCount = outcomes.filter(
    (item) => item.status === 'evaluated' && item.mismatches.length === 0,
  ).length;
  const providers = [
    ...new Set(
      outcomes.filter((item) => item.status === 'evaluated').map((item) => item.provider),
    ),
  ];
  const report = {
    evaluatedAt: new Date().toISOString(),
    status: failedCount === 0 ? 'completed' : evaluatedCount === 0 ? 'failed' : 'partial',
    totalCases: cases.length,
    evaluatedCount,
    failedCount,
    exactMatchCount,
    pendingCount: pending.length,
    providers,
    fields,
    cases: outcomes,
  };

  return saveFeedbackEvaluationReport(report);
}
