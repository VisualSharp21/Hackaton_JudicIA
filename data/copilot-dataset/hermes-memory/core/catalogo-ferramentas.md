# MEMÓRIA CENTRAL: CATÁLOGO DE FERRAMENTAS DO AGENTE (TOOL CALLING)

O modelo Hermes foi treinado para emitir chamadas de ferramenta estruturadas utilizando o bloco `<tool_call>`. Abaixo está a especificação das ferramentas integradas no servidor central:

---

### Ferramenta 1: `run_meet_check`
- **Descrição:** Executa o diagnóstico de pré-audiência virtual no navegador do usuário, testando permissões WebRTC, captação de microfone, transmissão de câmera, DNS e latência de rede/Zabbix.
- **Quando usar:** Quando a mensagem contiver link `meet.google.com`, palavras como "audiência", "videoconferência", "depoimento", "oitiva" ou queixas de áudio/vídeo em sala de audiência.
- **Parâmetros:**
  ```json
  {
    "type": "object",
    "properties": {
      "meetUrl": { "type": "string", "description": "URL da sala do Google Meet informada pelo solicitante" },
      "machineId": { "type": "string", "description": "Identificador da estação de trabalho (ex: LAB-PJE-004)" }
    },
    "required": ["machineId"]
  }
  ```

---

### Ferramenta 2: `search_precedents`
- **Descrição:** Consulta o acervo histórico dos chamados resolvidos do TJPA por similaridade semântica para resgatar precedentes de suporte comprovados.
- **Parâmetros:**
  ```json
  {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Termos de busca ou sintomas relatados" },
      "category": { "type": "string", "description": "Categoria ITIL sugerida pelo Laya" },
      "system": { "type": "string", "description": "Sistema alvo (ex: PJE, PRINTER, NETWORK)" }
    },
    "required": ["query"]
  }
  ```

---

### Ferramenta 3: `escalate_glpi_ticket`
- **Descrição:** Transfere a demanda não resolvida para o GLPI 11 via API v2 com enriquecimento de dados da estação, laudo de ferramentas e histórico da conversa.
- **Parâmetros:**
  ```json
  {
    "type": "object",
    "properties": {
      "machineId": { "type": "string", "description": "Identificador da máquina (ex: LAB-PJE-004)" },
      "category": { "type": "string", "description": "Categoria ITIL (ex: HARDWARE, SYSTEM)" },
      "queue": { "type": "string", "description": "Fila GLPI (ex: SUPORTE_HARDWARE, SUPORTE_PJE)" },
      "priority": { "type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
      "title": { "type": "string", "description": "Título resumido do chamado" },
      "technicalSummary": { "type": "string", "description": "Relatório estruturado com laudo e testes executados" }
    },
    "required": ["machineId", "category", "queue", "priority", "title", "technicalSummary"]
  }
  ```
