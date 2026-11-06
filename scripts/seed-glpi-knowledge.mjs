import { createGlpiV2Client } from '../src/ticketing/glpi-v2-client.js';

const resource = '/Knowledgebase/Article';
const articles = [
  {
    name: 'Acesso ao PJe: falha no login ou página não abre',
    description: 'Orientações iniciais para recuperar o acesso ao PJe.',
    content: '<p>Use estas verificações quando o PJe não abrir ou apresentar erro de acesso.</p><ol><li>Confirme se está usando o endereço institucional correto do PJe.</li><li>Verifique se a internet e outros serviços institucionais estão acessíveis.</li><li>Feche e reabra o navegador; se persistir, teste uma janela privada ou outro navegador autorizado.</li><li>Anote o horário, a mensagem de erro e a comarca. Não envie senha, token ou dados de processo no chamado.</li><li>Se outras pessoas da unidade também estiverem afetadas ou houver prazo/audiência em risco, abra chamado e informe o impacto.</li></ol>',
  },
  {
    name: 'PJe lento ou indisponível para a unidade',
    description: 'Como identificar e reportar lentidão ou indisponibilidade do PJe.',
    content: '<p>Estas verificações ajudam a diferenciar uma falha individual de uma indisponibilidade coletiva.</p><ol><li>Registre desde quando o problema ocorre e quais funções do PJe estão indisponíveis.</li><li>Verifique se outros serviços institucionais abrem normalmente.</li><li>Confirme com colegas se o problema atinge mais pessoas, sem compartilhar dados de processo.</li><li>Evite repetir operações de protocolo ou envio enquanto não souber se foram concluídas.</li><li>Abra chamado com horário, comarca, mensagem de erro e quantidade aproximada de pessoas afetadas; sinalize audiência ou prazo em risco.</li></ol>',
  },
  {
    name: 'Impressora não imprime ou documento fica na fila',
    description: 'Verificações básicas para falhas de impressão.',
    content: '<p>Faça as verificações abaixo sem imprimir documentos com dados sigilosos como teste.</p><ol><li>Confirme se a impressora está ligada, sem alerta de papel ou toner, e conectada à rede ou ao computador.</li><li>Confira se a impressora correta foi selecionada e se o trabalho aparece na fila.</li><li>Se autorizado, cancele apenas o trabalho parado e tente imprimir uma página de teste sem dados pessoais.</li><li>Reinicie a impressora somente se não houver trabalho em andamento de outra pessoa.</li><li>Se continuar, informe comarca, identificação patrimonial da impressora e mensagem apresentada; não inclua conteúdo de documento judicial.</li></ol>',
  },
  {
    name: 'Internet ou rede instável na unidade',
    description: 'Diagnóstico inicial de conexão de rede e Wi-Fi.',
    content: '<p>Use estas etapas para relatar falhas de conectividade com segurança.</p><ol><li>Verifique se o problema ocorre em um único equipamento ou em várias pessoas da unidade.</li><li>Confira cabos e conexão Wi-Fi sem alterar configurações administrativas do equipamento.</li><li>Teste um serviço institucional autorizado e anote o horário e a mensagem apresentada.</li><li>Não desligue antivírus, firewall, VPN ou outros controles de segurança para tentar contornar a falha.</li><li>Abra chamado informando comarca, quantidade aproximada de pessoas afetadas e serviços indisponíveis.</li></ol>',
  },
  {
    name: 'Senha expirada ou conta bloqueada',
    description: 'Orientação para recuperar o acesso à conta institucional.',
    content: '<p>Proteja suas credenciais durante a recuperação de acesso.</p><ol><li>Confira se o usuário foi digitado corretamente e se Caps Lock está desligado.</li><li>Use somente o fluxo institucional autorizado de recuperação ou redefinição de senha.</li><li>Não informe senha, código de autenticação ou token a outra pessoa, inclusive ao suporte.</li><li>Se a conta estiver bloqueada ou a recuperação falhar, abra chamado com seu usuário institucional e comarca, sem incluir senhas.</li></ol>',
  },
  {
    name: 'E-mail institucional não envia ou não recebe mensagens',
    description: 'Verificações iniciais para falhas no e-mail institucional.',
    content: '<p>Verifique o serviço e registre informações técnicas sem expor mensagens sigilosas.</p><ol><li>Confirme se a internet e outros serviços institucionais estão acessíveis.</li><li>Recarregue a página ou reinicie o aplicativo autorizado e verifique se há aviso de armazenamento cheio.</li><li>Confira destinatário e anexo sem reenviar conteúdo sensível para endereços pessoais.</li><li>Anote horário, mensagem de erro e se a falha ocorre no envio, recebimento ou ambos.</li><li>Se persistir, abra chamado com a comarca e a mensagem técnica; não anexe conteúdo confidencial do e-mail.</li></ol>',
  },
];

const client = createGlpiV2Client();
const existingResponse = await client.api(`${resource}?start=0&limit=100&language=pt_BR`);
const existing = Array.isArray(existingResponse)
  ? existingResponse
  : existingResponse?.data || existingResponse?.items || [];
const knownNames = new Set(existing.map((item) => item.name));

for (const article of articles) {
  if (knownNames.has(article.name)) {
    console.log(`Já existe: ${article.name}`);
    continue;
  }
  const result = await client.api(`${resource}?language=pt_BR`, {
    method: 'POST',
    body: JSON.stringify({
      ...article,
      is_faq: true,
      is_recursive: true,
      show_in_service_catalog: true,
    }),
  });
  const item = result?.data || result;
  console.log(`Criado no GLPI (ID ${item?.id ?? 'sem ID'}): ${article.name}`);
}
