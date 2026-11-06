# BASE PROCEDURAL: ESTAÇÕES LINUX (UBUNTU 24.04 LTS)

Procedimentos equivalentes aos da base Windows para as estações Lenovo ThinkPad da TIC. Nunca use Painel de Controle, registro ou comandos do Windows nestas máquinas.

## Sintoma 1: PJeOffice Pro Não Inicia ou Não Responde na Porta 8800 (Ubuntu)
### Diagnóstico:
Processo antigo do PJeOffice (Java) preso em segundo plano segurando a porta 8800, ou runtime Java incompatível com a versão instalada do assinador.
### Procedimento de Resolução (Ubuntu 24.04):
1. Verifique se algo está escutando na porta local: `ss -ltnp | grep 8800`.
2. Encerre instâncias travadas do assinador com `pkill -f pjeoffice` e confirme com `pgrep -af pjeoffice` (não deve retornar nada).
3. Confira o Java disponível com `java -version`; se houver mais de uma versão, selecione a homologada com `sudo update-alternatives --config java`.
4. Inicie o assinador na sessão gráfica do usuário com `pjeoffice-pro &` e recarregue a página do PJe com `Ctrl + F5`.

---

## Sintoma 2: Token A3 Não Reconhecido (Ubuntu)
### Diagnóstico:
Serviço de cartão inteligente (pcscd) parado, pacote do leitor ausente ou porta USB com mau contato.
### Procedimento de Resolução (Ubuntu 24.04):
1. Reconecte o token em outra porta USB do notebook, sem hubs.
2. Verifique o serviço de cartão inteligente com `systemctl status pcscd` e reinicie-o com `sudo systemctl restart pcscd`.
3. Liste os leitores e tokens detectados com `pcsc_scan` (pacote `pcsc-tools`; pressione `Ctrl + C` para sair). Se nada aparecer, instale o suporte com `sudo apt install pcscd libccid opensc`.
4. Nunca digite o PIN repetidas vezes: após 3 tentativas incorretas o token bloqueia e exige o PUK.

---

## Sintoma 3: Cadeia ICP-Brasil Não Confiável (Ubuntu)
### Diagnóstico:
Certificados raiz/intermediários da ICP-Brasil ausentes do repositório do sistema ou do navegador.
### Procedimento de Resolução (Ubuntu 24.04):
1. Baixe as cadeias da ICP-Brasil no portal oficial do ITI ou do TJPA (arquivos `.crt`).
2. Copie-as para `/usr/local/share/ca-certificates/` e atualize o repositório com `sudo update-ca-certificates`.
3. No Firefox, importe as mesmas cadeias em **Configurações ➔ Privacidade e Segurança ➔ Certificados ➔ Ver certificados ➔ Autoridades ➔ Importar** e reinicie o navegador e o PJeOffice.

---

## Sintoma 4: Wi-Fi Instável ou Sem Rede (Ubuntu)
### Diagnóstico:
Sinal fraco ou interferência no Wi-Fi, conexão associada à rede de visitantes ou interface sem endereço IP.
### Procedimento de Resolução (Ubuntu 24.04):
1. Prefira o cabo de rede (Ethernet RJ-45) sempre que houver ponto disponível na mesa.
2. Veja o estado das interfaces com `nmcli device status` e `ip -br addr`.
3. Confirme que está na rede institucional: `nmcli connection show --active` deve listar `TJPA-CORPORATIVO` (e não a rede de visitantes).
4. Reconecte com `nmcli radio wifi off && nmcli radio wifi on` e teste a rede interna com `ping -c 3 10.1.1.10`.

---

## Sintoma 5: Falha de Resolução DNS (Ubuntu)
### Diagnóstico:
Cache do systemd-resolved desatualizado ou servidor DNS interno do TJPA (10.1.1.10) respondendo com atraso.
### Procedimento de Resolução (Ubuntu 24.04):
1. Limpe o cache de DNS com `resolvectl flush-caches`.
2. Confira os servidores em uso com `resolvectl status` e teste a resolução com `resolvectl query pje.tjpa.jus.br`.
3. Meça a resposta do DNS interno com `dig @10.1.1.10 pje.tjpa.jus.br` (pacote `bind9-dnsutils`); timeouts repetidos para mais de uma estação devem ser tratados como incidente coletivo de rede.

