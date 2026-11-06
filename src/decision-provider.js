import { randomUUID } from 'node:crypto';
import {
  assessDecision,
  decisionFromAnswers,
  evaluationRequest,
  fallbackClassification,
} from './triage.js';

export async function classifyWithProvider(description, questions, policy = {}) {
  const apiKey = process.env.JEVMODEL_API_KEY || '';
  const baseUrl = process.env.JEVMODEL_BASE_URL || '';
  if (!apiKey && !baseUrl) return fallbackClassification(description, policy.calibrationRules, policy.thresholds);

  const isLaya = /localhost:8000|127\.0\.0\.1:8000/.test(baseUrl);
  const model = process.env.JEVMODEL_NAME || (isLaya ? 'multilingual' : 'jev-latest');
  const request = evaluationRequest(description, model, questions, policy.payloadTemplate);
  const headers = { 'Content-Type': 'application/json' };

  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (!isLaya) headers['Idempotency-Key'] = `pulso-${randomUUID()}`;

  let response;
  try {
    response = await fetch(baseUrl || 'https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    if (isLaya || !apiKey) {
      console.warn(`[Pulso TIC] Provedor de decisão offline (${error.message}). Usando classificador local de contingência.`);
      return fallbackClassification(description, policy.calibrationRules, policy.thresholds);
    }
    throw new Error(`Decision service unavailable: ${error.message}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      data?.detail?.[0]?.msg ||
        data?.error?.message ||
        `Decision service returned HTTP ${response.status}`,
    );
  }

  const decision = decisionFromAnswers(data.answers || {}, policy.calibrationRules, policy.systemOptionMappings, policy.categoryOptionMappings, questions);
  decision.jevUsage = data.usage || null;
  const provider = isLaya ? 'laya' : 'jev';

  return {
    decision,
    modelChoices: {
      category: String(data.answers?.category?.choice || "").toUpperCase() || null,
      system: String(data.answers?.system?.choice || "").toUpperCase() || null,
    },
    provider: `${provider}:${data.routing?.model || data.model || model}`,
    ...assessDecision(decision),
  };
}
