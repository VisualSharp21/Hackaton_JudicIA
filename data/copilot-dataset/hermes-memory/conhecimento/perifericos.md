# BASE PROCEDURAL: PERIFÉRICOS E ENERGIA

## Sintoma 1: Monitor Sem Sinal ("No Signal") ou Segunda Tela Apagada
### Diagnóstico:
Modo de projeção alterado, cabo de vídeo (HDMI/DisplayPort) frouxo ou fonte de entrada errada selecionada no próprio monitor.
### Procedimento de Resolução (Windows 11):
1. Pressione `Windows + P` e selecione **Estender** (para duas telas) ou **Duplicar**.
2. Desencaixe e encaixe novamente, com firmeza, o cabo HDMI/DisplayPort atrás do computador e atrás do monitor.
3. No botão de menu do monitor (**Input / Source**), selecione a entrada em que o cabo está ligado (HDMI ou DP).
4. Em **Configurações ➔ Sistema ➔ Tela**, clique em **Detectar** em "Vários monitores". Se continuar "No Signal", troque o cabo por outro e, persistindo, abra chamado com o patrimônio do monitor.
### Procedimento de Resolução (Ubuntu 24.04):
1. Abra **Configurações ➔ Telas** e confirme se o segundo monitor aparece; escolha **Juntar telas** (estender) ou **Espelhar**.
2. Reencaixe o cabo HDMI/DisplayPort nas duas pontas e selecione a entrada correta no menu do monitor (**Input / Source**).
3. Em sessão Xorg, `xrandr` lista as saídas conectadas; em Wayland use a tela de Configurações. Persistindo sem sinal, troque o cabo e abra chamado com o patrimônio do monitor.

---

## Sintoma 2: Teclado ou Mouse Travando, Lentos ou Repetindo Caracteres
### Diagnóstico:
Porta USB frontal com mau contato ou sem energia suficiente, hub USB sobrecarregado ou suspensão seletiva de USB desligando o dispositivo.
### Procedimento de Resolução (Windows 11):
1. Conecte o teclado e o mouse diretamente nas portas USB **traseiras** do gabinete (evite hubs e extensores).
2. Desconecte dispositivos USB que não estiverem em uso (pendrives, carregadores de celular, hubs).
3. Desative a suspensão seletiva: **Painel de Controle ➔ Opções de Energia ➔ Alterar configurações do plano ➔ Alterar configurações de energia avançadas ➔ Configurações de USB ➔ Configuração de suspensão seletiva USB ➔ Desabilitado**.
4. Se o problema continuar com outro teclado/mouse emprestado, é falha da porta ou do equipamento: abra chamado com o patrimônio.
### Procedimento de Resolução (Ubuntu 24.04):
1. Conecte o teclado e o mouse diretamente em outra porta USB, sem hubs.
2. No terminal, acompanhe as mensagens do kernel ao reconectar: `sudo dmesg -w` (pressione `Ctrl + C` para sair) — desconexões repetidas indicam porta ou cabo com defeito.
3. Liste os dispositivos reconhecidos com `lsusb`. Se o problema continuar com outro teclado/mouse, abra chamado com o patrimônio.

---

## Sintoma 3: Scanner Não Reconhecido ou "Ocupado por Outro Aplicativo"
### Diagnóstico:
Sessão de digitalização presa no serviço de aquisição de imagens, cabo USB com mau contato ou outro programa segurando o scanner.
### Procedimento de Resolução (Windows 11):
1. Feche todos os programas de digitalização (PaperStream, visualizadores) e desligue o scanner no botão físico.
2. Troque o cabo USB do scanner para uma porta USB traseira do computador e ligue o scanner novamente, aguardando o autoteste terminar.
3. Pressione `Win + R`, digite `services.msc`, localize **Aquisição de Imagens do Windows (WIA)** e clique em **Reiniciar**.
4. Abra o software de digitalização e faça uma captura de teste.
### Procedimento de Resolução (Ubuntu 24.04):
1. Feche os programas de digitalização e desligue/religue o scanner.
2. Confirme se o scanner aparece com `lsusb` e se o SANE o reconhece com `scanimage -L`.
3. Abra o **Digitalizador de Documentos** e faça uma captura de teste; se o scanner não aparecer em `scanimage -L`, abra chamado informando o modelo.

---

## Sintoma 4: Som Não Sai nas Caixas de Som / Alto-falantes
### Diagnóstico:
Saída de áudio padrão ficou presa no fone de ouvido ou em outro dispositivo, volume no mudo ou cabo P2 conectado na saída errada.
### Procedimento de Resolução (Windows 11):
1. Clique no ícone de alto-falante ao lado do relógio, clique na seta **>** ao lado do volume e escolha **Alto-falantes** como dispositivo de saída.
2. Confira se o volume do Windows e o da própria caixa de som não estão no mínimo ou no mudo.
3. Verifique se o cabo P2 verde da caixa está na saída **verde (Line Out)** traseira e se a caixa está ligada na energia.
4. Se continuar mudo, abra **Configurações ➔ Sistema ➔ Som** e execute **Solucionar problemas de som comuns**.
### Procedimento de Resolução (Ubuntu 24.04):
1. Abra **Configurações ➔ Som** e selecione as caixas/alto-falantes em **Saída**.
2. Confira o volume e o mudo no próprio sistema e na caixa de som.
3. No terminal, `wpctl status` mostra os dispositivos do PipeWire; reinicie o áudio com `systemctl --user restart pipewire pipewire-pulse wireplumber`.

---

## Sintoma 5: Notebook Desligou Sozinho / Bateria Descarregada
### Diagnóstico:
Notebook operando só na bateria até o desligamento automático, carregador mal encaixado ou tomada sem energia.
### Procedimento de Resolução (Windows 11):
1. Conecte o carregador original na tomada e no notebook e confira se o LED de carga acende antes de ligar.
2. Ligue o notebook e mantenha-o na tomada durante toda a sessão de trabalho ou audiência.
3. Se estava em uma audiência ou reunião, abra o navegador e pressione `Ctrl + Shift + T` para restaurar a aba fechada (ou abra novamente o link da sala) e teste câmera e microfone antes de retomar.
4. Em **Configurações ➔ Sistema ➔ Energia e bateria**, confira se o notebook mostra **Carregando**; se não carregar com o carregador conectado, abra chamado com o patrimônio do equipamento.
### Procedimento de Resolução (Ubuntu 24.04):
1. Conecte o carregador na tomada e no notebook e confira o LED de carga.
2. Ligue o notebook e verifique o estado da bateria com `upower -i $(upower -e | grep BAT)` (campo `state` deve indicar `charging`).
3. Se estava em reunião ou audiência, reabra o navegador e use `Ctrl + Shift + T` ou o link da sala; se a bateria não carregar, abra chamado com o patrimônio.
