import fs from 'node:fs';
import path from 'node:path';

const DATASET = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../data/copilot-dataset');

const computadores = JSON.parse(fs.readFileSync(path.join(DATASET, 'catalogo-computadores.json'), 'utf-8'));

const relatos = [
  // 1. Secretaria - Windows - Dell
  {
    titulo: "PJeOffice não conecta ao assinar mandado de citação",
    relato: "Estou tentando assinar cinco mandados urgentes de citação aqui na Secretaria da 1ª Vara, mas quando clico em 'Assinar' no PJe, aparece a mensagem 'Não foi possível conectar ao PJeOffice'. O ícone do PJeOffice até aparece perto do relógio, mas o navegador Firefox fica dizendo que o serviço local na porta 8800 não está respondendo. Já reiniciei o navegador e nada.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "08:45", prazo_processual: "Hoje até 12h" }
  },
  // 2. Gabinete - Windows - Lenovo
  {
    titulo: "Lentidão ao abrir minutas de sentenças volumosas no PJe",
    relato: "Bom dia. No gabinete estamos com muita dificuldade para abrir os autos conclusos com mais de 300 páginas. A tela do PJe fica com a mensagem 'Carregando documento...' por quase 3 minutos e várias vezes dá tela branca. Outros sites abrem normalmente.",
    detalhes: { urgencia_usuario: "Média", horario_relato: "09:10", prazo_processual: "Não imediato" }
  },
  // 3. Distribuição - Windows - HP
  {
    titulo: "Impressora de mandados e etiquetas travada com documentos na fila",
    relato: "A impressora do setor de distribuição parou de imprimir de repente. Tem mais de 12 certidões e mandados na fila de impressão com status 'Erro - Imprimindo' e ninguém consegue imprimir nada. A impressora está com as luzes acesas normais, mas nada sai.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "09:25", prazo_processual: "Atendimento ao público" }
  },
  // 4. Sala de audiência - Windows Notebook - Dell
  {
    titulo: "Microfone não funciona no Google Meet na sala de audiência",
    relato: "SOCORRO! Temos uma audiência de instrução e julgamento agendada para as 10:00 pelo Google Meet (link: https://meet.google.com/abc-defg-hij). Entramos na sala agora para testar e ninguém nos ouve. O notebook Dell Latitude não está captando nossa voz nem pelo microfone interno nem pela caixinha Jabra USB conectada.",
    detalhes: { urgencia_usuario: "Crítica", horario_relato: "09:40", audiencia_em: "10:00 (em 20 minutos)", link_audiencia: "https://meet.google.com/abc-defg-hij" }
  },
  // 5. TIC - Ubuntu - Lenovo
  {
    titulo: "Falha na sincronização do repositório local e VPN de contingência",
    relato: "Estação de TIC com Ubuntu 24.04: após a última atualização do pacote de certificados corporativos, o cliente OpenVPN conecta mas não resolve a rota interna para o gateway de administração do PJe (10.20.0.1).",
    detalhes: { urgencia_usuario: "Média", horario_relato: "10:05", perfil_tecnico: true }
  },
  // 6. Secretaria - Windows - Dell
  {
    titulo: "Token do certificado digital A3 não é reconhecido pelo Windows",
    relato: "Coloquei meu token USB azul do certificado digital da OAB/Certisign na porta USB frontal do computador, mas a luz vermelha não acende e o SafeSign não mostra o certificado. Ontem estava funcionando perfeitamente.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "10:15", prazo_processual: "Assinatura de certidão" }
  },
  // 7. Gabinete - Windows - Lenovo
  {
    titulo: "Mensagem de erro de sessão expirada no PJe a cada 5 minutos",
    relato: "O assessor está redigindo os votos e a cada 5 ou 10 minutos aparece um pop-up 'Sua sessão expirou, faça login novamente'. Já perdeu dois parágrafos de texto digitado duas vezes hoje.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "10:30", prazo_processual: "Sessão de julgamento hoje à tarde" }
  },
  // 8. Distribuição - Windows - HP
  {
    titulo: "Queda na conexão de rede e internet no balcão de atendimento",
    relato: "O computador da recepção/distribuição perdeu conexão com a rede. No cantinho da barra de tarefas aparece um ícone de globo com um corte. Não abre nem o PJe, nem o e-mail institucional e nem o portal do TJPA.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "10:45", balcao: "Fila de advogados presencial" }
  },
  // 9. Sala de audiência - Windows Notebook - Dell
  {
    titulo: "Câmera travando com tela preta durante videoconferência no Meet",
    relato: "No notebook da Sala de Audiências 2, quando entramos na sala do Google Meet (https://meet.google.com/xyz-uvwx-rst), a imagem da câmera integrada aparece por 2 segundos e depois congela ou fica com tela preta. O juiz já está presente na sala virtual.",
    detalhes: { urgencia_usuario: "Crítica", horario_relato: "10:55", audiencia_em: "11:00 (em 5 minutos)", link_audiencia: "https://meet.google.com/xyz-uvwx-rst" }
  },
  // 10. TIC - Ubuntu - Lenovo
  {
    titulo: "Instalação do PJeOffice Pro não conclui dependência Java no Ubuntu",
    relato: "Ao rodar o script de instalação do pjeoffice-pro no Ubuntu 24.04 LTS da bancada de testes, acusa incompatibilidade com o OpenJDK 21 padrão do sistema e o daemon do pjeoffice não sobe no systemd.",
    detalhes: { urgencia_usuario: "Baixa", horario_relato: "11:15", perfil_tecnico: true }
  },
  // 11. Secretaria - Windows - Dell
  {
    titulo: "E-mail institucional com caixa de entrada cheia e rejeitando recebimento",
    relato: "Não estou recebendo as intimações por e-mail no Zimbra/Outlook institucional. Vários advogados ligaram dizendo que receberam mensagem de 'Mailbox quota exceeded' (552 Mailbox size limit exceeded). Preciso liberar espaço urgente.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "11:30", prazo_processual: "Intimações do dia" }
  },
  // 12. Gabinete - Windows - Lenovo
  {
    titulo: "Monitor secundário do gabinete não dá sinal de vídeo",
    relato: "O juiz utiliza duas telas para comparar as petições e sentenças. Hoje cedo a segunda tela conectada pelo cabo HDMI/DisplayPort não liga de jeito nenhum, fica apenas com a luz laranja piscando e mensagem 'No Signal'.",
    detalhes: { urgencia_usuario: "Média", horario_relato: "11:45", gabinete_ativo: true }
  },
  // 13. Distribuição - Windows - HP
  {
    titulo: "Computador não liga após queda de energia no prédio",
    relato: "Teve uma queda rápida de energia aqui no fórum há meia hora. Todos os computadores religaram, menos o HP ProDesk da Distribuição 2. Ao apertar o botão de ligar não acende nenhuma luz e nem o ventilador da fonte gira.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "12:00", equipamento_parado: true }
  },
  // 14. Sala de audiência - Windows Notebook - Dell
  {
    titulo: "Eco e retorno insuportável no áudio do Google Meet na sala de audiência",
    relato: "Estamos no link https://meet.google.com/aud-vara-001 fazendo audiência preliminar. Toda vez que o juiz ou o promotor fala, o áudio volta com um eco estridente e ensurdecedor para quem está participando de casa pelo celular. Está impossível continuar a sessão.",
    detalhes: { urgencia_usuario: "Crítica", horario_relato: "13:30", audiencia_em: "Em andamento", link_audiencia: "https://meet.google.com/aud-vara-001" }
  },
  // 15. TIC - Ubuntu - Lenovo
  {
    titulo: "Erro de permissão no script de pré-diagnóstico do TJPA em ambiente Linux",
    relato: "Ao executar o script de pré-diagnóstico via terminal bash no notebook de suporte Ubuntu, o comando falha ao tentar ler a interface wireless sem privilégios de rede.",
    detalhes: { urgencia_usuario: "Baixa", horario_relato: "13:45", perfil_tecnico: true }
  },
  // 16. Secretaria - Windows - Dell
  {
    titulo: "Senha do Windows ou da rede expirou e usuário bloqueado",
    relato: "Voltei do almoço e quando fui desbloquear a tela do computador apareceu a mensagem: 'Sua senha expirou e deve ser alterada'. Tentei colocar uma nova senha mas disse que não atende aos requisitos de complexidade do domínio do TJPA e agora a conta bloqueou por excesso de tentativas.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "14:00", servidor_parado: true }
  },
  // 17. Gabinete - Windows - Lenovo
  {
    titulo: "Falha de validação da cadeia de certificados no PJe",
    relato: "Ao assinar uma decisão interlocutória, o sistema acusa 'Cadeia de certificação raiz não confiável (ICP-Brasil v5 / v10)'. O token é novo e foi emitido semana passada.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "14:15", prazo_processual: "Decisão liminar" }
  },
  // 18. Distribuição - Windows - HP
  {
    titulo: "Scanner de digitalização de peças físicas parou de comunicar",
    relato: "O scanner Fujitsu acoplado no ProDesk da distribuição não é reconhecido pelo software de digitalização. Ao clicar em 'Digitalizar petição', informa que o scanner está desligado ou ocupado por outro aplicativo.",
    detalhes: { urgencia_usuario: "Média", horario_relato: "14:30", autos_fisicos: true }
  },
  // 19. Sala de audiência - Windows Notebook - Dell
  {
    titulo: "Navegador bloqueou a permissão de câmera e microfone no Google Meet",
    relato: "Abrimos o link https://meet.google.com/tjp-audi-019 e apareceu um aviso vermelho no topo do Chrome dizendo que a câmera e o microfone estão bloqueados para este site. Clicamos em tentar novamente mas o botão fica desativado.",
    detalhes: { urgencia_usuario: "Crítica", horario_relato: "14:40", audiencia_em: "15:00 (em 20 minutos)", link_audiencia: "https://meet.google.com/tjp-audi-019" }
  },
  // 20. TIC - Ubuntu - Lenovo
  {
    titulo: "Inconsistência de resolução DNS interna para o domínio tjpa.jus.br",
    relato: "Estação de TIC detectou que consultas ao servidor DNS primário (10.1.1.10) estão com timeout intermitente na zona judicia.example.test / tjpa.jus.br, causando lentidão na abertura do portal.",
    detalhes: { urgencia_usuario: "Média", horario_relato: "15:00", perfil_tecnico: true }
  },
  // 21. Secretaria - Windows - Dell
  {
    titulo: "Navegador Google Chrome fecha sozinho ao carregar visualizador de PDF do PJe",
    relato: "Toda vez que vou abrir um arquivo PDF com mais de 50 páginas anexado no processo dentro do PJe, a aba do Google Chrome trava e o navegador fecha sozinho de repente ('Ah, não! Ocorreu um erro').",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "15:15", expediente: "Secretaria" }
  },
  // 22. Gabinete - Windows - Lenovo
  {
    titulo: "Assinador em lote do PJe trava na metade da lista de processos",
    relato: "O magistrado selecionou 40 despachos para assinar em lote. O sistema assinou os primeiros 18 e depois ficou em loop infinito na barra de progresso. Não dá erro e não conclui.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "15:30", assinatura_em_lote: true }
  },
  // 23. Distribuição - Windows - HP
  {
    titulo: "Teclado e mouse congelando após alguns minutos de uso",
    relato: "Na máquina da distribuição, o ponteiro do mouse fica travando em câmera lenta e o teclado engole letras ou repete caracteres ('ssssss'). Se tirar o cabo USB e colocar de novo volta por 1 minuto e depois trava de novo.",
    detalhes: { urgencia_usuario: "Média", horario_relato: "15:45", atendimento_prejudicado: true }
  },
  // 24. Sala de audiência - Windows Notebook - Dell
  {
    titulo: "Wi-Fi oscilando e desconectando durante audiência pelo Meet",
    relato: "O notebook da sala 4 está conectado pelo Wi-Fi 'TJPA-CORPORATIVO'. A cada 10 minutos a conexão cai, a tela do Google Meet (https://meet.google.com/seg-aud-024) trava e os participantes ficam robóticos. Tem um cabo de rede azul sobrando na bancada mas não sabemos se funciona.",
    detalhes: { urgencia_usuario: "Crítica", horario_relato: "16:00", audiencia_em: "Em andamento", link_audiencia: "https://meet.google.com/seg-aud-024" }
  },
  // 25. TIC - Ubuntu - Lenovo
  {
    titulo: "Verificação de conectividade com a API do GLPI 11 via cURL no Linux",
    relato: "Ambiente de testes da equipe técnica: o token OAuth2 obtido via client credentials expira e a renovação automática falha quando a chamada HTTP retorna HTTP 401 por cabeçalho malformado.",
    detalhes: { urgencia_usuario: "Baixa", horario_relato: "16:15", perfil_tecnico: true }
  },
  // 26. Secretaria - Windows - Dell
  {
    titulo: "Alerta de pouco espaço no disco C: impedindo download de autos",
    relato: "Apareceu uma notificação vermelha no Windows dizendo 'Pouco espaço em disco - Você está ficando sem espaço no disco local (C:)'. Fui tentar baixar a cópia integral de um processo de júri e deu falha no download por falta de espaço.",
    detalhes: { urgencia_usuario: "Média", horario_relato: "16:30", disco_cheio: true }
  },
  // 27. Gabinete - Windows - Lenovo
  {
    titulo: "Áudio do juiz não sai nas caixas acústicas da sala do gabinete",
    relato: "O juiz está participando de uma reunião administrativa de diretoria pelo computador do gabinete, ele consegue nos ouvir pelos fones, mas quando desliga os fones para colocar no som ambiente da sala, não sai nenhum som nas caixas externas.",
    detalhes: { urgencia_usuario: "Média", horario_relato: "16:45", reuniao: true }
  },
  // 28. Distribuição - Windows - HP
  {
    titulo: "Erro de 'Bad Gateway 502' ao consultar tabela de custas no portal",
    relato: "Estamos no balcão calculando as guias de recolhimento de custas para distribuição de uma ação de cobrança, mas ao clicar no módulo de emissão de boletos bancários da página do tribunal dá página branca com '502 Bad Gateway'.",
    detalhes: { urgencia_usuario: "Alta", horario_relato: "17:00", atendimento_externo: true }
  },
  // 29. Sala de audiência - Windows Notebook - Dell
  {
    titulo: "Notebook desligou sozinho no meio do depoimento da ré na audiência",
    relato: "URGÊNCIA MÁXIMA: Estávamos no meio do depoimento na audiência virtual (https://meet.google.com/urg-vara-029). O notebook Dell Latitude estava sem a fonte de energia na tomada (apenas na bateria) e desligou repentinamente. Ligamos na tomada agora e precisamos retomar imediatamente a sala do Meet.",
    detalhes: { urgencia_usuario: "Crítica", horario_relato: "17:10", audiencia_em: "Interrompida abruptamente", link_audiencia: "https://meet.google.com/urg-vara-029" }
  },
  // 30. TIC - Ubuntu - Lenovo
  {
    titulo: "Certificado TLS autoassinado impedindo chamadas do webhook do Zabbix",
    relato: "O servidor de monitoramento Zabbix está tentando enviar alertas de telemetria para o endpoint /api/telemetry do JUDICI.A, mas acusa erro de SSL Handshake 'certificate verify failed' devido à autoridade certificadora interna.",
    detalhes: { urgencia_usuario: "Média", horario_relato: "17:25", perfil_tecnico: true }
  }
];

