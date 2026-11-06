import fs from 'node:fs';
import path from 'node:path';
import { classifyWithProvider } from '../src/decision-provider.js';
import { decisionQuestions, routeQueue, calculatePriority } from '../src/triage.js';

try { process.loadEnvFile(); } catch {}
const DATASET = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../data/copilot-dataset');

const jsonPath = path.join(DATASET, 'chamados-brutos.json');
const chamados = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

console.log(`Iniciando classificação dos ${chamados.length} chamados com Laya/Provedor de Decisão...\n`);

const classificados = [];
const outputDir = path.join(DATASET, 'chamados-classificados');
fs.mkdirSync(outputDir, { recursive: true });

for (let i = 0; i < chamados.length; i++) {
  const c = chamados[i];
  process.stdout.write(`[${i + 1}/${chamados.length}] Classificando ${c.id}: "${c.titulo.substring(0, 40)}..." `);
  
  try {
    const result = await classifyWithProvider(c.relato, decisionQuestions);
    const d = result.decision;
    const fila = routeQueue(d);
    const prioridade = calculatePriority(d);

    const classificacao = {
      provedor: result.provider,
      categoria: d.category,
      sistema: d.system,
      impacto: d.impact,
      urgencia: d.urgency,
      prioridade_calculada: prioridade,
      possivel_incidente: d.possibleIncident,
      indisponibilidade: d.outage,
      requer_humano: d.humanRequired,
      confianca_geral: Math.round((d.confidence ?? 0) * 100) + '%',
      fila_sugerida: fila,
      status_triagem: result.triageStatus
    };

    const chamadoCompleto = {
      ...c,
      classificacao
    };

    classificados.push(chamadoCompleto);
    console.log(`-> ${d.category} | ${d.system} | Prioridade: ${prioridade} (${fila})`);

    // Atualizar Markdown
    const numStr = String(i + 1).padStart(3, '0');
    const mdContent = `# Chamado: ${c.id}

## Informações do Solicitante e Estação
- **Identificador do Chamado:** ${c.id}
- **Título Relatado:** ${c.titulo}
- **Computador Vinculado:** ${c.computador.nome} (${c.computador.modelo})
- **Patrimônio:** ${c.computador.patrimonio} | **Serial:** ${c.computador.serial}
- **Sistema Operacional:** ${c.computador.sistema_operacional}
- **Localização:** ${c.computador.unidade} — Setor: ${c.computador.setor}
- **Usuário Solicitante:** ${c.computador.responsavel_ficticio}
- **Endereço de Rede:** IP ${c.computador.ip} | MAC ${c.computador.mac}

---

## Relato do Usuário (Texto Bruto)
> "${c.relato}"

---

## Contexto Adicional do Atendimento
${Object.entries(c.detalhes_contexto).map(([k, v]) => `- **${k}:** ${v}`).join('\n')}

---

## Classificação do Laya (Provedor de Decisão)
- **Status da Triagem:** ${classificacao.status_triagem}
- **Provedor Utilizado:** ${classificacao.provedor}
- **Categoria Técnica:** \`${classificacao.categoria}\`
- **Sistema Alvo:** \`${classificacao.sistema}\`
- **Nível de Urgência:** \`${classificacao.urgencia}\`
- **Nível de Impacto:** \`${classificacao.impacto}\`
- **Prioridade Calculada:** \`${classificacao.prioridade_calculada}\`
- **Fila de Destino:** \`${classificacao.fila_sugerida}\`
- **Indício de Incidente Coletivo:** ${classificacao.possivel_incidente ? 'SIM 🚨' : 'Não'}
- **Indisponibilidade Declarada:** ${classificacao.indisponibilidade ? 'SIM ⚠️' : 'Não'}
- **Confiança do Modelo:** ${classificacao.confianca_geral}
`;

    fs.writeFileSync(path.join(outputDir, `CHAM-${numStr}.md`), mdContent, 'utf-8');

  } catch (err) {
    console.log(`-> ERRO: ${err.message}`);
  }
}

fs.writeFileSync(
  path.join(DATASET, 'chamados-classificados.json'),
  JSON.stringify(classificados, null, 2),
  'utf-8'
);

console.log(`\nProcessamento finalizado com sucesso!
Arquivos classificados salvos em:
- ${outputDir}
- data/copilot-dataset/chamados-classificados.json`);
