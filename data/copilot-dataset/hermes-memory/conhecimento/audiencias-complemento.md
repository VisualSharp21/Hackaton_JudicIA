# BASE PROCEDURAL COMPLEMENTAR: AUDIÊNCIAS VIRTUAIS (GOOGLE MEET)

## Sintoma 1: Navegador Bloqueou a Câmera e o Microfone do Google Meet
### Diagnóstico:
A permissão de câmera/microfone para `meet.google.com` foi negada (ou redefinida após atualização do navegador), ou o sistema operacional está impedindo que o navegador use os dispositivos.
### Procedimento de Resolução (Windows 11):
1. Clique no ícone de câmera bloqueada (ou no cadeado/ajustes) à esquerda de `https://meet.google.com` na barra de endereços e marque **Permitir** para **Câmera** e **Microfone**.
2. Recarregue a sala com `F5` e escolha os dispositivos corretos em **Mais opções (⋮) ➔ Configurações ➔ Áudio / Vídeo**.
3. Se o navegador continuar sem acesso, abra **Configurações do Windows ➔ Privacidade e segurança ➔ Câmera** (e depois **Microfone**) e ative o acesso para aplicativos da área de trabalho.
4. Execute o teste rápido de microfone e câmera pelo cartão de diagnóstico antes de iniciar a audiência.
### Procedimento de Resolução (Ubuntu 24.04):
1. Clique no ícone de câmera bloqueada/cadeado ao lado de `https://meet.google.com` e marque **Permitir** para **Câmera** e **Microfone**.
2. Recarregue a sala (`F5`) e selecione os dispositivos em **Mais opções (⋮) ➔ Configurações**.
3. Se o navegador foi instalado via Snap, confirme as permissões em **Configurações ➔ Aplicativos ➔ (navegador) ➔ Câmera / Microfone** e rode o teste rápido do cartão de diagnóstico.

---

## Sintoma 2: Conexão Caindo ou Participantes "Robóticos" Durante a Audiência
### Diagnóstico:
Perda de pacotes no Wi-Fi durante a transmissão de vídeo em tempo real; o Meet degrada áudio e vídeo antes de cair.
### Procedimento de Resolução (todos os sistemas):
1. Conecte o cabo de rede azul (Ethernet RJ-45) da bancada da sala de audiência diretamente no notebook.
2. Desative o Wi-Fi para forçar todo o tráfego da videoconferência pelo cabo.
3. No Meet, em **Mais opções (⋮) ➔ Configurações ➔ Vídeo**, reduza a resolução de envio e de recebimento para **Definição padrão (360p)** enquanto a rede estiver instável.
4. Se vários equipamentos da comarca perderem a conexão ao mesmo tempo, trate como incidente coletivo de rede: use o link 4G de contingência da sala e acione o plantão de infraestrutura.
