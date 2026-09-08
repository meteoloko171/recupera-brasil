# Prompt mestre — recriar o painel administrativo RecuperaBrasil

## Instrução principal

Crie em outro projeto um painel administrativo web funcional, visualmente equivalente ao painel administrativo do RecuperaBrasil. Reproduza a estrutura, hierarquia visual, espaçamentos, estados, textos e comportamentos descritos abaixo. Não crie apenas uma imagem ou mockup: implemente as telas, formulários, validações, chamadas de API, loading, erros, sucesso e responsividade.

Use React + TypeScript se o projeto permitir. Preserve a arquitetura e o banco já existentes no projeto de destino. Não substitua o banco nem crie dados falsos para mascarar funcionalidades ausentes.

> **Segurança:** nunca coloque senhas, tokens, API keys, cookies ou credenciais reais no código, no frontend ou neste prompt. Use variáveis de ambiente e mantenha as credenciais exclusivamente no backend.

---

## 1. Identidade e direção visual

- Marca exibida: **RecuperaBrasil**
- Subtítulo: **Central administrativa**
- Idioma: português do Brasil
- Estilo: painel operacional premium, limpo, claro, confiável e compacto.
- Fonte principal: `Plus Jakarta Sans`; fonte monoespaçada apenas para IDs técnicos.
- Fundo geral: `#f5f8fb`
- Superfícies: branco `#ffffff`
- Azul-marinho principal: `#132238`
- Azul-marinho secundário: `#203653`
- Texto secundário: `#718197`
- Bordas: `#e2e9f0`
- Verde de sucesso/ação: `#0ca678`
- Verde suave: `#e7f8f1`
- Âmbar para pendência: `#d58914`
- Vermelho para falha: `#bd5b59`
- Azul informativo: `#4c8bb4`
- Cantos: 9–15 px em componentes; 25 px no cartão de login.
- Sombras suaves, sem excesso de gradientes.
- Desktop: sidebar fixa de aproximadamente 252 px e topbar de aproximadamente 79 px.
- Mobile: sidebar vira menu deslizante; conteúdo ocupa a largura inteira.
- Use ícones lineares consistentes, como Lucide Icons.
- Todos os botões devem ter estado disabled/loading e todos os campos devem ter foco visível.

---

## 2. Autenticação `/admin`

Crie uma tela de login centralizada em um cartão branco:

- Logo/marca RecuperaBrasil no topo.
- Kicker: `ÁREA RESTRITA`
- Título: `Bem-vindo ao painel`
- Texto: `Entre para acompanhar pagamentos, gateways e indicadores da operação.`
- Campo `Usuário`.
- Campo `Senha` com botão mostrar/ocultar.
- Botão verde: `Entrar com segurança`.
- Rodapé: `Ambiente protegido` e `Sessão protegida e válida por 8 horas`.
- Mensagem de erro vermelha abaixo dos campos.
- Não autenticar no frontend; usar sessão segura no backend.
- Redirecionar ou renderizar o dashboard somente após validar a sessão.

Endpoints sugeridos:

```text
POST /api/admin/auth/login
GET  /api/admin/auth/me
POST /api/admin/auth/logout
```

---

## 3. Layout do dashboard

Sidebar:

- Marca RecuperaBrasil.
- Grupo `OPERAÇÃO`.
- Navegação:
  1. `Gateway`
  2. `Ofertas e pixels`
  3. `Pedidos`
  4. `Retenção`
- Item ativo com fundo verde suave e texto verde.
- Rodapé da sidebar:
  - Indicador verde: `Sistema operacional`
  - Botão `Sair do painel`

Topbar:

- Título/contexto da seção.
- Texto de segurança, como `Ambiente protegido`.
- Avatar circular escuro.
- No mobile, botão para abrir a sidebar.

---

## 4. Aba Gateway

Título:

- Kicker: `CONFIGURAÇÃO`
- Título: `Gateways de pagamento`
- Descrição: `Escolha o gateway ativo e mantenha as credenciais da operação protegidas.`
- Pill verde: `Dados protegidos`

### Lista de gateways

Exiba cartões selecionáveis para:

- FreePay
- BlackCat
- FlevoPay
- Duttyfy
- PinguPag

Cada cartão deve mostrar:

- Rádio visual.
- Logo com a primeira letra.
- Nome.
- Estado:
  - `Ativo`
  - `Configurado`
  - `Aguardando`
- Texto secundário:
  - `Configurado e disponível`
  - `Usa a configuração segura do ambiente`
  - `Integração de cobrança pendente`

