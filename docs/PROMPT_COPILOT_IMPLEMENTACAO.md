# PROMPT DE ESPECIFICAÇÃO E IMPLEMENTAÇÃO: AGENTE COPILOT NÍVEL 1 DE TIC (JUDICI.A)

---

## 🎯 OBJETIVO E VISÃO DO PRODUTO

Você deve implementar a evolução da interface de atendimento do solicitante no **JUDICI.A (Tribunal de Justiça do Estado do Pará - TJPA)**.

### O que muda:
- **Fluxo Antigo:** O usuário preenche uma caixa de texto estática ➔ O Laya classifica de forma isolada ➔ Exibe um artigo genérico ➔ O usuário abre um chamado básico no GLPI.
- **Novo Fluxo (Copilot Nível 1 com Consciência de Hardware, Precedentes e Tool Calling):**
  1. **Consciência de Hardware:** O solicitante seleciona ou tem sua máquina identificada (ex: `LAB-PJE-004`). O sistema carrega instantaneamente as especificações da máquina (SO, CPU, RAM, disco livre, setor, periféricos e inventário GLPI).
  2. **Interação Conversacional (Chatbot Ativo com API Plugável):** O solicitante relata o problema em linguagem natural em um chat interativo e fluido. O motor de conversação é desacoplado e consome um endpoint de LLM configurável pelo usuário (OpenAI, OpenRouter, Ollama, Groq ou **Hermes Agent**).
  3. **Classificação Técnica em Tempo Real (Laya):** O modelo Laya categoriza o chamado (Categoria ITIL, Sistema, Impacto, Urgência, Fila GLPI e indício de Incidente Coletivo).
  4. **Resolução Recomendada Universal (Para QUALQUER Problema):**
     - O Copilot SEMPRE gera uma solução recomendada passo a passo para qualquer problema relatado (PJe, assinatura com token/PJeOffice, impressora travada, rede/Wi-Fi instável, senha expirada, e-mail cheio, lentidão de sistema, falhas de hardware).
     - As recomendações adaptam-se dinamicamente ao Sistema Operacional da máquina selecionada (Windows 11 vs Ubuntu) e setor da comarca.
  5. **RAG Baseado em Precedentes (Casos Anteriores):** O Copilot consulta os chamados históricos resolvidos do tribunal e identifica precedentes reais: *"Identifiquei que na máquina do Gabinete ocorreu a mesma falha ao assinar e foi resolvido reiniciando o serviço do PJeOffice."*
  6. **Ferramenta Especializada Extensível (Tool Calling - Teste de Audiência Google Meet):**
     - Para problemas de **audiência virtual e Google Meet**, o Copilot possui a ferramenta especializada nativa (`run_meet_check`).
     - Se o usuário colar um link do Meet ou mencionar audiência/videoconferência, o agente aciona a ferramenta para executar diagnóstico de hardware/rede (microfone, câmera, latência de rede/Zabbix) e anexa o laudo à conversa.
     - **Extensibilidade Futura:** A arquitetura do Tool Registry permite plugar novas ferramentas facilmente (ex: `test_pjeoffice_socket`, `reset_printer_spooler`, `diagnose_dns`).
  7. **Autoatendimento Guiado:** Se o usuário conseguir resolver, o chamado é encerrado com sucesso como autoatendimento no banco local.
  8. **Escalação Estruturada para GLPI:** Se o problema persistir, o chamado é aberto no GLPI 11 contendo: patrimônio e serial da máquina, laudo técnico completo, testes já executados e prioridade calculada.

---

## 🤖 ARQUITETURA DO MODELO CONVERSACIONAL (API PLUGÁVEL & HERMES AGENT NO SERVIDOR CENTRAL)

### 1. Implantação Centralizada (Servidor Central do TJPA)
> **Princípio de Arquitetura:** O Hermes Agent e os modelos de IA **NÃO rodam na máquina do usuário final**. Eles rodam centralizados no servidor corporativo de TIC do TJPA (on-premise ou nuvem do Tribunal), junto ao backend Node.js, MariaDB, Laya e GLPI.

