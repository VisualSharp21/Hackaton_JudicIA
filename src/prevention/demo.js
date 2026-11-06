import { normalizeHearing, MINUTE } from './agenda.js';

// Transactional and tenant-local. Repeated runtime ticks never duplicate a cycle.
export async function ensureDemoAgenda(services, enabled = false) {
  if (!enabled) return false;
  const { store, agenda, clock } = services;
  return store.transaction(async (tx) => {
    const now = clock();
    const marker = await tx.get('settings', 'preventive-demo');
    if (marker && marker.expiresAt > now) return false;
    const scenarios = ['ready', 'critical', 'network', 'offline', 'recoverable'];
    const offsets = [8, 22, 45, 90, 180, -90, -150];
    for (let i = 0; i < offsets.length; i++) {
      const stationId = `DEMO-SALA-${i % 5 + 1}`;
      const existing = await tx.get('station', stationId);
      if (existing && existing.mode !== 'DEMO') throw new Error('DEMO_STATION_COLLISION');
      await tx.put('station', { id: stationId, mode: 'DEMO', locality: 'Comarca DEMO', demoScenario: scenarios[i % 5], authorizedActions: [], authorizedDeviceIds: [] });
      const h = await agenda.saveInTransaction(tx, normalizeHearing({
        label: ['Sessão preparada', 'Microfone com falha', 'Latência elevada', 'Estação indisponível', 'Áudio com precedente'][i % 5],
        type: 'Audiência de instrução DEMO', department: 'Vara demonstrativa', conferenceUrl: `https://video.example.invalid/demo/sala-${i % 5 + 1}`,
        locality: 'Comarca DEMO', stationId, room: `Sala ${i % 5 + 1}`, responsible: 'Equipe fictícia DEMO',
        startsAt: new Date(now + offsets[i] * MINUTE).toISOString(), durationMinutes: 30, mode: 'DEMO', devices: ['Câmera sintética', 'Microfone sintético'],
      }), 'demo-runtime', null);
      if (offsets[i] < 0) {
        h.lifecycle = 'CONCLUÍDA'; h.state = 'CONCLUÍDA'; await tx.put('hearing', h);
        const j = await tx.get('job', `${h.id}:1`); j.status = 'DONE'; j.nextAt = null; await tx.put('job', j);
        await tx.audit(h.id, 'DEMO_HISTORY', 'demo-runtime', { evidence: 'Sessão histórica sintética concluída.' }, now);
      }
    }
    await tx.put('knowledge', { id: 'DEMO:AUDIO-001', ticketId: 'DEMO-001', solutionId: 'DEMO-SOLUTION-001',
      source: 'MEMÓRIA DEMO — GLPI simulado', mode: 'DEMO', validation: 'VALIDATED', status: 'INDEXED',
      title: 'Microfone desabilitado', problem: 'Dispositivo de áudio desabilitado; microfone sem captura.',
      solution: 'Verificar dispositivo e reativar somente o áudio desabilitado autorizado; repetir teste funcional.',
      successEvidence: 'SIMULAÇÃO DEMO: captura de áudio aprovada após reativação.', validatedAt: new Date(now).toISOString(),
      metadata: { locality: 'Comarca DEMO', category: 'audio' } });
    await tx.put('settings', { id: 'preventive-demo', startedAt: now, expiresAt: now + 210 * MINUTE });
    return true;
  });
}
