# BASE PROCEDURAL: DESEMPENHO DA ESTAÇÃO E ARMAZENAMENTO

## Sintoma 1: Computador Lento, Travando ou Demorando para Responder
### Diagnóstico:
Memória RAM esgotada por muitas abas e aplicativos abertos, processo travado consumindo CPU, disco quase cheio ou atualização do sistema pendente. Estações com 8 GB de RAM (Distribuição) sentem primeiro o acúmulo de abas do PJe.
### Procedimento de Resolução (Windows 11):
1. Salve o que estiver aberto e feche as abas e programas que não estiver usando (cada aba do PJe com autos abertos ocupa bastante memória).
2. Pressione `Ctrl + Shift + Esc` para abrir o **Gerenciador de Tarefas**, clique na coluna **Memória** e finalize (botão direito ➔ **Finalizar tarefa**) o programa que estiver consumindo mais e que você não esteja usando.
3. Confira o espaço livre em **Configurações ➔ Sistema ➔ Armazenamento**; se o disco C: estiver quase cheio, siga o procedimento de liberação de espaço.
4. Reinicie o computador em **Iniciar ➔ Energia ➔ Reiniciar** (o "Desligar" do Windows 11 não limpa a memória por causa da inicialização rápida).
### Procedimento de Resolução (Ubuntu 24.04):
1. Salve o trabalho e feche as abas e aplicativos que não estiver usando.
2. No terminal, verifique memória e processos: `free -h` e `top -o %MEM` (pressione `q` para sair). Encerre o processo que estiver travado com `kill <PID>`.
3. Verifique o espaço livre com `df -h /` e, se estiver acima de 90%, siga o procedimento de liberação de espaço.
4. Confira se há serviços com falha (`systemctl --failed`) e reinicie a estação com `sudo reboot` se a lentidão continuar.

---

## Sintoma 2: Pouco Espaço em Disco / Download Falhando por Falta de Espaço
### Diagnóstico:
Disco do sistema quase cheio por downloads de autos, cópias integrais de processos, lixeira e arquivos temporários. Abaixo de 10% livre o sistema fica lento e downloads falham.
### Procedimento de Resolução (Windows 11):
1. Abra **Configurações ➔ Sistema ➔ Armazenamento ➔ Arquivos temporários**, marque **Arquivos temporários**, **Lixeira** e **Downloads** (confira antes se não há nada importante em Downloads) e clique em **Remover arquivos**.
2. Pressione `Win + R`, digite `cleanmgr` e confirme a unidade **C:** para limpar arquivos de atualização e de sistema.
3. Mova cópias integrais de processos já encerrados para a pasta de rede compartilhada do setor em vez de mantê-las no disco local.
4. Ative o **Sensor de Armazenamento** (mesma tela de Armazenamento) para que a limpeza passe a ser automática.
### Procedimento de Resolução (Ubuntu 24.04):
1. Veja o uso por partição com `df -h` e as pastas mais pesadas da sua área com `du -sh ~/Downloads ~/.cache ~/.local/share/Trash 2>/dev/null`.
2. Esvazie a lixeira com `gio trash --empty` e remova downloads que já não são necessários.
3. Limpe o cache de pacotes e logs antigos: `sudo apt clean` e `sudo journalctl --vacuum-time=7d`.
4. Confirme o resultado com `df -h /` e tente o download novamente.
