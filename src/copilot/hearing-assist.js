/**
 * Orientação do Copilot para uma audiência da Central (rota POST /api/hearings/:id/assist).
 *
 * Usa o mesmo motor do Copilot Nível 1 (configuração do tenant ou .env). Sem LLM configurada,
 * em sessões DEMO ou se a LLM falhar, responde com regras locais a partir das falhas e dos
 * precedentes já encontrados. O motor usado vai para a auditoria, não para o texto do usuário.
 */
import { chatCompletion } from './llm-client.js';
import { effectiveLlmConfig } from './settings.js';

const COMPONENT_HINTS = {
  microphone: 'Confira se o microfone certo está selecionado no Meet e no Windows, se não está mudo no headset e se outro programa não está usando o dispositivo.',
  microphone_functional: 'Confira se o microfone certo está selecionado no Meet e no Windows, se não está mudo no headset e se outro programa não está usando o dispositivo.',
  camera: 'Feche outros programas que usam a câmera, confira a permissão do navegador e reconecte o cabo USB.',
  camera_functional: 'Feche outros programas que usam a câmera, confira a permissão do navegador e reconecte o cabo USB.',
  capture: 'Feche outros programas que usam câmera ou microfone, confira a permissão do navegador e repita o teste.',
  playback_configuration: 'Confira se a saída de áudio certa (caixa de som ou headset) está selecionada e com volume.',
  station_tcp: 'Teste outro site, confira o cabo de rede ou o Wi-Fi e, se outras salas da comarca também falharem, trate como problema coletivo.',
  zabbix_availability: 'O monitoramento indica a estação ou o link fora do ar: avise a TIC e prepare a contingência.',
  zabbix_latency: 'Feche downloads e chamadas paralelas; se a latência continuar alta, avise a TIC sobre o link da comarca.',
  zabbix_loss: 'Perda de pacotes costuma ser do link: avise a TIC e tenha a contingência pronta (sala alternativa ou áudio por telefone).',
};

// O resumo da audiência, a falha e o precedente já vêm antes desta resposta (prevention/routes.js);
// aqui entram só os próximos passos, para não repetir informação.
function rulesGuidance({ failures, remainingMinutes }) {
  const lines = [];
  if (!failures.length) {
    lines.push('Próximo passo: perto do horário, entre na sala do Meet e confirme câmera, microfone e som antes de chamar as partes.');
  } else {
    lines.push('Próximos passos sugeridos:');
    const seen = new Set();
    failures.forEach((f) => {
      const hint = COMPONENT_HINTS[f.name] || 'Verifique o componente indicado e repita o teste.';
      if (!seen.has(hint)) { seen.add(hint); lines.push(`${seen.size}. ${hint}`); }
    });
  }
  if (Number.isFinite(remainingMinutes) && remainingMinutes <= 15 && failures.length)
    lines.push('Faltam poucos minutos: acione a TIC agora e prepare a contingência.');
  return lines.join('\n');
}

export async function hearingGuidance({ message, hearing, context, history = [], demoOnly = false }) {
  const failures = context.failures || [];
  const fallback = () => rulesGuidance({ failures, remainingMinutes: context.remainingMinutes });
  const config = effectiveLlmConfig();
  if (demoOnly || hearing.mode === 'DEMO' || !config.configured) {
    return { reply: fallback(), provider: 'local_rules', generative: false, integrationError: null };
  }
  try {
    const system = [
      'Você é o Copilot da Central de Audiências do Pulso TIC.',
      'Oriente, em português e em passos curtos, quem vai conduzir uma audiência por videoconferência.',
      'Use somente as evidências do contexto. Não invente medições, causas nem previsão de normalização.',
      'Se faltar pouco tempo ou houver ocorrência coletiva, diga para acionar a TIC e usar a contingência.',
    ].join(' ');
    const result = await chatCompletion(config, {
      messages: [
        { role: 'system', content: system },
        ...history.slice(-8).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
        { role: 'user', content: message },
      ],
      maxTokens: 600,
    });
    const reply = String(result.text || '').trim();
    if (!reply) throw new Error('Resposta vazia da LLM.');
    return { reply, provider: config.provider, model: result.model, generative: true, integrationError: null };
  } catch (error) {
    if (!config.fallbackRules) throw Object.assign(new Error('O Copilot está indisponível no momento.'), { status: 503 });
    return { reply: fallback(), provider: 'local_rules', generative: false, integrationError: error.message };
  }
}
