# BASE PROCEDURAL: ROTEIRO GERAL DE VERIFICAÇÃO

Usado quando o relato ainda não permite identificar o sistema ou o equipamento afetado. O Copilot apresenta este roteiro e pede o detalhe que falta.

## Sintoma 1: Problema Ainda Não Identificado (Roteiro Geral)
### Diagnóstico:
O relato não traz sintoma, sistema ou equipamento suficientes para escolher um procedimento específico. O roteiro coleta evidências e resolve as causas mais comuns (aplicativo travado, página com cache antigo, atualização pendente).
### Procedimento de Resolução (Windows 11):
1. Anote a mensagem de erro exata ou faça uma captura de tela com `Win + Shift + S`.
2. Feche o programa afetado e abra-o novamente; se for um site do tribunal, recarregue a página com `Ctrl + F5`.
3. Reinicie o computador em **Iniciar ➔ Energia ➔ Reiniciar**.
4. Se continuar, descreva o que estava fazendo quando o problema aconteceu, a mensagem exibida e desde quando ocorre.
### Procedimento de Resolução (Ubuntu 24.04):
1. Anote a mensagem de erro exata ou capture a tela com a tecla `Print`.
2. Feche o aplicativo afetado e abra-o novamente; se for um site do tribunal, recarregue com `Ctrl + F5`.
3. Veja os erros recentes do sistema com `journalctl -p err -b --no-pager | tail -n 20`.
4. Reinicie a estação com `sudo reboot` e, se continuar, descreva o que estava fazendo e a mensagem exibida.
