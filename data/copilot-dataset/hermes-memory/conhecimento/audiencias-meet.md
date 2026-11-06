# BASE PROCEDURAL: AUDIÊNCIAS VIRTUAIS E GOOGLE MEET

## 1. Gatilho de Ferramenta
Sempre que a solicitação contiver um link `meet.google.com` ou for de uma estação de **Sala de Audiência** (ex: `LAB-PJE-004`, `LAB-PJE-009`, `LAB-PJE-014`, `LAB-PJE-019`, `LAB-PJE-024`, `LAB-PJE-029`), execute imediatamente a ferramenta `run_meet_check`.

---

## 2. Sintoma: Microfone sem Captação / Ninguém Ouve na Sala
### Diagnóstico:
Dispositivo de entrada incorreto selecionado no Google Meet, permissão do navegador bloqueada ou dispositivo USB Jabra desconectado.
### Procedimento de Resolução:
1. No Google Meet, clique nos três pontinhos verticais (`Mais opções`) ➔ **Configurações** ➔ **Áudio**.
2. No campo **Microfone**, mude de "Padrão" para o dispositivo físico específico (ex: `Jabra Speak 410 / Microfone Realtek`).
3. Observe se as barrinhas verdes de volume se movem enquanto alguém fala.
4. Clique no ícone de cadeado/ajustes ao lado da barra de endereço do navegador e confirme se a permissão de **Microfone** está como **Permitir**.

---

## 3. Sintoma: Câmera com Tela Preta ou Congelada
### Diagnóstico:
Outro aplicativo (Zoom, Teams, Skype ou outra aba do navegador) está utilizando o driver da webcam com exclusividade.
### Procedimento de Resolução:
1. Feche todas as outras abas do navegador e aplicativos de videoconferência abertos em segundo plano.
2. Nas configurações de **Vídeo** do Google Meet, alterne a resolução de envio para **Definição padrão (360p)** se a conexão estiver instável.
3. Se for câmera USB externa, desconecte e reconecte na porta USB.

---

## 4. Sintoma: Eco e Microfonia Severa na Sala
### Diagnóstico:
Dois dispositivos com microfone e caixas de som ligados no mesmo ambiente físico (ex: notebook do juiz + notebook do escrevente na mesma sala).
### Procedimento de Resolução:
1. Mantenha ligado o áudio e microfone de apenas UM equipamento na sala (a caixinha central de viva-voz Jabra).
2. Todos os outros participantes que estiverem fisicamente na mesma sala devem desativar o microfone e colocar o som do computador no Mudo.
