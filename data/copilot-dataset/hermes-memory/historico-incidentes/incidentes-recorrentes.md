# MEMÓRIA HISTÓRICA: PADRÕES DE INCIDENTES E PRECEDENTES DE SUPORTE

Esta memória consolida os padrões observados nos 30 chamados resolvidos da comarca para subsidiar o RAG do Hermes:

---

### Precedente 1: Falha de Permissão de Câmera/Microfone em Audiência (Casos CHAM-004, CHAM-009, CHAM-019)
- **Causa Raiz:** O Google Chrome atualizou e redefiniu a política de permissões de mídia para sites recém-abertos ou a caixinha Jabra USB estava conectada em hub sem energia suficiente.
- **Resolução Comprovada:**
  1. Clicar no ícone de opções do site (ao lado de `https://meet.google.com`) e forçar "Microfone: Permitir".
  2. Conectar a caixinha Jabra USB diretamente na porta USB principal do notebook Dell.
  3. Taxa de resolução em autoatendimento: 88%.

---

### Precedente 2: WebSocket do PJeOffice Recusado no Firefox (Casos CHAM-001, CHAM-007, CHAM-022)
- **Causa Raiz:** Conflito de processo zumbi do Java retendo a porta 8800 em segundo plano.
- **Resolução Comprovada:**
  1. Finalizar o processo `pjeOffice.exe` pelo Gerenciador de Tarefas.
  2. Iniciar o PJeOffice Pro a partir do atalho da área de trabalho.
  3. Recarregar a aba do PJe sem cache (`Ctrl + F5`).

---

### Precedente 3: Fila de Impressão Travada com Documentos Corrompidos (Casos CHAM-003, CHAM-018)
- **Causa Raiz:** Arquivo PDF com fonte corrompida bloqueou o spooler de impressão da HP ProDesk.
- **Resolução Comprovada:**
  1. Reiniciar o serviço `Spooler de Impressão`.
  2. Excluir os arquivos `.SHD` e `.SPL` da pasta `System32\Spool\Printers`.
  3. Desligar e ligar a impressora.

---

### Precedente 4: Queda Coletiva de Link / DNS Interno (Casos CHAM-008, CHAM-020, CHAM-024)
- **Causa Raiz:** Oscilação no enlace de fibra da operadora para o prédio da comarca ou timeout do servidor DNS secundário.
- **Resolução Comprovada:**
  1. Identificação imediata como Incidente Coletivo de Rede (não é falha de hardware individual).
  2. Orientação para comutação para o link 4G de contingência da sala de audiências.
  3. Abertura prioritária para o plantão de infraestrutura do TJPA.
