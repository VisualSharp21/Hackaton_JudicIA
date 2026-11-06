# Central de Audiências — experiência preventiva

A Central continua no JUDICI.A principal, com o mesmo login, API, banco por organização, scheduler, Copilot e integração GLPI. Acesse `http://localhost:5173/audiencias/`. Cada card abre `/audiencias/<id>`; atualização da página e retorno pelo navegador preservam a rota. O servidor que hospedar o frontend deve servir `index.html` nessas rotas, como faz `scripts/dev-frontend.mjs`.

## Agenda automática DEMO

`DEMO_MODE=true` habilita o bootstrap no worker do backend. Foi habilitado no `.env` do ambiente local; `.env.example` mantém o padrão desabilitado. Não há chamada de criação pelo frontend. Cada organização recebe cinco sessões futuras (+8, +22, +45, +90 e +180 minutos), duas sessões históricas e um precedente de áudio sintético. Os horários usam o relógio do servidor no início do ciclo. Uma transação e um marcador persistente impedem duplicação entre ticks, workers e reinícios; após 210 minutos um novo ciclo é criado, preservando o histórico.

As estações `DEMO-SALA-1` a `DEMO-SALA-5` apresentam prontidão, microfone com falha, latência/perda de pacotes, indisponibilidade e correção simulada recuperável. O ciclo inicial já contém duas sessões em T−30. A falha do microfone recupera um precedente e, após as retentativas, gera uma escalação DEMO. Nenhuma dessas ações publica chamado no GLPI real.

## Detalhes e validação local

Os detalhes exibem dados da sessão, checklist com origem/evidência/horário, precedentes, timeline e suporte. Ferramentas administrativas ficam recolhidas. A importação JSON permanece disponível pela API, fora da interface principal. O teste avulso deixou de ser destacado na Central.

Em sessões REAL, os botões de câmera e microfone solicitam somente a permissão correspondente. A câmera mostra preview; o microfone mostra nível de áudio. Frames e RMS produzem evidência local, sem armazenar vídeo ou áudio. Silêncio, permissão negada e impossibilidade de captura são NÃO VERIFICÁVEIS, sem diagnóstico inventado de hardware. O resultado fica persistido por execução/revisão da audiência e atualiza o checklist; outra audiência na mesma estação não herda esse resultado. Detecção de dispositivo continua distinta de teste funcional. O navegador fornece um relato autenticado e declara a estação; não é uma atestação criptográfica do hardware.

O Copilot recebe audiência, tempo restante, sala/estação/equipamentos, diagnósticos, falhas, histórico, ação tentada e precedentes. As mensagens são persistidas por audiência/revisão/usuário. O motor efetivamente utilizado aparece na resposta. A intervenção continua limitada às ações previamente autorizadas do backend/agente.

## Origem das informações

| Origem | Significado |
| --- | --- |
| REAL | Evidência efetivamente recebida do agente, integração configurada ou navegador autenticado; a camada e o horário são apresentados. |
| DEMO | Agenda, responsáveis, links `.invalid`, falhas, correções, precedente e chamados sintéticos. Não são telemetria nem resolução comprovada de um incidente real. |
| NÃO VERIFICÁVEL | Ausência de integração/evidência específica, captura não confirmada ou validação local pendente. Não significa que o componente está saudável. |

## Validação

`npm test`: 12 testes do Copilot, 26 testes de prevenção/memória/API/experiência, integração MariaDB e regressão autenticada com organização isolada. Os novos testes cobrem bootstrap relativo/idempotente, timer sem requisição do usuário, T−30, mudança de estado, precedente, contexto do Copilot, escalação única e persistência/isolamento dos componentes locais.

`node scripts/test-prevention-browser.mjs`: Chrome headless isolado via CDP na porta 9223; cards, SSE, detalhes, timeline, precedente, Copilot, recarga da URL e layout desktop/móvel, sem exceção JavaScript. O servidor DEMO criado pelo teste é temporário e encerrado ao final.

Câmera e microfone físicos, execução do agente em hardware e serviços externos GLPI/LLM/Zabbix não foram exercitados ao vivo nesta alteração. Seus resultados não são apresentados como verificação real concluída.
