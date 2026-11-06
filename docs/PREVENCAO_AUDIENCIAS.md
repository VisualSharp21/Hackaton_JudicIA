# Central de Audiências — implementação e operação

## Auditoria e reutilização

Foram preservados a API HTTP Node, as páginas JavaScript, as sessões HttpOnly/CSRF, os perfis, a separação física dos bancos por tenant, o adaptador GLPI v2 e os históricos Prisma. A entrada padrão da interface agora é a Central de Audiências. Atendimento, triagem, chamados e demais telas continuam disponíveis.

A aplicação principal continua em `http://localhost:5173`, com a API na porta 3000. A Central está no menu lateral existente; o antigo teste de audiência é acessado pelo botão “Teste avulso de câmera e microfone” dentro da Central. Não é necessário abrir a demonstração da porta 5174 para utilizar os recursos no JUDICI.A.

Limitações encontradas e corrigidas:

- Não existiam agenda nem scheduler no backend. Agora há agenda/importação, jobs persistentes, leases, revisões e auditoria.
- O catálogo de estações e os precedentes locais eram sintéticos, mas tinham textos de “resolução comprovada” e porcentagens arbitrárias. Agora recebem origem DEMO e validação sintética explícita; exemplos não entram na memória operacional REAL.
- As duas interfaces de WebRTC geravam números locais e os apresentavam como Zabbix. No modo REAL esses números foram removidos; rede sem conector resulta em NÃO VERIFICÁVEL. A simulação precisa ser escolhida e recebe marca DEMO.
- O fallback era denominado “Hermes Engine”. Agora a resposta informa `deterministic_rules`, `generative=false`, falhas de integração e o modelo efetivamente retornado pela LLM quando utilizado.
- As configurações da LLM eram globais em memória e modificáveis por solicitantes. Agora as alterações exigem TIC, são persistidas por tenant e os segredos são criptografados com `TENANT_SECRETS_KEY`.
- O histórico de conversa vinha integralmente do cliente. Agora pertence ao usuário/estação no banco, com serialização de turnos e tentativas anteriores.
- O teste HTTP usava um ID de usuário real fixo. Agora cria e remove seu próprio tenant/banco temporário.

## Executar

Produção/desenvolvimento usa o MariaDB existente:

```powershell
npm.cmd run db:migrate
npm.cmd run dev:backend
# Outro terminal:
npm.cmd run dev:frontend
```

A API também aplica migrations pendentes ao iniciar. A migration `20261105000000_prevention` é aditiva: cria `prevention_records`, `prevention_audit` e `prevention_mutex`. Não altera os registros anteriores. O mutex e os registros ficam dentro do banco de cada organização; as tabelas antigas de baseline não foram alteradas.

Para demonstrar sem MariaDB, GLPI, câmera ou credenciais, use **Node 24+** (SQLite nativo):

```powershell
npm.cmd run demo:hearings
```

Abra http://127.0.0.1:5174. O servidor escuta apenas em loopback, rejeita origens/hosts diferentes e aceita apenas audiências e estações DEMO. O relógio avança 30 vezes mais rápido. Os mesmos componentes de agenda, scheduler, outbox, estados, página e auditoria são usados; só o relógio e o driver de persistência mudam. Os dados ficam em `data/hearings-demo.sqlite`, ignorado pelo Git. “Novo ciclo DEMO” preserva o histórico e cria novas sessões com cenários de prontidão, correção, falha e ausência de evidências. `DEMO_PORT` e `DEMO_STATE_FILE` permitem instâncias isoladas.

## Agenda, estados e concorrência

Cadastre a estação com perfil TIC. TIC e gestor cadastram, importam, reagendam, cancelam e concluem audiências. Solicitantes consultam somente registros criados por eles ou cujo campo responsável contém seu ID de usuário. A comarca deve coincidir com a estação cadastrada. Não há uma ACL institucional por comarca no sistema original; a equipe TIC/gestor continua abrangendo seu tenant. Uma ACL de comarcas por técnico exigirá cadastro institucional adicional.

Campos: identificação técnica, comarca, sala, estação, início ISO com offset explícito, fuso IANA para exibição, duração, dispositivos e responsável. Não há campos de partes, autos ou conteúdo processual. A importação JSON aceita até 100 registros e exige `externalRef` único, tornando repetição do mesmo lote idempotente. Um lote inválido é revertido integralmente.

