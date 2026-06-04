# IrisLoan V2 — Bug Intelligence Dashboard

Dashboard de monitoramento de bugs e sprint com atualização automática via webhook do Jira.

## Setup

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env
# Editar .env com o webhook secret e credenciais Jira

# 3. Rodar em desenvolvimento
npm run dev

# 4. Rodar em produção
npm start
```

## Configurar o Webhook no Jira

1. Acessar: **Settings → System → WebHooks** em `luby-us.atlassian.net`
2. Criar novo webhook:
   - **URL:** `https://SEU_DOMINIO/webhook/jira`
   - **Events:** Issue Created, Issue Updated, Issue Deleted
   - **JQL Filter:** `project = "IrisLoan - V2"`
3. Copiar o Secret gerado para o `.env` como `JIRA_WEBHOOK_SECRET`

## Popular os dados iniciais

O webhook só processa eventos **novos**. Para carregar o estado atual do Jira, rode o seed uma vez:

```bash
node scripts/seed.js
```

Requer `JIRA_EMAIL` e `JIRA_API_TOKEN` configurados no `.env`.  
Gerar token em: https://id.atlassian.com/manage-profile/security/api-tokens

## Deploy (Railway)

1. Fazer push para o GitHub
2. Conectar repositório no Railway
3. Configurar variáveis: `PORT` e `JIRA_WEBHOOK_SECRET`
4. Deploy automático a cada push

## Endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/webhook/jira` | Recebe eventos do Jira (HMAC-SHA256) |
| `GET`  | `/api/metrics`  | Retorna métricas processadas |
| `GET`  | `/api/health`   | Health check |
| `GET`  | `/`             | Dashboard HTML |

## Arquitetura

```
Issue atualizada no Jira
        ↓
Jira dispara POST /webhook/jira
        ↓
Backend valida assinatura HMAC-SHA256, processa KPIs, salva em data/metrics.json
        ↓
Dashboard faz polling GET /api/metrics a cada 30 segundos
        ↓
UI atualiza automaticamente sem nenhuma ação do usuário
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `PORT` | Não | Porta do servidor (padrão: 3000) |
| `JIRA_WEBHOOK_SECRET` | Em produção | Secret para validar assinatura HMAC do Jira |
| `JIRA_EMAIL` | Apenas no seed | Email da conta Jira |
| `JIRA_API_TOKEN` | Apenas no seed | Token de API do Jira |
