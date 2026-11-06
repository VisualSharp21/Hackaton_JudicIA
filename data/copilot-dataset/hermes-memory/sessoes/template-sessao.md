# TEMPLATE DE SESSÃO ATIVA DO HERMES COPILOT

## Metadados do Atendimento
- **ID da Sessão:** `{session_id}`
- **Data e Hora de Início:** `{timestamp_inicio}`
- **Estação de Trabalho Conectada:** `{machine_id}` (`{machine_model}` / `{os}`)
- **Setor do Solicitante:** `{machine_sector}`
- **Status do Atendimento:** `EM_ANDAMENTO | RESOLVIDO_AUTOATENDIMENTO | ESCALADO_GLPI`

## Triagem do Laya
- **Categoria Identificada:** `{category}`
- **Sistema Alvo:** `{system}`
- **Nível de Urgência:** `{urgency}`
- **Prioridade Calculada:** `{priority}`

## Ferramentas Acionadas (Tool Use)
- **Ferramenta:** `{tool_name}`
- **Parâmetros Enviados:** `{tool_arguments}`
- **Laudo Retornado:** `{tool_output}`

## Histórico de Interação
- **Usuário:** `{user_message_1}`
- **Hermes Copilot:** `{agent_message_1}`

## Desfecho
- **Resolução Confirmada pelo Usuário?** `Sim / Não`
- **Protocolo GLPI Gerado:** `{glpi_ticket_id_ou_null}`