```json
{
  "hearings": [{
    "externalRef": "agenda-local-001",
    "label": "Sessão sala 3",
    "locality": "Belém",
    "room": "Sala 3",
    "stationId": "ESTACAO-1",
    "startsAt": "2026-11-05T10:30:00-03:00",
    "timezone": "America/Sao_Paulo",
    "durationMinutes": 60,
    "responsible": "Equipe TIC",
    "devices": ["Câmera USB", "Viva-voz"],
    "mode": "REAL"
  }]
}
```

O servidor varre jobs a cada 5 segundos, mesmo sem navegador conectado. A janela preventiva começa em `startsAt - 30 minutos`; a precisão operacional é a do intervalo de varredura e da carga do servidor. Os testes com relógio controlado comprovam exatamente 10h00 para uma sessão de 10h30. Jobs vencidos durante uma parada são retomados enquanto a janela da audiência está ativa.

Estados de prontidão: AGENDADA → VERIFICAÇÃO_PENDENTE → VERIFICANDO → PRONTA / ATENÇÃO / CRÍTICA / NÃO_VERIFICÁVEL; CONCLUÍDA encerra a janela. Cancelamento é registrado separadamente como `lifecycle=CANCELADA`, preservando auditoria. A transição VERIFICAÇÃO_PENDENTE aparece na auditoria mesmo quando é curta demais para a interface observá-la.

Cada job usa chave `audiência:revisão`. Reagendamento exige `expectedRevision`, cancela o job antigo e gera uma nova revisão. Resultados em voo da revisão anterior são descartados. Claims usam transação e mutex no MariaDB, lease de dois minutos e token de posse. Até quatro diagnósticos são processados em paralelo por lote; consultas dos jobs usam índice de vencimento. São feitas até três tentativas, com intervalos de 15 e 30 segundos. Reiniciar recupera o mesmo job; não cria outro job ou outra escalação para a revisão.

As telas recebem snapshots SSE a cada cinco segundos. A sessão/perfil é revalidada e a conexão se renova a cada minuto. Contagem regressiva usa o relógio enviado pelo servidor. Encerrar a janela temporal conclui a audiência; o diagnóstico original permanece no histórico.

## Evidências REAL, DEMO e não verificáveis

Cada resultado contém nome, camada, status, modo, horário, evidência e métricas quando medidas.

| Camada | Implementação | Limite |
|---|---|---|
| Servidor | Conexão a IP/porta TCP previamente cadastrados pela TIC | Tempo de conexão TCP não é perda ICMP nem saúde do dispositivo |
| Monitoramento | Zabbix `item.get`, token somente no backend, IDs autorizados por tenant/estação | Amostras ausentes, antigas, desabilitadas ou de unidade desconhecida são não verificáveis |
| Agente | PnP de câmera/áudio, quatro sondas ICMP e ações explicitamente permitidas | Presença PnP é DETECTED; não prova captura funcional. ICMP sem resposta pode ser filtrado |
| Navegador | WebRTC de vídeo, frames e sinal de áudio local | Exige ação/permissão do usuário; não grava áudio/vídeo. O laudo é identificado como declaração do navegador autenticado |
| DEMO | Cenários fixos e explicitamente sintéticos | Não envia comandos nem chamados ao GLPI real |

Silêncio durante o teste não prova microfone quebrado. Vídeo/áudio não verificados e falta de monitoramento mantêm a prontidão não verificável, em vez de inventar sucesso. A confirmação humana de qualidade, seleção correta dos dispositivos e configuração da videoconferência continua necessária.

### Agente Windows autorizado

Na Central, o perfil TIC cadastra a estação REAL e recebe um token de provisionamento exibido uma vez. No banco só fica SHA-256. Armazene o token em arquivo com ACL restrita na estação. O token é específico para estação e tenant; não é uma chave GLPI/LLM. Renovar o cadastro troca o token. Execute o agente por uma tarefa agendada administrada pela TIC, em conta com as permissões necessárias:

