# Deploy na Vercel

Este projeto tem duas partes que sobem juntas, no mesmo projeto Vercel:
- **Frontend** (`artifacts/solicitacao-saque`): site Vite, servido como estático.
- **Backend** (`artifacts/api-server`): API Express, empacotada como uma função
  serverless única em `api/index.js` (veja `artifacts/api-server/build-vercel.mjs`).
  Todo request pra `/api/*` é reescrito pra essa função (`vercel.json`); qualquer
  outra rota serve o site.

As **tabelas do banco são criadas automaticamente a cada deploy** (o
`buildCommand` já roda `drizzle-kit push` sozinho, assim que existir uma
`DATABASE_URL`) — não precisa rodar nenhum comando manual.

## Deploy em 3 passos

### 1. Suba o código no GitHub
Crie um repositório no seu GitHub e envie todo o conteúdo desta pasta (exceto o
que já está no `.gitignore`: `node_modules`, `dist`, `.vercel`, `.env*`).

### 2. Importe na Vercel
Use o botão abaixo (troque `SEU-USUARIO/SEU-REPOSITORIO` pelo caminho do seu
repositório) ou importe manualmente em [vercel.com/new](https://vercel.com/new)
— o `vercel.json` na raiz já configura tudo (build, output, rotas), não mexe
em nada disso na tela de import.

```
https://vercel.com/new/clone?repository-url=https://github.com/SEU-USUARIO/SEU-REPOSITORIO&env=ADMIN_USERNAME,ADMIN_PASSWORD,ZAPGROUP_API_TOKEN&envDescription=Usu%C3%A1rio+e+senha+do+painel+%2Fadmin%2C+e+o+token+da+API+de+consulta+de+CPF
```

Na própria tela de import, a Vercel já pede pra preencher:
- **`ADMIN_USERNAME`** e **`ADMIN_PASSWORD`** — usuário e senha do painel `/admin`. Escolha aqui, na hora — não tem valor padrão de propósito: um login fixo no código seria visível pra qualquer pessoa que abrisse o repositório, num painel que mexe com PIX.
- **`ZAPGROUP_API_TOKEN`** — token da API de consulta de CPF (sem ele a consulta de CPF fica indisponível, mas o resto do site funciona).

### 3. Conecte um Postgres
Ainda na tela do projeto (ou logo depois, em **Storage**), clique **Create
Database → Postgres** (é da Neon, tem plano free) e conecte marcando
Production, Preview e Development. Isso injeta a `DATABASE_URL`
automaticamente — não precisa copiar nada, e as tabelas se criam sozinhas no
próximo build.

Pronto. Depois desses 3 passos, todo commit novo já builda e sobe sozinho.

## Primeiro acesso

- Site público: a URL que a Vercel te der.
- Painel admin: `<sua-url>/admin`, login com o `ADMIN_USERNAME`/`ADMIN_PASSWORD`
  que você preencheu no import.
- Depois de logar, configure em **Gateway**: escolha e ative um gateway de
  pagamento com as credenciais reais dele (senão o site não consegue gerar
  PIX), e os valores do preço (riscado e do PIX). Configure em **Pixels**:
  Meta/TikTok/UTMify se for usar.

## Variáveis opcionais

| Variável | O que é |
|---|---|
| `SESSION_SECRET` | Chave pra assinar a sessão do admin. Se não definir, usa um valor padrão de desenvolvimento — funciona, mas gere uma própria com `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` antes de operar de verdade. |
| `VITE_TIKTOK_PIXEL_ID` | ID do pixel do TikTok (é público, não é segredo). |

As credenciais de **gateway de pagamento** e os **pixels de rastreamento**
não precisam de variável de ambiente — tudo isso é configurado pelo painel
`/admin` (abas Gateway e Pixels) e fica salvo no banco.

## Problemas comuns

- **Erro de TypeScript mencionando `node16`/`nodenext` durante o build**: se
  isso aparecer de novo, é porque `api/index.js` não está mais apontando para
  `artifacts/api-server/dist-vercel/app.mjs`, ou o `buildCommand` no
  `vercel.json` não rodou `pnpm --filter @workspace/api-server run build:vercel`.
  Confira o `vercel.json`.
- **`/api/*` retorna o HTML do site em vez de JSON**: o rewrite de
  `vercel.json` precisa excluir `/api` do fallback do SPA — confira se ainda
  está `{ "source": "/api/(.*)", "destination": "/api/index" }` antes da regra
  geral `/((?!api/).*)`.
- **Admin retorna "Credenciais administrativas ainda não configuradas"**:
  `ADMIN_USERNAME`/`ADMIN_PASSWORD` não foram salvos no ambiente certo
  (Production vs Preview) — confira em Settings → Environment Variables e
  refaça o deploy depois de adicionar.
- **"Muitas conexões" no Postgres**: normal em bancos gratuitos sob tráfego
  alto; o pool já está limitado a 1 conexão por instância quando roda na
  Vercel (`process.env.VERCEL`), então use a *pooled connection string* do
  Neon (é a que a integração da Vercel já configura por padrão).
- **Build log mostra "DATABASE_URL is not set yet -- skipping database
  migration"**: normal antes do passo 3. Depois de conectar o Postgres, o
  próximo deploy já cria as tabelas sozinho.