- **Zero Instalação na Ponta:** O magistrado, servidor ou estagiário apenas abre o navegador web no seu computador local (ex: `http://judicia.tjpa.jus.br`) e acessa o sistema de forma leve e rápida.
- **Identificação da Estação:** Ao conectar, a sessão do usuário é vinculada à sua estação de trabalho (ex: `LAB-PJE-004`), seja por detecção de IP/Hostname na rede interna ou pelo seletor de estação homologado.
- **Segurança e Conformidade:** Credenciais de API, chaves secretas do GLPI, logs e modelos de inteligência artificial ficam estritamente confinados no servidor central protegido por firewall, sem expor chaves aos clientes.

### 2. Entrada de API Configurável (`.env` e Settings no Servidor Central)
O servidor central consome a LLM através de um endpoint configurável compatível com o protocolo **OpenAI Chat Completions** (pode apontar para um Ollama/vLLM rodando na própria infraestrutura do servidor ou para um gateway corporativo de IA):
```env
# Provedor da LLM Conversacional do Copilot (Configurado no Servidor Central)
COPILOT_LLM_PROVIDER=openai_compatible
COPILOT_LLM_BASE_URL=https://openrouter.ai/api/v1
COPILOT_LLM_API_KEY=sua-chave-aqui
COPILOT_LLM_MODEL=nousresearch/hermes-3-llama-3.1-8b

# Fallback local determinístico se nenhuma chave for configurada
COPILOT_FALLBACK_RULES=true
```

### 3. Por que o Hermes Agent no Servidor Central é ideal para este projeto?
O **Hermes (Nous Hermes 2 Pro / Hermes 3)** executando no servidor central é a escolha ideal porque:
- **Function Calling & Tool Use Nativo Centralizado:** O Hermes foi treinado com tags de ferramenta (`<tool_call> {"name": "run_meet_check", "arguments": {"meetUrl": "..."}} </tool_call>`), orquestrando as ferramentas no servidor e devolvendo os comandos necessários para a interface web do usuário.
- **Soberania de Dados:** O TJPA pode subir o Hermes 3 diretamente no servidor central via **Ollama** (`ollama run hermes3`) ou **vLLM**, garantindo que nenhum dado processual ou relato de servidor saia da rede do Tribunal.
- **Estruturação JSON Rigorosa:** Evita qualquer quebra de payload ao enviar chamados enriquecidos para o GLPI via API v2.

---

## 📂 ESTRUTURA DOS DADOS DISPONÍVEIS

Todos os dados já foram gerados, validados e estão organizados na pasta:
`/home/caua/Hackton TJPA/base-dados-copilot/` (e espelhados em `TJPACORVINAL/data/copilot-dataset/`).

### 1. Máquinas da Comarca (`maquinas/` e `catalogo-computadores.json`)
- **Total:** 30 estações de trabalho de `LAB-PJE-001` a `LAB-PJE-030`.
- **Setores representados:** Secretaria, Gabinete, Distribuição, Sala de Audiência e TIC.
- **Diversidade:** Desktops Dell OptiPlex, Desktops Lenovo ThinkCentre, Desktops HP ProDesk, Notebooks Dell Latitude (audiência) e Notebooks Lenovo ThinkPad (Linux/Ubuntu para TIC).
- **Formatos:**
  - `catalogo-computadores.json`: Catálogo consolidado para rápido carregamento no seletor da UI.
  - `maquinas/LAB-PJE-XXX.md`: Fichas completas com patrimônio, processador, RAM, disco e IP.
  - `inventarios-glpi/LAB-PJE-XXX.json`: Formato nativo GLPI Agent para vinculação com o inventário do GLPI.

### 2. Chamados Brutos e Precedentes (`chamados-brutos/` e `chamados-classificados/`)
- **Total:** 30 casos realistas com problemas do cotidiano forense do TJPA.
- **Formatos:**
  - `chamados-brutos/CHAM-XXX.md`: Relato original em linguagem natural do usuário, com contexto (se há audiência iminente, link do Meet, prazo processual).
  - `chamados-classificados/CHAM-XXX.md` e `chamados-classificados.json`: Casos com a triagem do Laya/Regras aplicada (Categoria, Sistema, Urgência, Impacto, Fila de Atendimento, Incidente).