```powershell
powershell.exe -File tools/hearing-agent.ps1 -ApiBase https://judicia.exemplo.interno -TenantId UUID_DA_ORGANIZACAO -StationId ESTACAO-1 -TokenFile C:\JudiciaAgent\token.txt
```

O agente consulta tarefas a cada dez segundos; cada laudo precisa do desafio do job, vinculado à estação/revisão, e a repetição é idempotente. O servidor registra o horário de recebimento, não confia em timestamps livres do cliente. Evidências expiram em dois minutos.

Única correção REAL disponível: `enable_audio_device` para um dispositivo PnP de áudio que esteja desabilitado (código 22). Exige simultaneamente autorização TIC no cadastro, lista de IDs PnP, `-AllowEnableAudioDevice` e `-AllowedDeviceIds` na estação. A ação habilita, reconsulta o PnP e desabilita novamente os dispositivos alterados se essa reverificação falhar. Ela não prova captura de áudio. Não existe execução de shell, comando de LLM, instalação, reinício de serviços, alteração de certificados ou ação destrutiva nesse contrato. A conta do agente deve ser preparada para executar o cmdlet quando a política local permitir. O script foi analisado sintaticamente; não foi instalado nem acionou hardware nesta máquina.

### Zabbix

Configure `ZABBIX_API_URL`, `ZABBIX_API_TOKEN` e `ZABBIX_TENANT_ITEMS` apenas no ambiente do backend. Exemplo de mapeamento:

```json
{"UUID_DO_TENANT":{"ESTACAO-1":{"availability":{"id":"1001","healthyValue":1},"latency":{"id":"1002","threshold":150},"loss":{"id":"1003","threshold":5},"service":{"id":"1004","healthyValue":1}}}}
```

