# BASE PROCEDURAL COMPLEMENTAR: ESTAÇÃO SEM REDE

## Sintoma 1: Estação Sem Rede / Sem Internet (Ícone de Globo na Barra de Tarefas)
### Diagnóstico:
Cabo de rede desconectado ou com mau contato, endereço IP não obtido do DHCP ou queda do switch/link do setor. Se vários computadores do setor perderam a rede ao mesmo tempo, é incidente coletivo — não é falha da estação.
### Procedimento de Resolução (Windows 11):
1. Confira o cabo de rede azul (RJ-45) atrás do computador e na tomada da parede: ele deve estar firme e com as luzes da porta piscando.
2. Pergunte se os colegas do setor também estão sem rede. Se estiverem, não mexa mais na estação: abra chamado como incidente coletivo de rede.
3. Pressione `Win + R`, digite `cmd` e execute `ipconfig /release`, depois `ipconfig /renew` e `ipconfig /flushdns`.
4. Se continuar sem rede, anote o que aparece no ícone de rede e abra chamado: a TIC verificará o ponto de rede e o switch do setor.
### Procedimento de Resolução (Ubuntu 24.04):
1. Confira o cabo de rede nas duas pontas e as luzes da porta.
2. Pergunte se os colegas do setor também estão sem rede; se estiverem, trate como incidente coletivo.
3. No terminal, veja o estado das interfaces com `ip -br addr` e `nmcli device status`.
4. Reconecte a rede com `nmcli networking off && nmcli networking on` e teste com `ping -c 3 10.1.1.10`.