---

## Sintoma 6: Fila de Impressão Travada (Ubuntu / CUPS)
### Diagnóstico:
Trabalho corrompido no topo da fila do CUPS ou impressora pausada após erro.
### Procedimento de Resolução (Ubuntu 24.04):
1. Liste os trabalhos pendentes com `lpstat -o` e o estado das impressoras com `lpstat -p`.
2. Cancele os trabalhos travados com `cancel -a <nome-da-impressora>` (ou `cancel <id-do-trabalho>` para um só).
3. Reative a impressora, se estiver pausada, com `cupsenable <nome-da-impressora>` e reinicie o serviço com `sudo systemctl restart cups`.
4. Desligue a impressora no botão físico por 10 segundos, ligue novamente e imprima uma página de teste.

---

## Sintoma 7: VPN Conecta mas a Rota Interna Não Responde (OpenVPN)
### Diagnóstico:
Rota para a rede interna não aplicada após atualização de certificados ou de configuração do cliente OpenVPN.
### Procedimento de Resolução (Ubuntu 24.04):
1. Verifique se a rota existe com `ip route | grep 10.20.0.` e teste o gateway com `ping -c 3 10.20.0.1`.
2. Confira os certificados corporativos instalados com `sudo update-ca-certificates` (deve terminar sem erros).
3. Reinicie a conexão VPN pelo NetworkManager (`nmcli connection down <vpn>` e `nmcli connection up <vpn>`) e consulte o log com `journalctl -u NetworkManager --since "10 min ago" | grep -i vpn`.

---

## Sintoma 8: Script de Diagnóstico Falha por Falta de Permissão (Ubuntu)
### Diagnóstico:
O script não tem permissão de execução ou tenta ler dados de interface de rede que exigem privilégio de administrador.
### Procedimento de Resolução (Ubuntu 24.04):
1. Confira as permissões com `ls -l <script>.sh` e torne-o executável com `chmod +x <script>.sh`.
2. Para dados que não exigem administrador, prefira comandos sem privilégio: `nmcli device status` e `ip -br link`.
3. Execute com `sudo` somente a etapa que lê a interface wireless em detalhe (ex.: `sudo iw dev`) e revise o conteúdo do script antes de usar `sudo`.

---

## Sintoma 9: Erro de Certificado TLS ("certificate verify failed") com a Autoridade Certificadora Interna
### Diagnóstico:
O serviço cliente não confia na autoridade certificadora interna do TJPA que assinou o certificado do endpoint.
### Procedimento de Resolução (Ubuntu 24.04):
1. Copie o certificado raiz interno (`.crt`) para `/usr/local/share/ca-certificates/` e rode `sudo update-ca-certificates`.
2. Para serviços Node.js, aponte a variável `NODE_EXTRA_CA_CERTS` para o arquivo da CA interna e reinicie o serviço.
3. Valide a cadeia com `openssl s_client -connect <host>:443 -servername <host>` (procure `Verify return code: 0 (ok)`); nunca desative a verificação de TLS como solução.

---

## Sintoma 10: Token OAuth2 de Integração Expira e Renovação Retorna HTTP 401
### Diagnóstico:
Cabeçalho de autenticação malformado ou renovação do token feita após a expiração.
### Procedimento de Resolução (Ubuntu 24.04):
1. Solicite o token com `Content-Type: application/x-www-form-urlencoded` no corpo da requisição (não JSON) e guarde o campo `expires_in`.
2. Envie as chamadas com o cabeçalho exatamente no formato `Authorization: Bearer <token>`.
3. Renove o token alguns segundos antes de `expires_in` vencer e teste a chamada com `curl -i -H "Authorization: Bearer <token>" <url>`.
