# GLPI Local (Docker)

Ambiente Docker para desenvolvimento e demonstração da integração com GLPI 11/12 via API v2 (High-Level API).

## 🚀 Como subir

1. Copie o arquivo de variáveis:
   ```bash
   cp .env.example .env
   ```
2. Inicie os contêineres:
   ```bash
   docker compose up -d
   ```
3. O GLPI iniciará a instalação automática e estará disponível em:
   - **URL:** [http://localhost:8080](http://localhost:8080)
   - **Usuário padrão:** `glpi`
   - **Senha padrão:** `glpi`

## 🔌 API v2 e OAuth2

A integração do JUDICI.A consome a High-Level API v2 em:
`http://localhost:8080/api.php`

O conector utiliza OAuth2 (grant `password` com escopo `api`) e mapeia categorias ITIL para encaminhamento automático de chamados e sincronização de artigos da base de conhecimento.
