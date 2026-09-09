# Deploy na Vercel

Este projeto tem duas partes que sobem juntas, no mesmo projeto Vercel:
- **Frontend** (`artifacts/solicitacao-saque`): site Vite, servido como estático.
- **Backend** (`artifacts/api-server`): API Express, empacotada como uma função
  serverless única em `api/[...path].js` (veja `artifacts/api-server/build-vercel.mjs`).

Todas as rotas `/api/*` vão para essa função; qualquer outra rota serve o site.

## Passo a passo

### 1. Suba o código no GitHub
Crie um repositório no seu GitHub e envie todo o conteúdo desta pasta (exceto o
que já está no `.gitignore`: `node_modules`, `dist`, `.vercel`, `.env*`).

### 2. Importe o projeto na Vercel
No [dashboard da Vercel](https://vercel.com/new), importe o repositório. A
Vercel vai detectar o `vercel.json` na raiz automaticamente — não precisa
mexer em "Build Command" / "Output Directory" manualmente.

### 3. Crie um banco Postgres
Na aba **Storage** do projeto → **Create Database** → **Postgres** (é da Neon).
Conecte ao projeto marcando **Production**, **Preview** e **Development**.
Isso injeta a `DATABASE_URL` automaticamente — não precisa copiar nada.

### 4. Configure as variáveis de ambiente
Em **Settings → Environment Variables**, adicione (Production + Preview no
mínimo):

| Variável | Obrigatória? | O que é |
|---|---|---|
| `ADMIN_USERNAME` | Sim | Usuário de login do painel `/admin` |
| `ADMIN_PASSWORD` | Sim | Senha de login do painel `/admin` |
| `SESSION_SECRET` | Recomendado | Chave aleatória p/ assinar a sessão do admin. Gere com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ZAPGROUP_API_TOKEN` | Sim (p/ consulta de CPF funcionar) | Token da API de consulta de CPF |
| `VITE_TIKTOK_PIXEL_ID` | Opcional | ID do pixel do TikTok (é público, não é segredo) |

As credenciais de **gateway de pagamento** (FreePay, BlackCat, MagicPay,
FlevoPay, PinguPag) e os **pixels de rastreamento** (Meta/TikTok/UTMify) **não
precisam de variável de ambiente** — configure tudo direto pelo painel
`/admin` depois do primeiro deploy (aba Gateway e aba Pixels). O painel salva
no banco de dados.

### 5. Crie as tabelas do banco
Depois que a `DATABASE_URL` existir (passo 3), rode uma vez, com essa
variável apontando pro banco da Vercel:

```
pnpm install
pnpm --filter @workspace/db run push
```

### 6. Deploy
Clique em **Deploy** na Vercel (ou faça um novo commit — o deploy automático
cuida do resto). O build roda em duas etapas (já configuradas no
`vercel.json`):
1. `vite build` do frontend.
2. `build-vercel.mjs` empacota o backend Express num arquivo único, porque o
   compilador da Vercel é mais rígido que o do projeto e exige extensão
   `.js` em todo import relativo — em vez de reescrever centenas de imports,
   o backend já sai pré-compilado pelo esbuild.

### 7. Primeiro acesso
- Site público: a URL que a Vercel te der.
- Painel admin: `<sua-url>/admin`, login com `ADMIN_USERNAME`/`ADMIN_PASSWORD`.
- Depois de logar, configure em **Gateway**: escolha e ative um gateway de
  pagamento com as credenciais reais dele (senão o site não consegue gerar
  PIX). Configure em **Pixels**: pixels de Meta/TikTok/UTMify se for usar.

## Problemas comuns

- **Erro de TypeScript mencionando `node16`/`nodenext` durante o build**: se
  isso aparecer de novo, é porque o `api/[...path].js` não está mais
  apontando para `artifacts/api-server/dist-vercel/app.mjs`, ou o
  `buildCommand` no `vercel.json` não rodou `pnpm --filter @workspace/api-server run build:vercel`. Confira o `vercel.json`.
- **Admin retorna "Sessão administrativa expirada" direto no login**: confira
  se `ADMIN_USERNAME`/`ADMIN_PASSWORD` foram salvos no ambiente certo
  (Production vs Preview) e se o deploy foi refeito depois de adicioná-los.
- **"Muitas conexões" no Postgres**: normal em bancos gratuitos sob tráfego
  alto; o pool já está limitado a 1 conexão por instância quando roda na
  Vercel (`process.env.VERCEL`), então use a *pooled connection string* do
  Neon (é a que a integração da Vercel já configura por padrão).