Gateways sem adaptador implementado devem ficar desabilitadas e nunca podem ser ativadas.

### Credenciais

Cartão `Credenciais · [gateway]` com:

- Select `Gateway para editar`.
- Campo secreto `Secret key`.
- Campo `Public key` quando a gateway usar esse tipo de chave.
- Campo `Limite máximo por cobrança`, com prefixo `R$`.
- Valores já salvos devem aparecer apenas mascarados.
- Campo vazio significa “manter o valor salvo”, nunca apagar a credencial por acidente.

### Troca de gateway com teste obrigatório

Quando o administrador escolher uma gateway diferente da atualmente ativa e salvar:

1. O botão deve mudar para `Testar PIX e ativar`.
2. O backend deve chamar a API real da gateway escolhida.
3. O teste deve criar um PIX de teste de baixo valor, preferencialmente R$ 1,00, usando dados técnicos de teste.
4. Considere o teste válido somente se a resposta HTTP for bem-sucedida **e** retornar:
   - ID da transação;
   - status;
   - código PIX copia-e-cola ou QR equivalente.
5. Só depois de validar a resposta a gateway pode ser salva como ativa.
6. Se falhar, mantenha a gateway anterior ativa.
7. Nunca mostre a API key no painel ou nos logs.
8. Não salve o PIX de teste como pedido real do cliente.
9. Marque a transação de teste com uma referência técnica, por exemplo `gateway-test-[gateway]-[id]`, para que webhooks de teste sejam ignorados pelo processamento de pedidos e analytics.

Enquanto testa:

- Desabilite o botão.
- Mostre `Gerando PIX de teste...`.
- Não permita dois testes simultâneos.

Em sucesso, mostre no próprio painel um aviso verde:

```text
SUCESSO · BlackCat
PIX de teste de R$ 1,00 gerado com sucesso.
Gateway ativada.
ID: [id da transação]
```

Em falha, mostre um aviso vermelho:

```text
FALHA · BlackCat
[mensagem curta explicando o motivo]
```

Exemplos de motivos:

- `A chave da gateway é inválida ou não tem permissão.`
- `A conta da gateway não tem permissão para criar cobranças.`
- `A gateway está indisponível no momento.`
- `A gateway respondeu, mas não retornou o ID da transação e o código PIX esperado.`
- `A gateway demorou mais que o limite para responder.`

O aviso deve permanecer visível até outro teste ou atualização da tela.

Endpoint sugerido:

```text
POST /api/admin/gateway-test
```

Payload:

```json
{
  "gatewayKey": "blackcat",
  "secretKey": "[somente se uma nova chave foi digitada]",
  "publicKey": "[somente se aplicável]",
  "maxAmountCents": 100000
}
```

Resposta de sucesso:

```json
{
  "success": true,
  "activeGatewayKey": "blackcat",
  "test": {
    "gatewayLabel": "BlackCat",
    "status": "PENDING",
    "transactionId": "id-retornado-pela-gateway",
    "message": "PIX de teste de R$ 1,00 gerado com sucesso."
  }
}
```

Resposta de falha:

```json
{
  "success": false,
  "error": "A chave da gateway é inválida ou não tem permissão."
}
```

Para salvar configurações sem trocar de gateway:

```text
GET /api/admin/gateway-config
GET /api/admin/gateway-keys
PUT /api/admin/gateway-config
```

---

## 5. Aba Ofertas e pixels

Título:

- Kicker: `RASTREAMENTO POR CAMPANHA`
- Título: `Ofertas e pixels`
- Descrição: `Associe um token UTMify e quantos pixels forem necessários a cada identificador público.`
- Botão: `Nova oferta`

Lista lateral de ofertas:

- Nome.
- Slug.
- Estado `Ativa` ou `Inativa`.
- Seleção visual.

Editor de oferta:

- `Nome da oferta`
- `Slug público`
- `Token UTMify`
- Checkbox `Oferta ativa`
- Lista ilimitada de pixels, com:
  - Plataforma: UTMify, Meta ou TikTok.
  - ID do pixel.
  - Nome/label opcional.
  - Botão remover.
- Estado vazio: `Nenhum pixel cadastrado`.
- Botões `Salvar oferta` e `Excluir`.
- Tokens devem ser mascarados na resposta e nunca enviados completos para o navegador após o salvamento.
- Validar slug, token mínimo e IDs duplicados antes de salvar.

Endpoints sugeridos:

```text
GET    /api/admin/offers
POST   /api/admin/offers
PUT    /api/admin/offers/:id
DELETE /api/admin/offers/:id
```

---

## 6. Aba Pedidos

Título:

- Kicker: `OPERAÇÃO AO VIVO`
- Título: `Pedidos`
- Descrição: `Pedidos persistidos dos gateways ativos com atualização automática.`
- Botão `Atualizar`

Cards de indicadores:

- `Pedidos totais`
- `Aguardando PIX`
- `Pagamentos aprovados`
- `Receita aprovada`

Tabela responsiva com:

- Cliente.
- E-mail.
- Gateway.
- Valor.
- Status.
- Data.
- ID da transação.

Ferramentas:

- Busca por cliente, e-mail ou ID.
- Filtro por status:
  - Todos
  - Pendente
  - Pago
  - Falhou
  - Cancelado
  - Expirado

Status:

- Pendente: âmbar.
- Pago: verde.
- Falhou/cancelado/expirado: vermelho.

Ao clicar em um pedido, abra um drawer lateral com:

- Nome e e-mail.
- Valor.
- Gateway.
- ID da transação.
- CPF e telefone mascarados.
- Chave PIX mascarada.
- Código PIX mascarado.
- Data de criação e aprovação.
- Status.
- Ações disponíveis, sem expor dados sensíveis.

Endpoints sugeridos:

```text
GET   /api/admin/orders
GET   /api/admin/orders/:id
PATCH /api/admin/orders/:id/status
GET   /api/admin/metrics
```

---

## 7. Aba Retenção

Crie uma visão de indicadores com:

- Hero de retenção com percentual geral.
- Quantidade de clientes recorrentes.
- Taxa de repetição.
- Período analisado.
- Anotação explicativa.

Funil em três cartões:

1. `Consulta`
2. `Identidade`
3. `Recebimento`

Cada cartão deve mostrar:

- Sessões únicas.
- Taxa em relação à etapa anterior.
- Barra de progresso colorida.

Importante: retenção deve ser calculada a partir de sessões anônimas nas etapas do funil, não a partir da quantidade de pedidos PIX.

Endpoint sugerido:

```text
GET /api/admin/metrics
```

---

## 8. Responsividade e acessibilidade

- Em telas menores que aproximadamente 760 px, transformar a sidebar em menu lateral.
- Tabelas devem ter rolagem horizontal sem quebrar o layout.
- Cards devem virar uma coluna.
- Botões devem ter área de toque confortável.
- Usar `role="status"` nos avisos de teste.
- Usar `aria-label` nos ícones e botões sem texto.
- Não depender somente de cor: sucesso/falha também deve ter ícone e texto.
- Preservar foco de teclado e estados de erro nos campos.

---

## 9. Regras de segurança e confiabilidade

- Todas as rotas `/api/admin/*` exigem sessão administrativa válida.
- Credenciais de gateway ficam somente no backend e em variáveis de ambiente ou armazenamento seguro.
- Mascarar secret keys, tokens, CPF, telefone, chave PIX e códigos PIX no frontend.
- Validar também no backend tudo que for validado no frontend.
- Não usar fallback silencioso para gateway não suportada.
- Se o teste da nova gateway falhar, não alterar a gateway ativa.
- Atualizações de status de pedido devem ser idempotentes.
- Webhooks com referência de teste não podem gerar pedido, receita ou evento UTMify.
- Não registrar payloads completos de gateway em logs.
- Usar timeout, tratamento de erro e mensagens curtas e úteis.

---

## 10. Critérios de aceite

Considere o trabalho concluído somente quando:

- O login administrativo funciona com sessão segura.
- As quatro abas estão implementadas e navegáveis.
- O visual é responsivo e segue a paleta e a hierarquia descritas.
- É possível configurar e mascarar credenciais.
- Trocar de gateway sempre passa pelo teste de geração de PIX.
- Sucesso ativa a nova gateway e mostra aviso verde `SUCESSO`.
- Falha mantém a gateway anterior e mostra aviso vermelho `FALHA` com motivo.
- Gateways sem adaptador não podem ser ativadas.
- Pedidos, ofertas, pixels e métricas usam persistência real.
- Nenhuma chave ou token privado aparece no frontend, na resposta pública ou nos logs.
- Typecheck, build e lint/format passam sem erros.

Ao terminar, informe quais endpoints foram conectados, quais gateways realmente possuem adaptador e quais credenciais ainda precisam ser configuradas no ambiente. Não invente uma integração funcional para uma gateway cuja documentação não foi fornecida.