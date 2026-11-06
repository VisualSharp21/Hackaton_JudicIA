# Pulso TIC — MVP conectado

Aplicação web demonstrativa para triagem e autoatendimento, com interface separada da API Node.js, persistência MariaDB e integração opcional com Laya ou Jev.

## Executar localmente no Windows

1. Instale Node.js 20+ e Docker Desktop.
2. Configure `.env` a partir de `.env.example`.
3. Inicie MariaDB com `docker compose up -d`.
4. Instale dependencias e inicie API: `npm install` e `npm run dev:backend`.
5. Inicie o frontend em outro terminal com `npm run dev:frontend`.
6. Abra `http://localhost:5173`. Consulte [SETUP.md](SETUP.md) para migrar dados do PostgreSQL.

O schema e o historico de banco sao gerenciados pelo Prisma Migrate em `prisma/tenant` e `prisma/registry`. Use `npm run db:migrate` para aplicar migrations pendentes a todas as organizacoes. Consulte [SETUP.md](SETUP.md) para criar migrations e migrar os dados PostgreSQL existentes.

## Contas e perfis de acesso

O sistema não possui cadastro público. Depois de iniciar a API pela primeira vez (para criar as tabelas), abra outro terminal na pasta do projeto e execute `npm run users -- create`. Informe e-mail, nome, perfil (`solicitante`, `tic` ou `gestor`) e uma senha com pelo menos 12 caracteres. Crie a primeira conta com perfil `gestor`; depois, essa pessoa pode criar contas e atribuir perfis pela tela **Acessos**. As senhas são armazenadas como derivados `scrypt`, e a aplicação usa sessões no servidor em cookies `HttpOnly`.

- **Solicitante:** atendimento, autoatendimento e consulta/avaliação dos próprios chamados.
- **Equipe de TIC (`tic`):** atendimento completo, triagem, qualidade, incidentes e configuração das integrações e do piloto.
- **Gestor (`gestor`):** painéis, chamados e incidentes para acompanhamento, além de leitura das metas do piloto.

Para recuperação administrativa, `npm run users -- reset-password email@instituicao.gov.br` redefine a senha e encerra sessões; `npm run users -- set-role email@instituicao.gov.br tic` troca o perfil pelo terminal. Não existe recuperação de senha pela interface. A tela **Acessos** permite gestores criarem contas e mudarem os perfis; alterar um perfil encerra as sessões dessa pessoa. Em implantação HTTPS, configure `SESSION_COOKIE_SECURE=true` no `.env`; mantenha `FRONTEND_ORIGINS` limitado aos endereços da interface. Esta autenticação local não integra diretório institucional nem substitui SSO.

Para usar Laya local, instale e inicie o servidor Laya em `127.0.0.1:8000` conforme as instruções do projeto Laya. Na primeira análise, o modelo poderá ser baixado do Hugging Face. Sem provedor configurado, a API usa o classificador local demonstrativo.

`FRONTEND_ORIGINS` controla as origens permitidas pelo CORS. Ajuste essa variável se a interface estiver em outra origem.

## Copilot Nível 1 (Central de Atendimento)

A tela **Atendimento** é o Copilot de TIC descrito em [docs/PROMPT_COPILOT_IMPLEMENTACAO.md](docs/PROMPT_COPILOT_IMPLEMENTACAO.md): o solicitante escolhe (ou tem identificada pelo IP) a estação `LAB-PJE-XXX`, conversa em linguagem natural e recebe, a cada mensagem, a triagem do Laya, precedentes dos chamados resolvidos, a solução passo a passo no sistema operacional da máquina e, em audiências, o teste de microfone, câmera e rede (`run_meet_check`). Se resolver, o autoatendimento é registrado com nota; se não, o chamado vai ao GLPI com patrimônio, triagem, laudo e procedimentos tentados.