### 3. Banco de Memória do Hermes (`hermes-memory/`)
O agente possui uma estrutura de memória persistente em formato Markdown organizada em pastas, garantindo que o conhecimento procedimental, regras e histórico nunca se percam:
- **`core/`**:
  - `identidade-agente.md`: Diretrizes fundamentais de conduta, empatia forense e sigilo de dados.
  - `regras-operacionais.md`: Fluxo obrigatório de raciocínio (Chain of Thought) e limiares de escalação.
  - `catalogo-ferramentas.md`: Especificação estrita das ferramentas de Tool Calling (`run_meet_check`, `search_precedents`, `escalate_glpi_ticket`).
- **`conhecimento/`**:
  - `pje-assinador.md`: Procedimentos detalhados para PJe, PJeOffice (porta 8800), tokens A3 e cadeias ICP-Brasil.
  - `audiencias-meet.md`: Procedimentos para Google Meet, caixas Jabra, microfonia, webcams e WebRTC.
  - `infra-redes.md`: Procedimentos para Wi-Fi institucional, Ethernet, resolução de DNS e links de contingência.
  - `impressao-hardware.md`: Procedimentos para spooler travado, fontes e estações que não ligam.
  - `sistemas-corporativos.md`: Procedimentos para e-mail institucional e políticas de desbloqueio de senhas.
- **`estacoes/`**:
  - Perfis técnicos e operacionais por setor (`perfil-gabinete.md`, `perfil-secretaria.md`, `perfil-distribuicao.md`, `perfil-sala-audiencia.md`, `perfil-tic-linux.md`).
- **`historico-incidentes/`**:
  - `incidentes-recorrentes.md`: Padrões observados nos 30 chamados resolvidos e taxas de sucesso comprovadas.
- **`sessoes/`**:
  - `template-sessao.md`: Estrutura padrão para registrar os logs e metadados de cada atendimento ativo.

---

## 🔄 ARQUITETURA DO FLUXO PASSO A PASSO

### PASSO 1: Seleção e Reconhecimento da Estação
- No topo do chat do solicitante, existe um seletor rápido com chip de identificação:
  `Estação Atual: [ LAB-PJE-004 - Sala de audiência (Dell Latitude / Windows 11) ▾ ]`
- Ao selecionar a máquina, o sistema injeta no prompt de sistema da LLM:
  - Nome, modelo e processador;
  - Sistema Operacional (Windows 11 vs Ubuntu) para que a IA oriente os passos no SO correto;
  - Setor da máquina e endereço de rede.

### PASSO 2: Conversa & Classificação em Tempo Real (Laya)
- O usuário relata o problema em linguagem natural.
- O backend executa em paralelo:
  1. Chamada ao **Laya**: Extrai de forma padronizada Categoria ITIL, Sistema, Impacto, Urgência e Fila do GLPI.
  2. Consulta RAG de similaridade contra os 30 chamados resolvidos anteriores.

### PASSO 3: Resolução Recomendada Universal
- Independentemente do tipo de problema relatado:
  - **PJe / Token / Assinador:** Passos de limpeza de cache, reinicialização do PJeOffice, checagem de porta 8800 ou reinstalação de cadeia de certificados ICP-Brasil.
  - **Impressora:** Passos de cancelamento de spooler travado, verificação de cabos/rede e teste de página neutra.
  - **Rede / Internet:** Diagnóstico de cabo vs Wi-Fi, teste de gateways internos e checagem de DNS.
  - **Conta / Senha:** Fluxo de auto-redefinição e orientações de segurança.
- As instruções são entregues em formato claro, numerado e amigável.

### PASSO 4: Ferramenta Especializada de Audiência (Google Meet Tool)
- Se a mensagem contiver um link do Google Meet ou falar de audiência virtual:
  - O agente aciona a ferramenta `run_meet_check(url)`.
  - Um cartão interativo é renderizado no chat:
    ```
    ┌────────────────────────────────────────────────────────┐
    │ 📹 Diagnóstico de Audiência Virtual                    │
    │ Link identificado: https://meet.google.com/abc-defg-hij │
    │ [ Executar Teste Rápido de Microfone & Câmera ]        │
    └────────────────────────────────────────────────────────┘
    ```
  - Ao clicar, o sistema executa o teste de microfone, câmera e latência já homologado no JUDICI.A e anexa o resultado à conversa.
  - Se houver falha de permissão no navegador ou hardware inoperante, o Copilot detalha a correção exata.

