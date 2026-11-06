# Operação preventiva integrada

As melhorias foram implementadas no JUDICI.A existente, usando Node, MariaDB por organização, scheduler T−30, registros transacionais e auditoria já disponíveis. Não há backend Python, dependência nova, serviço adicional ou migração de arquitetura. Os registros complementares usam a tabela `prevention_records` já criada pela migration de prevenção.

## Uso na interface principal

Abra `http://localhost:5173/audiencias/` e atualize a página.

- **Central de Audiências**: avisos internos de problema coletivo e normalização, ocorrências associadas e andamento do suporte.
- **Detalhes da audiência**: plano de contingência com responsável, situação, evidência e horário; apoio local cadastrado; nova verificação pelo backend; Copilot contextualizado.
- **Incidentes**: as ocorrências coletivas da prevenção aparecem junto ao agrupamento de chamados que já existia.
- **Chamados**: busca, filtros de situação/prioridade/comarca/prazo, ordenação e destaque de prazo próximo/excedido. A prioridade informa impacto e urgência. As metas vêm de Piloto e SLAs e não recebem valores arbitrários.
- **Relatório executivo**: seleção explícita REAL/DEMO e período de 7, 30 ou 90 dias, impressão/PDF e exportação JSON. Contabiliza audiências iniciadas no período; não chama sessões futuras de realizadas.
- **Apoio local e radar preventivo**: validade de certificados informada pela TIC, responsáveis/capacitações, mudanças aplicadas e recorrência de falhas para orientar revisão de infraestrutura e capacitação.
- **Piloto e SLAs**: resumo dos resultados observados da prevenção, mantendo as métricas de atendimento existentes.

## Ocorrência coletiva

O worker correlaciona falhas de conectividade, DNS, latência, perda de pacotes e itens de rede do Zabbix. São exigidas evidências com até 15 minutos, em pelo menos duas estações distintas da mesma comarca e origem. Duas audiências no mesmo computador não bastam. REAL e DEMO nunca formam uma ocorrência conjunta.

A correlação é uma hipótese de causa comum, não confirmação de indisponibilidade da comarca inteira. Falha isolada em um serviço TCP ou periférico não prova falha coletiva da rede.

Cada audiência mantém seu diagnóstico e sua execução. A ocorrência reúne os vínculos, os avisos e o atendimento. Escalações pendentes ou bloqueadas sem POST remoto em andamento podem ser vinculadas ao atendimento principal. Envios confirmados ou ambíguos conservam suas identidades: não se apagam chamados já enviados para simular deduplicação. O corpo do atendimento principal inclui as audiências/evidências correlacionadas disponíveis no momento do envio. Evidências novas posteriores permanecem no histórico do JUDICI.A; esta alteração não adiciona atualização remota de chamados já enviados.

O Copilot da audiência recebe a ocorrência e o plano de contingência. No Atendimento N1, relatos de rede da comarca com ocorrência aberta são associados à ocorrência; uma solicitação de escalação desse relato reutiliza o chamado confirmado ou informa que aguarda confirmação. Outros sintomas não são associados automaticamente apenas por pertencerem à mesma comarca.

## Contingência e pós-incidente

As etapas acompanham o acionamento do responsável local, avaliação de sala alternativa, equipamento reserva, contingência de rede autorizada e comunicação à equipe. Registrar “concluída” é um relato da equipe com evidência; não executa comandos nem altera rede, agenda ou hardware.

Somente TIC registra etapas, confirma normalização e revisa o relatório pós-incidente. Gestores acompanham os dados e geram relatórios. Solicitantes veem apenas suas audiências e o resumo das ocorrências correspondentes, sem evidências de outras sessões. Revisões concorrentes de planos/relatórios são protegidas por versão.

O encerramento exige solução/evidência, publica aviso interno e gera um **rascunho** contendo duração observada, sessões potencialmente afetadas, evidências, timeline, procedimentos e recomendação de prevenção. A revisão técnica é uma ação explícita. Encerrar a ocorrência não declara automaticamente que a sala está pronta e não fecha chamados remotos no GLPI. Envios locais ainda pendentes são cancelados; uma falha com evidência nova pode gerar uma nova ocorrência.

## Dados complementares e limites

Certificados: somente identificação técnica, validade e fonte fornecidas pela TIC. O radar calcula dias restantes a partir desse cadastro; não lê certificados, senhas, tokens ou chaves privadas dos equipamentos.

Mudanças: comparação de audiências distintas com falha no componente, usando o histórico de verificações nas três horas anteriores/posteriores. A janela posterior precisa terminar. Com pelo menos cinco sessões após a mudança e aumento superior a 50% sobre uma base anterior não nula, aparece uma associação temporal para investigação. Não se afirma causalidade. Sem base suficiente, isso é informado.

Apoio local: contatos institucionais e capacitações cadastradas pela TIC, apresentados na audiência da mesma comarca/origem. Não há inferência de disponibilidade atual nem acionamento externo automático.

Recorrência: três ou mais audiências distintas com falha no mesmo componente/estação em 30 dias sugerem revisão de infraestrutura e orientação por procedimento validado. Não se atribui automaticamente a causa a erro do usuário.

Prazos: metas atuais de resolução por prioridade em tempo corrido, com destaque no último quarto do prazo. Não implementam calendário, pausas, feriados ou SLA oficial do GLPI. Sem meta configurada aparece “Sem meta”. Encerrados sem marco observado não ganham conclusão artificial de cumprimento.

Avisos desta entrega são internos. Não foram enviados e-mails, mensagens de Teams ou WhatsApp. Não são estimadas economia financeira, horas perdidas, audiências “salvas” ou índice arbitrário de equidade.

## Apresentação DEMO

Com `DEMO_MODE=true`, o botão **Apresentação DEMO guiada** prepara, de forma idempotente, duas audiências sintéticas de rede em estações distintas. O servidor cria a agenda; o scheduler faz os diagnósticos em seu próximo tick, sem diagnóstico disparado pelo navegador. O roteiro conduz a agenda, falha, precedente, Copilot, ocorrência coletiva e contingência. O roteiro não executa procedimentos em estações REAL.

O ciclo coletivo tem marcador persistente de 40 minutos. Reiniciar o roteiro nesse período reaproveita as sessões. A agenda DEMO original e seus cenários continuam disponíveis.

## Verificação

- `npm test`: regressão do Copilot, prevenção, memória, API, operação coletiva, MariaDB e sessões autenticadas em banco temporário. A verificação autenticada cobre associação de relatos e reutilização de chamado coletivo sem criar outro ticket.
- `npm run test:operations`: correlação, deduplicação, autorização, isolamento de dados, contingência, revisões, relatórios, cadastros e regras de prazo/filtro.
- `node scripts/test-prevention-browser.mjs`: Chrome headless com perfil isolado; SSE, detalhes, roteiro, ocorrência coletiva, formulário de contingência, encerramento/revisão, relatório executivo, radar e layout desktop/móvel. O servidor temporário do teste é encerrado ao final.

Os testes de domínio/HTTP usam fixtures ou dados DEMO. GLPI institucional, Zabbix institucional, provedor LLM e hardware físico não foram exercitados ao vivo nesta entrega.