- **LLM plugável no servidor central:** `COPILOT_LLM_*` no `.env` (OpenAI, OpenRouter, Groq, Ollama ou Hermes Agent, protocolo OpenAI Chat Completions) ou a tela **Copilot (IA)** (perfil TIC). A chave nunca chega ao navegador.
- **Sem chave ou sem conexão:** `COPILOT_FALLBACK_RULES=true` (padrão) mantém o atendimento com o motor de regras local, que usa a mesma memória Hermes, base procedural e RAG.
- **Dados:** `data/copilot-dataset/` (30 estações, inventários GLPI, 30 chamados classificados e a memória `hermes-memory/`).
- **Testes:** `npm test` (sem banco) e `npm run test:copilot:api` (com a API rodando).

Arquitetura, endpoints e como estender a base e as ferramentas: [docs/COPILOT.md](docs/COPILOT.md).

## Estrutura

```text
data/copilot-dataset/   Estações, inventários GLPI, precedentes e memória Hermes do Copilot
public/                 Interface web
  js/api.js             Cliente HTTP do navegador
  js/meet-diagnostics.js  Teste de audiência (microfone, câmera, latência, Zabbix simulado)
  js/markdown.js        Markdown seguro para as respostas do Copilot
  app.js                Sessão, estado compartilhado, navegação e ações
  copilot.css           Estilos do Copilot (tokens de theme.css)
  pages/                Módulos de interface separados por tela/domínio
    copilot-chat.js     Central de Atendimento: chat do Copilot Nível 1
    meet-check.js       Teste pré-audiência (Google Meet)
    copilot-settings.js LLM do Copilot e Tool Registry (perfil TIC)
    tickets.js          Painel, chamados e incidentes
    ticket-detail.js    Detalhes e status do chamado
    quality.js          Qualidade da triagem
    triage-settings.js  Configuração e prévia da triagem
    pilot.js            Períodos, SLAs e sincronização
    integration.js      Configuração e estado do GLPI
    user-management.js  Criação de contas e atribuição de perfis
  index.html
  styles.css
src/
  api.js                 Rotas HTTP e validação das solicitações
  copilot/              Agente Copilot: dados, LLM, ferramentas, regras, sessões e escalação
  config.js             Ambiente, portas e configuração do banco
  decision-provider.js  Integração com Laya/Jev e fallback local
  ticketing/            Contrato e adaptador simulado do sistema de chamados
  database.js           Consultas MariaDB e isolamento por organizacao
  repository.js         Schema, inicialização e operações de persistência
  server.js             Rotas HTTP e orquestração da API
  triage.js              Regras puras de classificação e decisão
scripts/                Servidor estático de desenvolvimento e harness
test/                   Testes automatizados (node:test)
evaluation/             Casos rotulados e metadados de validação
```

## Fluxo e endpoints

