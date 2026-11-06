# BASE PROCEDURAL: PJE NO NAVEGADOR E SISTEMAS WEB DO TRIBUNAL

## Sintoma 1: PJe Lento ou em Branco ao Abrir Autos Volumosos
### Diagnóstico:
Documentos com centenas de páginas esgotam a memória da aba do navegador; cache acumulado ou muitas abas do PJe abertas ao mesmo tempo agravam a lentidão.
### Procedimento de Resolução (Windows 11):
1. Feche as outras abas do PJe e mantenha aberto apenas o processo que está analisando.
2. Limpe imagens e arquivos em cache: `Ctrl + Shift + Del` ➔ marque somente **Imagens e arquivos em cache** ➔ **Limpar dados**.
3. Abra os autos pela navegação por documento (peça a peça) em vez de carregar o PDF integral de uma vez.
4. Se outros sites abrem normalmente e o PJe continua lento para vários colegas, informe a TIC: pode ser lentidão do serviço, não da sua estação.
### Procedimento de Resolução (Ubuntu 24.04):
1. Feche as outras abas do PJe e mantenha apenas o processo em análise.
2. Limpe o cache do navegador com `Ctrl + Shift + Del` (somente **Imagens e arquivos em cache**).
3. Verifique a memória livre com `free -h`; se estiver baixa, feche aplicativos pesados e abra os autos peça a peça.

---

## Sintoma 2: Navegador Fecha ou Trava ao Abrir PDF do PJe
### Diagnóstico:
Falha do visualizador de PDF embutido com aceleração gráfica ou falta de memória ao renderizar arquivos grandes.
### Procedimento de Resolução (Windows 11):
1. No Google Chrome, abra **Configurações ➔ Sistema**, desative **Usar aceleração gráfica quando disponível** e clique em **Reiniciar**.
2. No Firefox, abra **Configurações ➔ Geral ➔ Desempenho**, desmarque **Usar configurações de desempenho recomendadas** e depois **Usar aceleração de hardware quando disponível**; reinicie o navegador.
3. Como alternativa imediata, baixe o PDF e abra-o no leitor de PDF instalado na estação.
4. Mantenha o navegador atualizado (menu ➔ **Ajuda ➔ Sobre**) e use o navegador homologado pelo TJPA para o PJe.
### Procedimento de Resolução (Ubuntu 24.04):
1. Desative a aceleração de hardware do navegador (Chrome: **Configurações ➔ Sistema**; Firefox: **Configurações ➔ Geral ➔ Desempenho**) e reinicie-o.
2. Baixe o PDF e abra-o no **Visualizador de Documentos** como alternativa imediata.
3. Atualize o navegador com `sudo apt update && sudo apt upgrade` (ou pela loja de aplicativos, se instalado via Snap).

---

## Sintoma 3: Sessão do PJe Expirando com Frequência
### Diagnóstico:
Relógio da estação fora de sincronia, cookies corrompidos do domínio do tribunal ou várias abas disputando a mesma sessão.
### Procedimento de Resolução (Windows 11):
1. Enquanto o problema não for resolvido, redija textos longos em um editor (Word/LibreOffice) e cole no PJe só para salvar, para não perder conteúdo.
2. Sincronize o relógio: **Configurações ➔ Hora e idioma ➔ Data e hora ➔ Sincronizar agora**.
3. Apague os cookies do domínio do tribunal: clique no cadeado ao lado do endereço ➔ **Cookies e dados do site** ➔ remova os de `tjpa.jus.br`; depois entre novamente.
4. Use o PJe em uma única aba e desative extensões de bloqueio de scripts para o domínio do tribunal.
### Procedimento de Resolução (Ubuntu 24.04):
1. Redija textos longos fora do navegador enquanto o problema persistir.
2. Verifique a sincronização do relógio com `timedatectl` (campo **System clock synchronized: yes**); se estiver `no`, rode `sudo timedatectl set-ntp true`.
3. Apague os cookies do domínio `tjpa.jus.br` pelo cadeado da barra de endereço e entre novamente em uma única aba.

---

## Sintoma 4: Portal ou Sistema com Erro 502/503/504 (Bad Gateway / Página em Branco)
### Diagnóstico:
Erro do lado do servidor (serviço fora do ar ou sobrecarregado), não da estação. Afeta todos os usuários do sistema ao mesmo tempo.
### Procedimento de Resolução (todos os sistemas):
1. Abra o mesmo endereço em uma janela anônima (`Ctrl + Shift + N` no Chrome, `Ctrl + Shift + P` no Firefox) para descartar cache e cookies.
2. Peça a um colega para abrir o mesmo endereço em outro computador.
3. Se o erro aparecer também para o colega, é indisponibilidade do sistema: registre o horário e abra chamado para a equipe de sistemas informando a página e o código do erro (ex.: 502 Bad Gateway).

---

## Sintoma 5: Assinatura em Lote Trava no Meio da Lista
### Diagnóstico:
Fila de assinaturas do PJeOffice saturada por lotes muito grandes ou processo do assinador travado em segundo plano.
### Procedimento de Resolução (Windows 11):
1. Feche o PJeOffice pelo ícone próximo ao relógio (**Sair**) e abra-o novamente pelo menu Iniciar.
2. Atualize a página do PJe (`F5`): os documentos já assinados continuam assinados.
3. Selecione os documentos restantes em lotes menores (de 10 a 15 por vez) e assine novamente.
### Procedimento de Resolução (Ubuntu 24.04):
1. Encerre o assinador com `pkill -f pjeoffice` e inicie novamente com `pjeoffice-pro &`.
2. Atualize a página do PJe (`F5`) e assine os documentos restantes em lotes de 10 a 15.
