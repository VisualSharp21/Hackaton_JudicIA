# BASE PROCEDURAL: INFRAESTRUTURA DE REDE E CONECTIVIDADE

## Sintoma 1: Conexão Oscilando / Wi-Fi Instável na Comarca
### Diagnóstico:
Interferência no canal sem fio ou sinal fraco em prédios de alvenaria antiga do tribunal.
### Procedimento de Resolução:
1. Sempre priorize a conexão por cabo de rede azul (Ethernet RJ-45) disponível nas mesas e salas de audiência.
2. No Windows: abra Configurações ➔ Rede e Internet ➔ Desative o Wi-Fi temporariamente e conecte o cabo de rede.
3. Se apenas o Wi-Fi estiver disponível, verifique se está conectado na rede institucional `TJPA-CORPORATIVO` (e não na rede pública de visitantes).

---

## Sintoma 2: Falha na Resolução de DNS (`pje.tjpa.jus.br` não abre, Google abre)
### Diagnóstico:
Cache de DNS local corrompido ou perda de comunicação temporária com os servidores DNS internos do TJPA (10.1.1.10).
### Procedimento de Resolução:
1. Pressione `Win + R`, digite `cmd` e execute:
   `ipconfig /flushdns`
2. Feche o navegador e reabra.
3. Se persistir para mais colegas do mesmo setor, classifique como **Incidente Coletivo de Rede** e alerte a equipe de infraestrutura.