### PASSO 5: Feedback e Autoatendimento
- Dois botões rápidos de ação:
  - `[ ✅ Consegui resolver! ]` ➔ Registra autoatendimento no banco e encerra com nota de satisfação.
  - `[ 🎫 Ainda preciso de ajuda / Abrir Chamado ]` ➔ Segue para o Passo 6.

### PASSO 6: Escalação Enriquecida para o GLPI
- O Copilot compila e envia para o GLPI local (`http://localhost:8080/api.php`):
  - **Título estruturado:** `[Setor] Problema relatado - Estação LAB-PJE-XXX`
  - **Corpo:**
    - Máquina: Patrimônio, Serial, Modelo, SO, IP;
    - Triagem do Laya: Categoria, Sistema, Urgência, Impacto, Prioridade calculada;
    - Fila de destino correspondente no GLPI (ex: `SUPORTE_HARDWARE` / ID 3);
    - Laudo do teste do Meet (se executado);
    - Procedimentos já tentados no autoatendimento.
  - O usuário recebe o número de protocolo do GLPI em tempo real.

---

## 🛠️ COMPONENTES A IMPLEMENTAR NO CÓDIGO

### 1. Backend (`src/`)
- **`src/copilot/llm-client.js`:**
  - Cliente HTTP para endpoints OpenAI-compatíveis (OpenRouter, Groq, Ollama, Hermes).
  - Suporte a System Prompts com injeção de contexto de hardware e catálogo de ferramentas.
  - Parser de respostas conversacionais e chamadas de ferramentas (`tool_calls`).
- **`src/copilot/data-loader.js`:**
  - Carrega `catalogo-computadores.json` e `chamados-classificados.json`.
  - Funções `getMachine(id)`, `listMachines()`, `searchPrecedents(query, category)`.
- **`src/copilot/tools.js`:**
  - Registro modular de ferramentas do agente:
    - `run_meet_check`: Tool especializada ativa para audiências.
    - Estrutura extensível pronta para novas ferramentas futuras (`check_spooler`, `verify_cert`).
- **Novas Rotas na API (`src/api.js`):**
  - `GET /api/copilot/machines`: Retorna as 30 máquinas catalogadas.
  - `POST /api/copilot/chat`: Processa a mensagem do usuário com Laya + LLM Conversacional + RAG.
  - `POST /api/copilot/escalate`: Cria o chamado no GLPI via `glpi-v2-client`.

### 2. Frontend (`public/`)
- **Modernização da Central de Atendimento:**
  - Criação de componente de Chat em `public/pages/copilot-chat.js`.
  - Seletor de máquina com visual de chip no topo.
  - Histórico de mensagens fluido com suporte a Markdown.
  - Cartões interativos (Cartão de Ferramenta do Meet, Cartão de Precedente, Cartão de Solução Recomendada).
  - Modal ou integração direta com o módulo de teste de audiência existente.

---

## 🏆 DIFERENCIAIS COMPETITIVOS PARA O HACKATHON

1. **Abordagem Universal com Especialização Modular:** Resolve qualquer problema comum de TIC, mas possui ganchos profundos de ferramenta para casos críticos de audiência.
2. **Arquitetura Agêntica de Ponta (Hermes / Tool Calling):** Demonstra uso de padrões modernos de IA (RAG + Tool Calling + Structured Outputs) em vez de um simples chatbot de texto.
3. **Soberania e Flexibilidade de Modelo:** O avaliador pode usar a API configurada (Groq, OpenAI, Hermes no Ollama) ou o fallback de regras, provando robustez contra falhas de conexão.
4. **Resolução Real de Gargalos de TI:** Elimina o vaivém de perguntas entre suporte e usuário, reduzindo o tempo de primeiro atendimento em até 80%.