O navegador não pode escolher IDs para consultar com um token compartilhado. Latência aceita `s` ou `ms`; perda exige `%`. Os limiares são parâmetros operacionais, não garantias de qualidade de uma audiência. Referências do contrato: [item.get](https://www.zabbix.com/documentation/current/en/manual/api/reference/item/get), [campos lastclock/lastvalue](https://www.zabbix.com/documentation/current/en/manual/api/reference/item/object) e [autenticação da API](https://www.zabbix.com/documentation/7.0/en/manual/api).

## Correção e escalação

Falhas são persistidas antes da escalação, com audiência, estação, comarca, sala, responsável, horário, modo, testes e ações. O mecanismo consulta somente conhecimento validado do mesmo modo/tenant. Uma falha iminente (até 15 minutos) cria escalação imediatamente; falhas persistentes são escaladas ao esgotar as tentativas. Ausência de evidência é exibida como não verificável, sem ser inventada como falha confirmada. A prioridade local aumenta quando a sessão se aproxima; uma atualização de prioridade não implica confirmação de alteração no GLPI remoto.

O envio usa outbox transacional e marcador exclusivo no título. Respostas perdidas após um POST entram em UNCERTAIN: o sistema procura o marcador e não repete o POST cegamente. Dez tentativas de reconciliação sem confirmação geram REVIEW_REQUIRED. Ausência de GLPI REAL gera BLOCKED explícito, nunca um sucesso simulado. Falhas anteriores ao envio permitem até cinco retentativas. A busca remota paginada tem limite de 10 mil registros; atingir esse limite exige revisão.

Não existe garantia universal de “exactly once” entre MariaDB e uma API GLPI sem chave de idempotência transacional. A implementação prioriza não duplicar: uma resposta ambígua pode exigir conciliação manual. `POST /api/prevention/escalations/:id/retry` (TIC) reabre reconciliação para casos ambíguos e reenfileira somente envios comprovadamente bloqueados antes do POST. As escalações preventivas aparecem vinculadas na Central; não são inseridas artificialmente como solicitações de usuário nas tabelas legadas.

“Orientação do Copilot” consulta evidências e precedentes por solicitação da equipe, registra o provedor e mostra orientação assistida. O scheduler não espera a LLM e continua se ela estiver indisponível.

## Memória GLPI e RAG

O fluxo exige chamado SOLVED/CLOSED confirmado na API GLPI. O técnico fornece evidência de sucesso e o ID de uma solução já registrada no GLPI. A API verifica a associação da solução ao chamado, extrai o conteúdo e deixa PENDING_VALIDATION. TIC valida ou rejeita na Central; só VALIDATED + INDEXED com evidência de sucesso entra na busca REAL. Origem, ticket, solução, datas, confirmação, validação, hash e evidências são persistidos.

`POST /api/operational-knowledge` também aceita `solution` no lugar de `solutionId` para registrar antes da extração, desde que a instância publique `POST /Assistance/ITILSolution` com os campos necessários. O adaptador consulta `doc.json` e falha explicitamente se o contrato divergir. Não foi validado contra uma instância real neste ambiente. Uma escrita ambígua fica REVIEW_REQUIRED; após conferir no GLPI, `POST /api/operational-knowledge/:id/reconcile` com `solutionId` recupera a extração sem repetir o cadastro remoto.

Com `EMBEDDING_BASE_URL`, `EMBEDDING_MODEL` e opcionalmente `EMBEDDING_API_KEY`, a indexação chama `/embeddings` e persiste o vetor/modelo. A recuperação combina coincidências lexicais, cosseno dos embeddings e metadados, explicando os termos e os vínculos utilizados. Sem embeddings ou em falha, o retorno informa `LEXICAL_METADATA`; não há vetor fictício apresentado como busca semântica. Modelos diferentes não são comparados. Vetores ficam no banco do tenant; textos são enviados ao provedor de embeddings explicitamente configurado na implantação.

## Testes e evidências

```powershell
npm.cmd test
npm.cmd run test:prevention
npm.cmd run test:prevention:mysql
node scripts/check-prevention-integrations.mjs
```

`npm test` inclui os testes existentes do copiloto, prevenção/contratos HTTP, migrations/concorrência no MariaDB e API autenticada. As integrações MariaDB criam bancos UUID temporários e removem somente os recursos gerados pelo teste. Precisam de MariaDB disponível e dos mesmos privilégios de criação de tenant da aplicação. Não usam uma conta real fixa.

Os testes cobrem os 12 cenários solicitados: T−30, timer independente de HTTP, evidências, correção DEMO e reverificação, escalação, conteúdo do chamado, concorrência, reinício de processo/lease, recuperação de solução validada via contrato GLPI, REAL/DEMO/não verificável, contingência de integração e alteração/cancelamento. Também cobrem timeout remoto depois do POST, descarte de resultado antigo, CSRF, isolamento por usuário, token/desafio do agente, conversas concorrentes, chamadas de ferramentas inválidas, rejeição de soluções sem validação, semântica de unidades e frescor Zabbix.

Os casos comparativos N1 (microfone, PJeOffice, rede e impressora) exercitam fallback e resposta de provedor por contrato controlado. Isso verifica contexto, identificação do modelo, incerteza e contingência; não é uma avaliação da qualidade de um modelo real.

`scripts/test-prevention-browser.mjs` usa uma instância Chromium/Edge headless isolada com CDP em 9223 e inicia uma DEMO temporária. Exercita SSE, cadastro por formulário, histórico, orientação assistida e layouts desktop/mobile. Capturas ficam em `.demo/` e não são versionadas.

Na configuração local verificada: MariaDB acessível; GLPI em mock; LLM, Zabbix e embeddings não configurados. Portanto contratos desses provedores são testados com fixtures e HTTP local. Câmera/microfone físicos, ação PnP e entrega GLPI real dependem de provisionamento e validação no ambiente de destino.

### Resultado da execução local

| Verificação executada | Resultado |
|---|---|
| Regressão existente do copiloto | 12 testes aprovados |
| Prevenção, memória, contratos e HTTP | 24 testes aprovados |
| Prisma `validate` | Schema válido |
| MariaDB isolado | Migrations, concorrência, evidências, escalação e recuperação aprovadas |
| API autenticada em tenant temporário | Conversa, CSRF, perfis, escalação DEMO sem duplicação e agenda aprovados |
| Edge headless | SSE, formulário, histórico, orientação, desktop/mobile aprovados; nenhuma exceção JS |
| Agente PowerShell | Análise sintática aprovada; hardware não exercitado |

O teste assistido REAL também emite um sinal sonoro curto e pede confirmação de reprodução e seleção dos dispositivos na videoconferência. A confirmação é identificada como relato humano; sem ela o inventário de áudio não se transforma em funcionamento comprovado.