- Copilot: `GET /api/copilot/machines`, `POST /api/copilot/chat`, `POST /api/copilot/escalate`, `POST /api/copilot/resolve`, `POST /api/copilot/feedback`, `GET /api/copilot/sessions/:id` (e `/log`), `GET /api/copilot/tools` e `GET|PUT /api/copilot/settings` — detalhes em [docs/COPILOT.md](docs/COPILOT.md).
- `POST /api/requests/analyze` classifica uma descrição, calcula confiança e aplica a revisão humana obrigatória conforme as regras atuais (fluxo clássico, mantido na API; a interface usa o Copilot).
- `POST /api/requests/:id/correction` salva correção humana sem sobrescrever a decisão original.
- `POST /api/requests/:id/resolve` registra autoatendimento; `POST /api/tickets` cria um chamado.
- `GET /api/health`, `/api/bootstrap`, `/api/dashboard` e `/api/quality` alimentam estado e indicadores da interface.
- `GET /api/tickets`, `/api/tickets/:id`, `/api/tickets/:id/status`, `/api/incidents`, `/api/incidents/:id` e `/api/knowledge/search` consultam chamados, status, incidentes e artigos.
- O conector selecionado por `TICKETING_PROVIDER` é `mock` por padrão. Para GLPI 11, configure as variáveis `GLPI_*` do `.env.example` e selecione `TICKETING_PROVIDER=glpi`. A integração usa a API v2 e exige um cliente OAuth2 e uma conta de serviço com permissões de leitura da base de conhecimento e criação/leitura de chamados. O campo `GLPI_API_BASE_URL` deve apontar para a raiz da API fornecida pela instância; consulte `/doc.json` nessa raiz para conferir os recursos publicados.
- `GET /api/ticketing/health` verifica autenticação e disponibilidade da documentação da API. A busca consulta artigos relevantes em `Knowledgebase/Article` no GLPI v2. `npm run seed:glpi-knowledge` cadastra artigos iniciais sem duplicar títulos existentes. A criação envia chamados a `Assistance/Ticket` e salva uma cópia local. Sem `TICKETING_PROVIDER=glpi`, nenhuma chamada externa é feita.
- Antes de habilitar em produção, valide na documentação da sua instância os campos obrigatórios de `Ticket`, os direitos do usuário OAuth e a forma como o GLPI associa o solicitante. O protótipo usa a conta OAuth para registrar a criação; ainda não mapeia cada usuário do Pulso TIC para uma identidade GLPI. Sem URL e credenciais de uma instância, a integração não foi validada ao vivo.
- O roteamento pode enviar uma categoria GLPI por fila configurando `GLPI_QUEUE_CATEGORY_IDS=SUPORTE_PJE:12,SUPORTE_REDE:13` (use os IDs da sua instância) na tela **Integração GLPI**. Configure também regras de atribuição por categoria no GLPI; enviar a categoria não confirma que um grupo foi atribuído. O Pulso TIC continua exibindo a fila sugerida até a instância confirmar a atribuição.
- A tela **Piloto e SLAs** permite definir períodos, metas por prioridade, sincronizar até 50 chamados GLPI abertos por execução e acompanhar tempo até a primeira atribuição observada, resolução e satisfação por comarca. A sincronização registra apenas o momento em que o Pulso TIC observou cada status; não reconstrói eventos históricos do GLPI. Importe e valide a linha de base antes de usar a comparação como evidência do edital.

## Avaliar a triagem

Com a API e o serviço de decisão ativo, execute `npm run evaluate:classifier`. Os casos ficam em `evaluation/cases.json`. Amplie o conjunto com exemplos anonimizados e revisados por especialistas antes de alterar limiares ou considerar uso operacional.

Na interface, **Configuração da triagem** permite ajustar instruções e descrições dos critérios e pré-visualizar os rótulos usando casos do benchmark. Para exigir uma chave nas operações de salvar configuração e executar prévias, defina `TRIAGE_SETTINGS_KEY` no `.env` e reinicie a API. O segredo é enviado pelo cabeçalho `Authorization: Bearer` e não é armazenado pelo navegador. Sem essa variável, essas operações ficam abertas; mantenha a API em ambiente local controlado.

As correções humanas podem ser aprovadas como exemplos pela tela **Qualidade**. Revise e anonimize o texto antes de aprová-lo. Use **Avaliar feedback** nessa tela para classificar os exemplos ainda não avaliados com o provedor configurado e consultar a concordância por campo e as divergências. Cada caso avaliado com sucesso é preservado e não é executado de novo; alterações no texto ou nos rótulos criam uma nova versão para avaliação. Essa avaliação fica separada do benchmark-base e não altera o modelo. A exportação JSON e `npm run evaluate:classifier` continuam disponíveis para avaliação local por CLI; para esse script, copie o JSON exportado para `evaluation/feedback.local.json`.

A automação permanece desativada por padrão (`TRIAGE_AUTOMATION_APPROVED=false`). Os casos atuais exercitam regras do protótipo e não substituem uma validação independente por especialistas. Prioridade e detecção de incidentes são parâmetros experimentais; nenhum sistema real do Tribunal é contatado.
# Pulso TIC
