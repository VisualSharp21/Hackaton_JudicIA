# Copilot Nível 1 de TIC — arquitetura e operação

Implementação de [PROMPT_COPILOT_IMPLEMENTACAO.md](PROMPT_COPILOT_IMPLEMENTACAO.md). Tudo roda no servidor central; o navegador do solicitante só recebe a conversa e os cartões.

```text
navegador (Central de Atendimento)                servidor central (Node.js)
┌──────────────────────────────┐   POST /api/copilot/chat   ┌─────────────────────────────────────────────┐
│ chip "Estação atual"          │ ─────────────────────────▶ │ routes.js ─▶ agent.js                       │
│ chat + cartões (Laya,         │                            │   ├─ Laya (decision-provider) ┐ em paralelo │
│ solução, precedente, Meet)    │ ◀───────────────────────── │   ├─ RAG de precedentes       ┘             │
│ teste de audiência (WebRTC)   │   turno: resposta + cartões│   ├─ policy.js (regras operacionais)        │
│ [Consegui resolver] [Chamado] │                            │   ├─ base procedural no SO da estação       │
└──────────────────────────────┘                            │   ├─ tools.js (Tool Registry)               │
                                                             │   └─ llm-client.js ─▶ LLM plugável          │
                                                             │        (fallback: motor de regras local)    │
                                                             │ sessions.js ─▶ MariaDB do tenant            │
                                                             │ escalation.js ─▶ GLPI 11 (API v2) ou mock   │
                                                             └─────────────────────────────────────────────┘
```

## Do spec ao código

| Passo do spec | Onde está |
| --- | --- |
| 1. Seleção e reconhecimento da estação | `GET /api/copilot/machines` (catálogo + inventário GLPI + perfil do setor), detecção por IP e DNS reverso em `data-loader.js › detectStation`, chip e ficha em `public/pages/copilot-chat.js`; o pré-diagnóstico identifica a estação pelo nome do computador |
| 2. Conversa e classificação em tempo real | `agent.js › runCopilotTurn`: Laya (`classifyWithProvider` + calibração + portão de automação) em paralelo com `searchPrecedents` |
| 3. Resolução recomendada universal | `searchKnowledge` escolhe o sintoma em `hermes-memory/conhecimento/*.md` e a variante do SO (`stepsForOs`); sem match, o roteiro geral |
| 4. Ferramenta de audiência | `tools.js › run_meet_check` (gatilho: link do Meet, menção a audiência ou estação de sala de audiência); teste no navegador em `public/js/meet-diagnostics.js`; laudo validado e reavaliado em `meet-report.js` |
| 5. Feedback e autoatendimento | `POST /api/copilot/resolve` (requests + service_events) e `POST /api/copilot/feedback` (nota 1–5) |
| 6. Escalação enriquecida | `POST /api/copilot/escalate` → `escalation.js`: título `[Setor] Problema - Estação LAB-PJE-XXX`, corpo com máquina, triagem, fila/ID GLPI, laudo e procedimentos tentados; protocolo devolvido na hora |

Regras operacionais aplicadas sobre o Laya (`hermes-memory/core/regras-operacionais.md`), sempre listadas no chat e no chamado:

- audiência em andamento ou em até 15 minutos ➔ urgência e prioridade **CRÍTICA**;
- queda de rede afetando mais de uma pessoa ➔ possível incidente coletivo, fila `SUPORTE_REDE`;
- falha física de hardware (não liga, sem sinal de vídeo) ➔ fila `SUPORTE_HARDWARE`, escalar direto;
- Laya sem categoria útil (OTHER/UNKNOWN ou "fora do escopo") e base procedural com match forte ➔ categoria do procedimento, status `NEEDS_REVIEW` para a TIC conferir.

## LLM plugável

`llm-client.js` fala o protocolo OpenAI Chat Completions. Provedores: `openai_compatible`, `openai`, `openrouter`, `groq`, `ollama`, `hermes` (ou `rules` para desligar). O prompt de sistema é montado com a memória Hermes (`core/*.md`), a ficha da estação, o perfil do setor, a triagem do Laya, os precedentes, os procedimentos já filtrados para o SO e o laudo do Meet.

Chamadas de ferramenta:

- **nativo** — `tools` + `tool_calls`, resultados em mensagens `role: tool`;
- **hermes** — ferramentas em `<tools>` no prompt e respostas `<tool_call>{"name": …, "arguments": …}</tool_call>`, resultados em `<tool_response>`;
- **auto** (padrão) — nativo, lendo também `<tool_call>` no texto; se o endpoint recusar `tools`, repete no formato Hermes e memoriza.

O laço executa até 3 rodadas de ferramentas por mensagem. `run_meet_check` vira um cartão (o teste roda no navegador e o laudo volta como nova mensagem); `escalate_glpi_ticket` vira uma proposta que só abre chamado quando o usuário confirma. A resposta da LLM é tratada como conteúdo não confiável: o navegador escapa todo o HTML (`public/js/markdown.js`).

Sem chave, com placeholder (`sua-chave-aqui`) ou com a LLM fora do ar, `COPILOT_FALLBACK_RULES=true` responde pelo motor de regras com os mesmos dados. Com `false`, a API devolve 503.

