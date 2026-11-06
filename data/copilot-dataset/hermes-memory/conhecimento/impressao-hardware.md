# BASE PROCEDURAL: IMPRESSÃO E HARDWARE

## Sintoma 1: Documentos Travados na Fila de Impressão (Spooler)
### Diagnóstico:
Trabalho de impressão com arquivo corrompido ou impressora offline bloqueia os documentos subsequentes.
### Procedimento de Resolução:
1. Abra o Painel de Controle ➔ Dispositivos e Impressoras ➔ Dê dois cliques na impressora padrão.
2. Na janela da fila, clique com o botão direito no primeiro documento com status de erro e selecione **Cancelar**.
3. Se a fila não limpar: abra o CMD como Administrador e execute:
   ```cmd
   net stop spooler
   del /Q /F /S "%systemroot%\System32\Spool\Printers\*.*"
   net start spooler
   ```
4. Desligue a impressora no botão físico, aguarde 10 segundos e ligue novamente.

---

## Sintoma 2: Computador Não Liga Após Queda de Energia
### Diagnóstico:
Proteção da fonte ativada por pico de tensão ou filtro de linha desarmado.
### Procedimento de Resolução:
1. Desconecte o cabo de força da tomada e da traseira do computador.
2. Mantenha pressionado o botão de ligar do computador por 20 segundos com tudo desconectado (drena a energia residual dos capacitores).
3. Conecte diretamente em uma tomada que esteja funcionando comprovadamente e tente ligar.
4. Se não ligar, escale imediatamente com o patrimônio da máquina para troca da fonte de alimentação.
