# BASE PROCEDURAL: PJE E ASSINADORES DIGITAIS (PJEOFFICE / TOKEN A3)

## Sintoma 1: "Não foi possível conectar ao PJeOffice" / WebSocket 127.0.0.1:8800
### Diagnóstico:
O serviço de segundo plano do PJeOffice travou ou não iniciou com o sistema operacional, impedindo o navegador de comunicar com a porta local 8800.
### Procedimento de Resolução:
1. Localize o ícone do PJeOffice na barra de tarefas (próximo ao relógio do Windows) ou no menu do sistema.
2. Clique com botão direito e selecione **Sair / Encerrar**.
3. Abra o menu Iniciar e digite **PJeOffice Pro** para iniciá-lo novamente.
4. No navegador (Firefox/Chrome), pressione `Ctrl + F5` na página de assinatura do PJe.
5. Se for Linux (Ubuntu): abra o terminal e rode `pjeoffice-pro &` ou verifique se o Java OpenJDK 17/21 está com permissões corretas.

---

## Sintoma 2: Token / Certificado A3 não reconhecido
### Diagnóstico:
Porta USB sem contato, leitora de cartão sem driver ou serviço de cartão inteligente (Smart Card) parado no Windows.
### Procedimento de Resolução:
1. Remova o token USB da porta atual e insira em uma porta USB traseira do computador.
2. Abra o aplicativo **SafeSign / Administração do Token** e verifique se o certificado aparece listado.
3. No Windows, pressione `Win + R`, digite `services.msc`, localize o serviço **Cartão Inteligente (Smart Card)** e clique em **Reiniciar**.
4. Se o PIN tiver sido bloqueado por 3 tentativas incorretas, oriente o usuário a utilizar o PUK do certificado para desbloqueio ou contatar a autoridade certificadora.

---

## Sintoma 3: Erro de Cadeia de Certificação (ICP-Brasil v5/v10)
### Diagnóstico:
Falta de certificados raízes intermediários no repositório do navegador ou do Java.
### Procedimento de Resolução:
1. Acesse o portal oficial de certificados do TJPA ou ITI.
2. Instale o instalador unificado de cadeias da ICP-Brasil.
3. Reinicie o navegador completamente e teste a validação do documento.
