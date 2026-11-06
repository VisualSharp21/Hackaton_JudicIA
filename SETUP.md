# Pulso TIC - setup local

## Requisitos

- Node.js 20.19+
- Docker Desktop (MariaDB local)
- Python e Laya, se usar classificacao com Laya

## Iniciar

1. Copie `.env.example` para `.env`. Altere `MYSQL_PASSWORD` e `MARIADB_ROOT_PASSWORD`.
2. Inicie o banco: `docker compose up -d`.
3. Aplique as migrations Prisma a todos os bancos de organizacao: `npm run db:migrate`.
4. Instale dependencias e inicie a API: `npm install` e `npm run dev:backend`.
5. Em outro terminal, inicie a interface: `npm run dev:frontend`.
6. Opcional: ative o ambiente virtual do Laya e execute `laya-serve`.

A API usa MariaDB 11.4. `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD` e `MYSQL_REGISTRY_DATABASE` configuram a conexao. O Compose publica o MariaDB na porta `3307` e o phpMyAdmin em `http://localhost:8081`, evitando conflito com MySQL/XAMPP local. Cada organizacao tem seu proprio banco `judicia_t_<uuid sem hifens>`; o banco central guarda organizacoes e sessoes. Para MariaDB externo, conceda ao usuario da aplicacao permissao `CREATE` global e privilegios completos no banco central (`MYSQL_REGISTRY_DATABASE`) e nos bancos `judicia_t_%`. Proteja essas credenciais como segredos de implantacao.

## Prisma Migrate

Os schemas estao em `prisma/tenant/schema.prisma` e `prisma/registry/schema.prisma`; cada um tem seu proprio historico versionado em `prisma/*/migrations`. A API aplica migrations pendentes ao iniciar e tambem a cada banco novo de organizacao.

Para criar uma migration de tenant em desenvolvimento:

```powershell
npm run db:migrate:dev -- --name nome_da_alteracao
```

Para alteracoes no cadastro central de organizacoes e sessoes:

```powershell
npm run db:migrate:registry:dev -- --name nome_da_alteracao
```

Depois, commit o schema e a pasta de migrations. `npm run db:migrate` aplica historicos pendentes ao banco central e a todos os tenants existentes, sem resetar dados. Bancos MariaDB criados pelo bootstrap anterior, sem `_prisma_migrations`, sao reconhecidos e recebem baseline apenas quando todas as tabelas esperadas existem. Um banco com schema parcial e sem historico para com erro para evitar marcar uma migration incorretamente.

## Migrar PostgreSQL para MariaDB

A migracao copia organizacoes, usuarios, sessoes, configuracoes, artigos, solicitacoes, decisoes, chamados, incidentes e avaliacoes. O PostgreSQL e somente lido e permanece intacto. A importacao usa upsert e nao apaga registros existentes no MariaDB. Pare a API durante a migracao para evitar gravacoes concorrentes.

1. Faca backup do PostgreSQL e do `.env` atual.
2. Configure no `.env` as variaveis do MariaDB (`MYSQL_*`) e da origem PostgreSQL (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`).
3. Inicie MariaDB e execute uma vez: `npm run db:migrate:postgres`.
4. Confira os totais exibidos, inicie a API e valide login, solicitacoes e configuracoes. Mantenha o backup PostgreSQL ate concluir a validacao.

A conta MariaDB precisa criar o banco central e os bancos por organizacao. O comando nao remove nem altera dados do PostgreSQL; ele aplica primeiro os schemas versionados pelo Prisma e depois copia os dados.

## Organizacoes e usuarios

Crie o primeiro gestor depois de iniciar a API: `npm run users -- create --tenant default`.

Cadastre outra organizacao e seu primeiro gestor com `npm run tenants -- create`. Novos usuarios podem ser vinculados pelo comando `npm run users -- create --tenant identificador-da-organizacao`.

As configuracoes e registros de cada organizacao ficam separados em bancos proprios. Gere `TENANT_SECRETS_KEY` com `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` para criptografar credenciais GLPI.

## Copilot: LLM conversacional

Sem nenhuma configuracao, o Copilot responde com o motor de regras local (`COPILOT_FALLBACK_RULES=true`). Para plugar uma LLM, edite o `.env` do servidor e reinicie a API, ou use a tela **Copilot (IA)** com uma conta `tic` (exige `TENANT_SECRETS_KEY`, porque a chave e gravada criptografada):

```env
# OpenRouter com Hermes 3 (tool calling nativo)
COPILOT_LLM_PROVIDER=openrouter
COPILOT_LLM_BASE_URL=https://openrouter.ai/api/v1
COPILOT_LLM_API_KEY=sk-or-...
COPILOT_LLM_MODEL=nousresearch/hermes-3-llama-3.1-8b

# Hermes no proprio servidor central (Ollama, sem chave)
# COPILOT_LLM_PROVIDER=ollama
# COPILOT_LLM_BASE_URL=http://localhost:11434/v1
# COPILOT_LLM_MODEL=hermes3

# Servidor que devolve <tool_call> no texto (vLLM sem parser, Hermes Agent)
# COPILOT_LLM_PROVIDER=hermes
# COPILOT_LLM_TOOL_MODE=hermes
```

Groq (`https://api.groq.com/openai/v1`) e OpenAI (`https://api.openai.com/v1`) seguem o mesmo formato. O botao **Testar conexao** da tela **Copilot (IA)** confirma credencial e modelo. Atras de proxy reverso, `COPILOT_TRUST_PROXY=true` faz o Copilot identificar a estacao pelo `X-Forwarded-For`.

Testes: `npm test` roda a suite sem banco; com a API no ar, `npm run test:copilot:api` cria (ou reutiliza) a organizacao `copilot-qa` com contas de teste e exercita chat, laudo, escalacao, autoatendimento, permissoes e settings.

## Solucao de problemas

- `Decision service unavailable: fetch failed`: a API nao alcancou o provedor de decisao configurado.
- MariaDB nao inicia: veja `docker compose ps` e `docker compose logs mariadb`.
- Porta 3306 ocupada: altere `MYSQL_PORT` no `.env` e reinicie o compose.
- Falha de conexao: confira credenciais e privilegios do usuario MariaDB.