## Memória Hermes e base procedural

- `hermes-memory/conhecimento/*.md`: cada `## Sintoma N: título` tem `### Diagnóstico:` e um ou mais `### Procedimento de Resolução (Windows 11|Ubuntu 24.04|todos os sistemas):` com lista numerada (blocos de código indentados ficam no passo). Passos que começam com "No Windows:" ou "Se for Linux (Ubuntu):" só aparecem para o SO certo.
- `hermes-memory/conhecimento/indice.json`: termos de busca (`fortes` valem 3, `termos` 1), SO, categoria/sistema do Laya, `grupo` (liga variantes Windows/Ubuntu do mesmo sintoma), `ferramenta`, `escalar` e `equipamento`. Seções sem entrada no índice continuam indexadas pelo título.
- Arquivos acrescentados ao dataset original para cobrir o spec (lentidão, disco, periféricos, sistemas web, rede sem conexão, audiência e variantes Ubuntu): `estacao-desempenho.md`, `perifericos.md`, `sistemas-web.md`, `rede-conexao.md`, `audiencias-complemento.md`, `ubuntu-linux.md`, `roteiro-geral.md`. Os arquivos originais não foram alterados.
- Precedentes: os 30 chamados de `chamados-classificados.json` são o acervo do RAG (TF-IDF com cosseno, stem leve e conceitos do domínio, reforçado por categoria, sistema, setor, SO e mesmo sintoma). A "resolução comprovada" vem de `historico-incidentes/incidentes-recorrentes.md`; casos fora desses padrões mostram o procedimento da base para o sintoma, sem inventar resolução nem taxa de sucesso.
- `sessoes/template-sessao.md`: `GET /api/copilot/sessions/:id/log` devolve o atendimento preenchido nesse formato.

Depois de editar a memória, reinicie a API (o dataset é carregado uma vez por processo).

## Ferramentas (Tool Registry)

```js
import { registerTool } from './tools.js';
registerTool({
  name: 'test_pjeoffice_socket',
  status: 'ativa',              // 'planejada' fica registrada, mas não vai para a LLM
  execution: 'navegador',       // ou 'servidor'
  description: 'Verifica se o PJeOffice responde em 127.0.0.1:8800.',
  parameters: { type: 'object', properties: { port: { type: 'integer' } } },
  when: ({ text, machine }) => null,   // gatilho determinístico (motor de regras / rede de segurança)
  async run(args, context) { return { status: 'concluido' }; },
});
```

Registradas hoje: `run_meet_check`, `search_precedents`, `escalate_glpi_ticket` (ativas) e `test_pjeoffice_socket`, `check_spooler`, `reset_printer_spooler`, `verify_cert`, `diagnose_dns` (planejadas). A tela **Copilot (IA)** lista o registro.

## Persistência

- `copilot_sessions` (migration `20261105120000_copilot_sessions`): mensagens, ferramentas, laudos, procedimentos tentados, status `EM_ANDAMENTO | RESOLVIDO_AUTOATENDIMENTO | ESCALADO_GLPI`.
- `requests`/`decisions`: a solicitação triada aparece em Qualidade, Piloto e Chamados como as demais; o artigo consultado fica como `KB-COPILOT:<procedimento>`.
- Chamados do conector mock guardam o corpo enriquecido na descrição; no GLPI vão `name`, `content` (HTML), `urgency`, `impact`, `priority` (se a instância documentar o campo) e `category` (se houver ID configurado para a fila).

## API

| Rota | Perfis | Uso |
| --- | --- | --- |
| `GET /api/copilot/machines[?hostname=]` | solicitante, tic | Estações, estação detectada e motor ativo |
| `POST /api/copilot/chat` | solicitante, tic | `{ sessionId?, machineId, message?, meetReport? }` → `{ session, turn }` |
| `POST /api/copilot/escalate` | solicitante, tic | Abre (ou devolve) o chamado da sessão |
| `POST /api/copilot/resolve` / `feedback` | solicitante, tic | Autoatendimento e nota |
| `GET /api/copilot/sessions/:id[/log]` | dono da sessão, tic | Retomada e registro `.md` |
| `GET /api/copilot/tools` | tic | Tool Registry |
| `GET\|PUT /api/copilot/settings`, `POST /api/copilot/settings/test` | tic | LLM do tenant (chave criptografada, nunca devolvida) |
| `GET /api/copilot/ping` | público | Eco sem banco para medir latência no teste de audiência |

## Limites conhecidos

- A telemetria Zabbix do teste de audiência é **simulada** (não há Zabbix integrado); o laudo marca `simulado: true`. A latência até o servidor central é medida de verdade.
- O classificador local (sem Laya) erra várias categorias do dataset; a regra da base procedural corrige os casos OTHER/UNKNOWN e marca para revisão, mas classificações específicas e erradas do Laya são mantidas.
- A identificação por IP/DNS só funciona na rede interna com os IPs do inventário; em desenvolvimento (localhost) vale o seletor.
- O tool calling foi testado contra endpoints OpenAI-compatíveis simulados nos dois formatos; valide o modelo escolhido com **Testar conexão** antes de uma demonstração.