const outputDir = path.join(DATASET, 'chamados-brutos');
fs.mkdirSync(outputDir, { recursive: true });

const chamadosConsolidados = [];

relatos.forEach((item, index) => {
  const comp = computadores[index];
  const numStr = String(index + 1).padStart(3, '0');
  const chamadoId = `CHAM-2026-${numStr}`;

  const chamadoData = {
    id: chamadoId,
    titulo: item.titulo,
    relato: item.relato,
    computador: {
      nome: comp.nome,
      patrimonio: comp.patrimonio,
      serial: comp.serial,
      modelo: `${comp.fabricante} ${comp.modelo} (${comp.tipo})`,
      sistema_operacional: `${comp.sistema_operacional} ${comp.versao_so}`,
      setor: comp.setor,
      unidade: comp.unidade,
      ip: comp.ip_documentacao,
      mac: comp.mac,
      responsavel_ficticio: comp.responsavel_ficticio
    },
    detalhes_contexto: item.detalhes,
    classificacao: null // Pendente de classificação pelo Laya
  };

  chamadosConsolidados.push(chamadoData);

  const mdContent = `# Chamado: ${chamadoId}

## Informações do Solicitante e Estação
- **Identificador do Chamado:** ${chamadoId}
- **Título Relatado:** ${item.titulo}
- **Computador Vinculado:** ${comp.nome} (${comp.fabricante} ${comp.modelo})
- **Patrimônio:** ${comp.patrimonio} | **Serial:** ${comp.serial}
- **Sistema Operacional:** ${comp.sistema_operacional} ${comp.versao_so} (${comp.arquitetura})
- **Localização:** ${comp.unidade} — Setor: ${comp.setor}
- **Usuário Solicitante:** ${comp.responsavel_ficticio}
- **Endereço de Rede:** IP ${comp.ip_documentacao} | MAC ${comp.mac}

---

## Relato do Usuário (Texto Bruto)
> "${item.relato}"

---

## Contexto Adicional do Atendimento
${Object.entries(item.detalhes).map(([k, v]) => `- **${k}:** ${v}`).join('\n')}

---

## Estado da Classificação
- **Status:** PENDENTE_CLASSIFICACAO_LAYA
- **Categoria Técnica:** [Aguardando Laya]
- **Sistema Alvo:** [Aguardando Laya]
- **Nível de Urgência:** [Aguardando Laya]
- **Nível de Impacto:** [Aguardando Laya]
- **Indício de Incidente Coletivo:** [Aguardando Laya]
- **Ação Recomendada:** [Aguardando Classificação e Consulta ao Histórico]
`;

  const fileName = `CHAM-${numStr}.md`;
  fs.writeFileSync(path.join(outputDir, fileName), mdContent, 'utf-8');
});

// Salvar também o arquivo JSON com a lista completa para o classificador automatizado
fs.writeFileSync(
  path.join(DATASET, 'chamados-brutos.json'),
  JSON.stringify(chamadosConsolidados, null, 2),
  'utf-8'
);

console.log(`Gerados com sucesso 30 chamados brutos em:
- ${outputDir}
- Arquivo consolidado: data/copilot-dataset/chamados-brutos.json`);
