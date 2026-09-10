import { useEffect, useMemo, useState, type FormEvent, type ReactNode, type CSSProperties } from "react";
import {
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Layers3,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Users,
  WalletCards,
  Download,
  X,
} from "lucide-react";
import "./admin.css";

type Tab = "gateway" | "pixels" | "orders" | "retention";
type OrderStatus = "pending" | "paid" | "failed" | "cancelled" | "expired";

type Gateway = {
  key: string;
  label: string;
  supported: boolean;
  configured: boolean;
  maxAmountCents: number;
  documentationUrl?: string;
};

const DEFAULT_GATEWAYS: Gateway[] = [
  { key: "freepay", label: "FreePay", supported: true, configured: false, maxAmountCents: 10000000 },
  { key: "blackcat", label: "BlackCat", supported: true, configured: false, maxAmountCents: 10000000 },
  { key: "flevopay", label: "FlevoPay", supported: true, configured: false, maxAmountCents: 10000000, documentationUrl: "https://app.flevopay.com.br/documentation" },
  { key: "duttyfy", label: "Duttyfy", supported: false, configured: false, maxAmountCents: 10000000 },
  { key: "pingupag", label: "PinguPag", supported: true, configured: false, maxAmountCents: 10000000, documentationUrl: "https://app.pingupag.com/documentation" },
  { key: "magicpay", label: "MagicPay", supported: true, configured: false, maxAmountCents: 10000000, documentationUrl: "https://app.dashboardmagicpay.com/docs/intro/first-steps" },
];

type Order = {
  id: number;
  reference: string;
  gatewayKey: string;
  gatewayLabel: string;
  gatewayTransactionId: string | null;
  pixCode: string | null;
  qrCodeUrl: string | null;
  amountCents: number;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerDocument: string;
  pixKey: string | null;
  offerSlug: string | null;
  status: OrderStatus;
  createdAt: string;
  approvedAt: string | null;
  pixCopied: boolean;
};

type Metrics = {
  total: number;
  pending: number;
  paid: number;
  paidRevenueCents: number;
  copied: number;
  customers: number;
  retention: {
    returningCustomers: number;
    repeatRate: number;
    note: string;
    periodDays: number;
    overallRate: number;
    funnel: Array<{
      key: "consulta" | "identidade" | "recebimento";
      label: string;
      sessions: number;
      rateFromPrevious: number;
      retentionFromConsultation: number;
    }>;
  };
  quiz: {
    periodDays: number;
    started: number;
    completed: number;
    completionRate: number;
    questions: Array<{
      index: number;
      sessions: number;
      reachRate: number;
      rateFromPrevious: number;
    }>;
  };
};

type GatewayKeys = { gatewayKey: string; secretKey: string | null; publicKey: string | null };
type GatewayTestState = {
  success: boolean;
  gatewayLabel: string;
  message: string;
  transactionId?: string;
};
type TrackingPixel = {
  id: number;
  platform: "utmify" | "meta" | "tiktok";
  pixelId: string;
  code: string | null;
  token: string | null;
  label: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = (value: string) => new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function formatCpfDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) return value;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

function formatPhoneDisplay(value: string) {
  const digits = value.replace(/\D/g, "");
  const local = digits.length > 11 ? digits.slice(-11) : digits;
  if (local.length === 11) return local.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (local.length === 10) return local.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value;
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível concluir a operação.");
  return payload as T;
}

function AdminLogo() {
  return (
    <div className="admin-brand">
      <div className="admin-brand-mark"><WalletCards size={19} /></div>
      <div><strong>Recupera<span>Brasil</span></strong><small>Central administrativa</small></div>
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api("/admin/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
      onLogin();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="admin-login-page">
      <div className="admin-login-orb admin-login-orb--one" />
      <div className="admin-login-orb admin-login-orb--two" />
      <section className="admin-login-card">
        <AdminLogo />
        <div className="admin-login-copy">
          <p className="admin-kicker">Área restrita</p>
          <h1>Bem-vindo ao painel</h1>
          <p>Entre para acompanhar pagamentos, gateways e indicadores da operação.</p>
        </div>
        <form onSubmit={submit} className="admin-form">
          <label>Usuário<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Seu usuário" required /></label>
          <label>Senha<div className="admin-password-field"><input autoComplete="current-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" required /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
          {error && <p className="admin-error"><AlertCircle size={15} />{error}</p>}
          <button className="admin-primary-button" type="submit" disabled={loading}>{loading ? <RefreshCw size={17} className="spin" /> : <ShieldCheck size={17} />} {loading ? "Validando..." : "Entrar com segurança"}</button>
        </form>
        <p className="admin-login-footnote"><LockIcon /> Sessão protegida e válida por 8 horas</p>
      </section>
    </main>
  );
}

function LockIcon() {
  return <span className="admin-lock-icon"><ShieldCheck size={13} /> Ambiente protegido</span>;
}

function StatCard({ label, value, detail, icon, tone = "mint" }: { label: string; value: string; detail?: string; icon: ReactNode; tone?: string }) {
  return <article className={`admin-stat-card admin-stat-card--${tone}`}><div className="admin-stat-top"><span>{label}</span><span className="admin-stat-icon">{icon}</span></div><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const labels: Record<OrderStatus, string> = { pending: "Pendente", paid: "Pago", failed: "Falhou", cancelled: "Cancelado", expired: "Expirado" };
  return <span className={`admin-status admin-status--${status}`}><i />{labels[status]}</span>;
}

function Sidebar({ tab, setTab, onLogout, open, onClose }: { tab: Tab; setTab: (tab: Tab) => void; onLogout: () => void; open: boolean; onClose: () => void }) {
  const items: Array<{ key: Tab; label: string; icon: ReactNode }> = [
    { key: "gateway", label: "Gateway", icon: <CreditCard size={18} /> },
    { key: "pixels", label: "Pixels", icon: <Layers3 size={18} /> },
    { key: "orders", label: "Pedidos", icon: <Clipboard size={18} /> },
    { key: "retention", label: "Retenção", icon: <BarChart3 size={18} /> },
  ];
  return <aside className={`admin-sidebar ${open ? "is-open" : ""}`}>
    <div className="admin-sidebar-head"><AdminLogo /><button className="admin-sidebar-close" onClick={onClose} aria-label="Fechar menu"><X size={20} /></button></div>
    <div className="admin-sidebar-label">Operação</div>
    <nav>{items.map((item) => <button key={item.key} className={tab === item.key ? "is-active" : ""} onClick={() => { setTab(item.key); onClose(); }}>{item.icon}<span>{item.label}</span>{tab === item.key && <ChevronRight size={15} />}</button>)}</nav>
    <div className="admin-sidebar-bottom"><div className="admin-online"><i /> Sistema operacional</div><button className="admin-logout-button" onClick={onLogout}><LogOut size={17} /> Sair do painel</button></div>
  </aside>;
}

function GatewayPanel({ gateways, activeGatewayKey, productName, originalFeeCents, feeCents, keys, reload, toast }: { gateways: Gateway[]; activeGatewayKey: string; productName: string; originalFeeCents: number; feeCents: number; keys: GatewayKeys[]; reload: () => Promise<void>; toast: (message: string) => void }) {
  const [selected, setSelected] = useState(activeGatewayKey || "freepay");
  const [activateOnSave, setActivateOnSave] = useState(false);
  const [limit, setLimit] = useState("100000");
  const [productNameDraft, setProductNameDraft] = useState(productName);
  const [originalFeeDraft, setOriginalFeeDraft] = useState(String(originalFeeCents / 100));
  const [feeDraft, setFeeDraft] = useState(String(feeCents / 100));
  const [secretKey, setSecretKey] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<GatewayTestState | null>(null);
  const selectedGateway = gateways.find((gateway) => gateway.key === selected);
  const selectedKeys = keys.find((item) => item.gatewayKey === selected);
  const isSelectedActive = selected === activeGatewayKey;
  const changingGateway = !isSelectedActive && activateOnSave;

  useEffect(() => {
    // Only snap back to the active gateway if the current selection stops
    // existing (e.g. first load) — never discard what the admin is viewing.
    setSelected((current) => gateways.some((gateway) => gateway.key === current) ? current : (activeGatewayKey || "freepay"));
  }, [activeGatewayKey, gateways]);

  useEffect(() => {
    setActivateOnSave(false);
    setTestState(null);
    setSecretKey("");
    setPublicKey("");
  }, [selected]);

  useEffect(() => {
    if (selectedGateway) setLimit(String(Math.round(selectedGateway.maxAmountCents / 100)));
  }, [selectedGateway]);

  useEffect(() => {
    setProductNameDraft(productName);
  }, [productName]);

  useEffect(() => {
    setOriginalFeeDraft(String(originalFeeCents / 100));
  }, [originalFeeCents]);

  useEffect(() => {
    setFeeDraft(String(feeCents / 100));
  }, [feeCents]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setTestState(null);
    const amountCents = Math.max(0, Math.round(Number(limit.replace(",", ".")) * 100));
    const originalFeeCentsValue = Math.max(0, Math.round(Number(originalFeeDraft.replace(",", ".")) * 100));
    const feeCentsValue = Math.max(0, Math.round(Number(feeDraft.replace(",", ".")) * 100));
    if (!originalFeeCentsValue || !feeCentsValue) {
      toast("Informe valores válidos para o preço riscado e o valor do PIX.");
      setSaving(false);
      return;
    }
    if (feeCentsValue > originalFeeCentsValue) {
      toast("O valor do PIX não pode ser maior que o valor riscado.");
      setSaving(false);
      return;
    }
    try {
      if (changingGateway) {
        const result = await api<{ test: { gatewayLabel: string; message: string; transactionId?: string } }>("/admin/gateway-test", {
          method: "POST",
          body: JSON.stringify({
            gatewayKey: selected,
            maxAmountCents: amountCents,
            secretKey: secretKey || undefined,
            publicKey: publicKey || undefined,
          }),
        });
        if ((productNameDraft.trim() && productNameDraft.trim() !== productName)
          || originalFeeCentsValue !== originalFeeCents || feeCentsValue !== feeCents) {
          await api("/admin/gateway-config", { method: "PUT", body: JSON.stringify({
            productName: productNameDraft.trim() || undefined,
            originalFeeCents: originalFeeCentsValue,
            feeCents: feeCentsValue,
          }) });
        }
        setTestState({
          success: true,
          gatewayLabel: result.test.gatewayLabel,
          message: result.test.message,
          transactionId: result.test.transactionId,
        });
        toast("PIX de teste gerado. Gateway ativada.");
        setActivateOnSave(false);
      } else {
        await api("/admin/gateway-config", { method: "PUT", body: JSON.stringify({
          gatewayKey: selected,
          maxAmountCents: amountCents,
          productName: productNameDraft.trim() || undefined,
          originalFeeCents: originalFeeCentsValue,
          feeCents: feeCentsValue,
          secretKey: secretKey || undefined,
          publicKey: publicKey || undefined,
        }) });
        toast("Configuração salva com segurança.");
      }
      setSecretKey("");
      setPublicKey("");
      await reload();
    } catch (error) {
      if (changingGateway) {
        setTestState({
          success: false,
          gatewayLabel: selectedGateway?.label || "Gateway",
          message: error instanceof Error ? error.message : "O teste não conseguiu gerar um PIX.",
        });
      }
      toast(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="admin-panel-stack">
    <div className="admin-page-heading"><div><p className="admin-kicker">Configuração</p><h1>Gateways de pagamento</h1><p>Escolha o gateway ativo e mantenha as credenciais da operação protegidas.</p></div><span className="admin-live-pill"><i /> Dados protegidos</span></div>
    <form onSubmit={save} className="admin-gateway-layout">
      <section className="admin-card admin-gateway-main">
        <div className="admin-card-heading"><div><h2>Gateway ativo</h2><p>O checkout público usa o gateway selecionado quando a integração estiver disponível.</p></div><Settings2 size={20} /></div>
          <div className="admin-gateway-options">{gateways.map((gateway) => <button type="button" key={gateway.key} className={`admin-gateway-option ${selected === gateway.key ? "is-selected" : ""} ${!gateway.supported ? "is-disabled" : ""}`} onClick={() => setSelected(gateway.key)}><span className="admin-gateway-radio">{selected === gateway.key && <i />}</span><span className="admin-gateway-logo">{gateway.label.slice(0, 1)}</span><span className="admin-gateway-name"><strong>{gateway.label}</strong><small>{gateway.supported ? (gateway.configured ? "Configurado e disponível" : "Usa a configuração segura do ambiente") : gateway.documentationUrl ? "Documentação disponível · integração pendente" : "Integração de cobrança pendente"}</small></span><span className={activeGatewayKey === gateway.key ? "admin-configured" : "admin-not-configured"}>{activeGatewayKey === gateway.key ? "Ativo" : gateway.configured ? "Configurado" : "Aguardando"}</span></button>)}</div>
          <div className="admin-info-callout"><ShieldCheck size={18} /><span><strong>{gateways.find((gateway) => gateway.key === activeGatewayKey)?.label || "Gateway"} será usado pelo checkout.</strong> Clicar em um gateway apenas abre suas credenciais — marque “Tornar ativo” para trocar quem processa os pagamentos.</span></div>
          <label className="admin-field-label admin-product-name-field">Nome do produto enviado ao gateway<input value={productNameDraft} onChange={(event) => setProductNameDraft(event.target.value)} placeholder="Ex.: Ebook Emagrecimento*" maxLength={150} data-testid="input-product-name" /><small>Aparece como a descrição do item na cobrança PIX gerada, em todos os gateways.</small></label>
          <div className="admin-price-fields">
            <label className="admin-field-label">Preço riscado (de)<div className="admin-input-prefix"><span>R$</span><input inputMode="decimal" value={originalFeeDraft} onChange={(event) => setOriginalFeeDraft(event.target.value)} data-testid="input-original-fee" /></div><small>Valor mostrado cortado na tela de checkout, antes do desconto.</small></label>
            <label className="admin-field-label">Valor do PIX (por)<div className="admin-input-prefix"><span>R$</span><input inputMode="decimal" value={feeDraft} onChange={(event) => setFeeDraft(event.target.value)} data-testid="input-fee" /></div><small>Valor real cobrado no PIX de confirmação, em todos os gateways.</small></label>
          </div>
          {testState && <div className={`admin-gateway-test ${testState.success ? "admin-gateway-test--success" : "admin-gateway-test--failure"}`} role="status">
            {testState.success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span><strong>{testState.success ? "SUCESSO" : "FALHA"} · {testState.gatewayLabel}</strong><small>{testState.message}{testState.transactionId ? ` ID: ${testState.transactionId}` : ""}</small></span>
          </div>}
      </section>
      <section className="admin-card admin-credentials-card">
        <div className="admin-card-heading"><div><h2>Credenciais · {selectedGateway?.label || "FreePay"}</h2><p>Valores salvos nunca são exibidos por completo.</p></div><KeyRound size={20} /></div>
        <label className="admin-field-label">Gateway para editar<select value={selected} onChange={(event) => setSelected(event.target.value)}>{gateways.map((gateway) => <option key={gateway.key} value={gateway.key}>{gateway.label}</option>)}</select></label>
         {selectedGateway?.documentationUrl && <a className="admin-documentation-link" href={selectedGateway.documentationUrl} target="_blank" rel="noreferrer">Abrir documentação oficial <ChevronRight size={14} /></a>}
        <label className="admin-field-label">Secret key<input type="password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} placeholder={selectedKeys?.secretKey || "Digite para substituir"} autoComplete="new-password" /></label>
        <label className="admin-field-label">Public key<input type="text" value={publicKey} onChange={(event) => setPublicKey(event.target.value)} placeholder={selectedKeys?.publicKey || "Digite para substituir"} autoComplete="off" /></label>
        <label className="admin-field-label">Limite máximo por cobrança<div className="admin-input-prefix"><span>R$</span><input inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} /></div></label>
        {!isSelectedActive && <label className="admin-field-label admin-activate-toggle">
          <input type="checkbox" checked={activateOnSave} onChange={(event) => setActivateOnSave(event.target.checked)} />
          <span>Tornar {selectedGateway?.label} o gateway ativo ao salvar (gera um PIX real de teste e só ativa se ele funcionar)</span>
        </label>}
         <button className="admin-primary-button" type="submit" disabled={saving}>{saving ? <RefreshCw size={17} className="spin" /> : changingGateway ? <ShieldCheck size={17} /> : <Check size={17} />} {saving ? "Gerando PIX de teste..." : changingGateway ? "Testar PIX e ativar" : "Salvar configurações"}</button>
      </section>
    </form>
  </div>;
}

function OrdersPanel({ orders, metrics, reload, toast }: { orders: Order[]; metrics: Metrics | null; reload: () => Promise<void>; toast: (message: string) => void }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | OrderStatus>("all");
  const [selected, setSelected] = useState<Order | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const visibleOrders = useMemo(() => orders.filter((order) => {
    const term = search.toLowerCase();
    const digits = search.replace(/\D/g, "");
    const matchesSearch = !term
      || order.customerName.toLowerCase().includes(term)
      || order.customerEmail.toLowerCase().includes(term)
      || (order.gatewayTransactionId || "").toLowerCase().includes(term)
      || (digits.length >= 3 && (order.customerPhone.includes(digits) || order.customerDocument.includes(digits)));
    return matchesSearch && (filter === "all" || order.status === filter);
  }), [orders, search, filter]);

  const changeStatus = async (status: OrderStatus) => {
    if (!selected) return;
    try {
      await api(`/admin/orders/${selected.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast("Status atualizado.");
      setSelected({ ...selected, status, approvedAt: status === "paid" ? new Date().toISOString() : selected.approvedAt });
      await reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Não foi possível atualizar.");
    }
  };

  return <div className="admin-panel-stack">
    <div className="admin-page-heading"><div><p className="admin-kicker">Operação ao vivo</p><h1>Pedidos</h1><p>Pedidos persistidos dos gateways ativos com atualização automática.</p></div><div className="admin-page-heading-actions"><button className="admin-outline-button" onClick={() => setExportOpen(true)}><Download size={16} /> Exportar leads</button><button className="admin-outline-button" onClick={() => void reload()}><RefreshCw size={16} /> Atualizar</button></div></div>
    <div className="admin-stats-grid">
      <StatCard label="Pedidos totais" value={String(metrics?.total || 0)} detail="Todo o histórico salvo" icon={<Clipboard size={18} />} />
      <StatCard label="Aguardando PIX" value={String(metrics?.pending || 0)} detail="Pagamento pendente" icon={<Gauge size={18} />} tone="amber" />
      <StatCard label="Pagamentos aprovados" value={String(metrics?.paid || 0)} detail={money(metrics?.paidRevenueCents || 0)} icon={<CheckCircle2 size={18} />} tone="blue" />
      <StatCard label="PIX copiado" value={String(metrics?.copied || 0)} detail="Intenção registrada" icon={<Copy size={18} />} tone="violet" />
    </div>
    <section className="admin-card admin-orders-card">
      <div className="admin-orders-toolbar"><div className="admin-search"><Search size={17} /><input placeholder="Buscar por nome, e-mail, telefone, CPF ou transação" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select className="admin-filter" value={filter} onChange={(event) => setFilter(event.target.value as "all" | OrderStatus)}><option value="all">Todos os status</option><option value="pending">Pendentes</option><option value="paid">Pagos</option><option value="failed">Falhos</option><option value="cancelled">Cancelados</option></select></div>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Valor</th><th>Status</th><th>Data</th><th /></tr></thead><tbody>{visibleOrders.map((order) => <tr key={order.id} onClick={() => setSelected(order)}><td><strong>#{String(order.id).padStart(5, "0")}</strong><small>{order.gatewayTransactionId || order.reference}</small></td><td><strong>{order.customerName}</strong><small>{order.customerEmail}</small></td><td><strong>{money(order.amountCents)}</strong><small>{order.gatewayLabel}</small></td><td><StatusBadge status={order.status} /></td><td><span>{dateTime(order.createdAt)}</span><small>{order.pixCopied ? "PIX copiado" : "Sem cópia registrada"}</small></td><td><ChevronRight size={17} /></td></tr>)}</tbody></table>{visibleOrders.length === 0 && <div className="admin-empty-state"><Clipboard size={26} /><strong>Nenhum pedido encontrado</strong><span>Os pedidos gerados no checkout aparecerão aqui.</span></div>}</div>
    </section>
    {selected && <OrderDrawer order={selected} onClose={() => setSelected(null)} onStatus={changeStatus} toast={toast} />}
    {exportOpen && <LeadsExportDialog orders={visibleOrders} totalCount={orders.length} search={search} filter={filter} onClose={() => setExportOpen(false)} toast={toast} />}
  </div>;
}

type LeadField = "name" | "phone" | "email" | "document";

const LEAD_FIELD_LABELS: Record<LeadField, string> = { name: "Nome", phone: "Telefone", email: "E-mail", document: "CPF" };

function buildLeadsNotepad(orders: Order[], fields: Record<LeadField, boolean>): string {
  const activeFields = (Object.keys(LEAD_FIELD_LABELS) as LeadField[]).filter((field) => fields[field]);
  const exportedAt = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const divider = "─".repeat(38);
  const lines: string[] = [
    "LEADS · RECUPERA BRASIL",
    `Exportado em ${exportedAt} · ${orders.length} lead${orders.length === 1 ? "" : "s"}`,
    divider,
  ];
  orders.forEach((order, index) => {
    lines.push(`${index + 1}) ${order.customerName}`);
    if (activeFields.includes("name") && activeFields.length > 1) lines.push(`   Nome: ${order.customerName}`);
    if (activeFields.includes("phone")) lines.push(`   Telefone: ${order.customerPhone ? formatPhoneDisplay(order.customerPhone) : "Não informado"}`);
    if (activeFields.includes("email")) lines.push(`   E-mail: ${order.customerEmail}`);
    if (activeFields.includes("document")) lines.push(`   CPF: ${order.customerDocument ? formatCpfDisplay(order.customerDocument) : "Não informado"}`);
    lines.push(`   Status: ${{ pending: "Pendente", paid: "Pago", failed: "Falhou", cancelled: "Cancelado", expired: "Expirado" }[order.status]} · ${money(order.amountCents)} · ${dateTime(order.createdAt)}`);
    lines.push(`   PIX copiado: ${order.pixCopied ? "Sim" : "Não"}`);
    lines.push(divider);
  });
  return lines.join("\n");
}

function LeadsExportDialog({ orders, totalCount, search, filter, onClose, toast }: { orders: Order[]; totalCount: number; search: string; filter: "all" | OrderStatus; onClose: () => void; toast: (message: string) => void }) {
  const [fields, setFields] = useState<Record<LeadField, boolean>>({ name: true, phone: true, email: true, document: true });
  const anyFieldSelected = Object.values(fields).some(Boolean);
  const toggleField = (field: LeadField) => setFields((current) => ({ ...current, [field]: !current[field] }));

  const copyNotepad = async () => {
    const text = buildLeadsNotepad(orders, fields);
    try {
      await navigator.clipboard.writeText(text);
      toast("Bloco de notas copiado.");
    } catch {
      toast("Não foi possível copiar automaticamente. Use o botão de baixar.");
    }
  };

  const downloadNotepad = () => {
    const text = buildLeadsNotepad(orders, fields);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leads-recupera-brasil-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return <div className="admin-drawer-backdrop" onClick={onClose}>
    <aside className="admin-order-drawer" onClick={(event) => event.stopPropagation()}>
      <div className="admin-drawer-head"><div><p className="admin-kicker">Exportar</p><h2>Bloco de notas de leads</h2></div><button onClick={onClose} aria-label="Fechar exportação"><X size={20} /></button></div>
      <p className="admin-export-summary">
        {orders.length} de {totalCount} pedido{totalCount === 1 ? "" : "s"} serão exportados
        {filter !== "all" ? ` · status: ${{ pending: "Pendentes", paid: "Pagos", failed: "Falhos", cancelled: "Cancelados", expired: "Expirados" }[filter]}` : ""}
        {search ? ` · busca: "${search}"` : ""}. Ajuste os filtros da lista antes de exportar.
      </p>
      <div className="admin-export-fields">
        {(Object.keys(LEAD_FIELD_LABELS) as LeadField[]).map((field) => (
          <label className="admin-export-field-toggle" key={field}>
            <input type="checkbox" checked={fields[field]} onChange={() => toggleField(field)} />
            <span>{LEAD_FIELD_LABELS[field]}</span>
          </label>
        ))}
      </div>
      {!anyFieldSelected && <p className="admin-error"><AlertCircle size={15} />Selecione ao menos um campo para exportar.</p>}
      <div className="admin-drawer-actions">
        <button className="admin-copy-button" type="button" disabled={!anyFieldSelected || orders.length === 0} onClick={() => void copyNotepad()}><Copy size={17} /> Copiar bloco de notas</button>
        <button className="admin-whatsapp-button" type="button" disabled={!anyFieldSelected || orders.length === 0} onClick={downloadNotepad}><Download size={17} /> Baixar .txt</button>
      </div>
    </aside>
  </div>;
}

function OrderDrawer({ order, onClose, onStatus, toast }: { order: Order; onClose: () => void; onStatus: (status: OrderStatus) => Promise<void>; toast: (message: string) => void }) {
  const whatsapp = `https://wa.me/55${order.customerPhone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá, ${order.customerName}! Vi que seu pagamento PIX está com status ${order.status === "pending" ? "pendente" : order.status}. Posso te ajudar?`)}`;
  return <div className="admin-drawer-backdrop" onClick={onClose}><aside className="admin-order-drawer" onClick={(event) => event.stopPropagation()}><div className="admin-drawer-head"><div><p className="admin-kicker">Detalhe do pedido</p><h2>#{String(order.id).padStart(5, "0")}</h2></div><button onClick={onClose} aria-label="Fechar detalhes"><X size={20} /></button></div><div className="admin-drawer-status"><StatusBadge status={order.status} /><span>{dateTime(order.createdAt)}</span></div><div className="admin-drawer-amount"><small>Valor da cobrança</small><strong>{money(order.amountCents)}</strong><span>{order.gatewayLabel} · {order.gatewayTransactionId || "sem ID externo"}</span></div><div className="admin-detail-list"><div><span>Cliente</span><strong>{order.customerName}</strong></div><div><span>E-mail</span><strong>{order.customerEmail}</strong></div><div><span>Telefone</span><strong>{order.customerPhone || "Não informado"}</strong></div><div><span>CPF</span><strong>{order.customerDocument}</strong></div><div><span>Chave PIX</span><strong>{order.pixKey || "Não informada"}</strong></div><div><span>Oferta</span><strong>{order.offerSlug || "Fallback padrão"}</strong></div><div><span>PIX copiado</span><strong>{order.pixCopied ? "Sim" : "Não"}</strong></div></div><div className="admin-drawer-actions"><a className="admin-whatsapp-button" href={whatsapp} target="_blank" rel="noreferrer"><MessageCircle size={17} /> Abrir WhatsApp</a><button className="admin-copy-button" onClick={() => { void navigator.clipboard?.writeText(order.gatewayTransactionId || order.reference); toast("ID copiado."); }}><Copy size={17} /> Copiar ID</button></div><label className="admin-field-label">Alterar status<select value={order.status} onChange={(event) => void onStatus(event.target.value as OrderStatus)}><option value="pending">Pendente</option><option value="paid">Pago</option><option value="failed">Falhou</option><option value="cancelled">Cancelado</option><option value="expired">Expirado</option></select></label></aside></div>;
}

type TrackingPixelDraft = {
  id: number | null;
  platform: TrackingPixel["platform"];
  pixelId: string;
  code: string;
  token: string;
  tokenHint: string | null;
  label: string;
};

function draftFromPixels(pixels: TrackingPixel[]): TrackingPixelDraft[] {
  return pixels.map((pixel) => ({
    id: pixel.id,
    platform: pixel.platform,
    pixelId: pixel.pixelId,
    code: pixel.code || "",
    token: "",
    tokenHint: pixel.token,
    label: pixel.label || "",
  }));
}

function emptyPixel(platform: TrackingPixel["platform"] = "utmify"): TrackingPixelDraft {
  return { id: null, platform, pixelId: "", code: "", token: "", tokenHint: null, label: "" };
}

function TrackingPixelsPanel({ pixels, reload, toast }: { pixels: TrackingPixel[]; reload: () => Promise<void>; toast: (message: string) => void }) {
  const [draft, setDraft] = useState<TrackingPixelDraft[]>(() => draftFromPixels(pixels));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(draftFromPixels(pixels));
  }, [pixels]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api("/admin/tracking-pixels", {
        method: "PUT",
        body: JSON.stringify({
          pixels: draft.map((pixel) => ({
            id: pixel.id,
            platform: pixel.platform,
            pixelId: pixel.pixelId.trim(),
            ...(pixel.code.trim() ? { code: pixel.code } : {}),
            ...(pixel.token.trim() ? { token: pixel.token } : {}),
            ...(pixel.label.trim() ? { label: pixel.label.trim() } : {}),
          })),
        }),
      });
      await reload();
      toast("Pixels salvos e publicados em todo o sistema.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Não foi possível salvar os pixels.");
    } finally {
      setSaving(false);
    }
  };

  const updatePixel = (index: number, patch: Partial<TrackingPixelDraft>) => {
    setDraft((current) => current.map((pixel, itemIndex) => itemIndex === index ? { ...pixel, ...patch } : pixel));
  };

  return <div className="admin-panel-stack">
    <div className="admin-page-heading"><div><p className="admin-kicker">Rastreamento global</p><h1>Pixels</h1><p>Cadastre quantos pixels UTMify, Facebook e TikTok precisar. Todos ficam ativos em todas as etapas do sistema.</p></div><button className="admin-outline-button" type="button" onClick={() => setDraft((current) => [...current, emptyPixel()])}><Plus size={17} /> Adicionar pixel</button></div>
    <div className="admin-info-callout"><ShieldCheck size={18} /><span><strong>Configuração global.</strong> Ao salvar, os IDs e códigos públicos são carregados no site inteiro. Os tokens ficam somente no servidor e são preservados quando você deixa o campo vazio.</span></div>
    <form className="admin-card admin-pixels-editor" onSubmit={save}>
      <div className="admin-card-heading"><div><h2>Pixels cadastrados</h2><p>Facebook e TikTok pedem ID, código e token de API. Para UTMify, o ID é o pixel do navegador e o token é a credencial de API usada para enviar as vendas (pendentes e aprovadas) para a UTMify — são coisas diferentes.</p></div><KeyRound size={20} /></div>
      <div className="admin-pixel-list">
        {draft.map((pixel, index) => <div className="admin-pixel-config-row" key={pixel.id ?? `new-${index}`}>
          <div className="admin-pixel-config-head"><span className={`admin-pixel-platform admin-pixel-platform--${pixel.platform}`}>{pixel.platform === "meta" ? "Facebook" : pixel.platform === "tiktok" ? "TikTok" : "UTMify"}</span><button className="admin-pixel-remove" type="button" onClick={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remover pixel"><Trash2 size={16} /></button></div>
          <div className="admin-pixel-config-grid">
            <label className="admin-field-label">Plataforma<select value={pixel.platform} onChange={(event) => updatePixel(index, { platform: event.target.value as TrackingPixel["platform"] })}><option value="utmify">UTMify</option><option value="meta">Facebook</option><option value="tiktok">TikTok</option></select></label>
            <label className="admin-field-label">{pixel.platform === "utmify" ? "ID do pixel UTMify (script do navegador)" : "ID do pixel"}<input value={pixel.pixelId} onChange={(event) => updatePixel(index, { pixelId: event.target.value })} placeholder="Ex.: 1234567890" required /></label>
            <label className="admin-field-label">Nome opcional<input value={pixel.label} onChange={(event) => updatePixel(index, { label: event.target.value })} placeholder="Ex.: Campanha principal" /></label>
            {pixel.platform !== "utmify" && <label className="admin-field-label admin-pixel-code-field">Código do pixel<textarea value={pixel.code} onChange={(event) => updatePixel(index, { code: event.target.value })} placeholder="Cole o código fornecido pela plataforma" rows={3} /></label>}
            <label className="admin-field-label">{pixel.platform === "utmify" ? "Token da API UTMify (envio de vendas)" : "Token privado"}<input type="password" value={pixel.token} onChange={(event) => updatePixel(index, { token: event.target.value })} placeholder={pixel.tokenHint || (pixel.platform === "utmify" ? "Cole o token de API (api-credentials)" : "Cole o token privado")} autoComplete="new-password" /></label>
            {pixel.platform === "utmify" && <p className="admin-pixel-hint">Esse token não é o pixel — é a credencial de API da UTMify usada para enviar os webhooks de vendas pendentes e aprovadas.</p>}
          </div>
        </div>)}
      </div>
      {draft.length === 0 && <div className="admin-pixel-empty">Nenhum pixel cadastrado. Use “Adicionar pixel” para começar.</div>}
      <div className="admin-offer-actions"><button className="admin-primary-button" type="submit" disabled={saving}>{saving ? <RefreshCw size={17} className="spin" /> : <Check size={17} />} {saving ? "Salvando..." : "Salvar pixels"}</button></div>
    </form>
  </div>;
}

function RetentionPanel({ metrics }: { metrics: Metrics | null }) {
  const total = metrics?.total || 0;
  const paid = metrics?.paid || 0;
  const copied = metrics?.copied || 0;
  const paidRate = total ? Math.round((paid / total) * 100) : 0;
  const copyRate = total ? Math.round((copied / total) * 100) : 0;
  const funnel = metrics?.retention.funnel || [
    { key: "consulta" as const, label: "Consulta", sessions: 0, rateFromPrevious: 100, retentionFromConsultation: 100 },
    { key: "identidade" as const, label: "Identidade", sessions: 0, rateFromPrevious: 0, retentionFromConsultation: 0 },
    { key: "recebimento" as const, label: "Recebimento", sessions: 0, rateFromPrevious: 0, retentionFromConsultation: 0 },
  ];
  const consultationSessions = funnel[0]?.sessions || 0;
  const overallRate = metrics?.retention.overallRate ?? 0;
  const funnelColors = ["", "admin-funnel-bar--amber", "admin-funnel-bar--blue"];
  return <div className="admin-panel-stack">
    <div className="admin-page-heading"><div><p className="admin-kicker">Análise da operação</p><h1>Retenção e funil</h1><p>Retenção real entre Consulta, Identidade e Recebimento nos últimos {metrics?.retention.periodDays || 30} dias.</p></div><span className="admin-live-pill"><i /> Atualizado agora</span></div>
    <div className="admin-retention-hero"><div><span className="admin-retention-icon"><Users size={21} /></span><p className="admin-kicker">Sessões na Consulta</p><strong>{consultationSessions}</strong><span>pessoas que iniciaram o funil</span></div><div className="admin-retention-ring" style={{ "--progress": `${overallRate * 3.6}deg` } as CSSProperties}><strong>{overallRate}%</strong><span>retenção até<br />Recebimento</span></div></div>
    <div className="admin-funnel-grid">{funnel.map((stage, index) => <article className="admin-card admin-funnel-card" key={stage.key}><div className="admin-funnel-title"><span className="admin-funnel-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{stage.label}</strong><small>{index === 0 ? "Entrada do funil" : index === 1 ? "Dados consultados e identidade exibida" : "Etapa de recebimento aberta"}</small></div><strong>{stage.sessions}</strong></div><div className={`admin-funnel-bar ${funnelColors[index]}`}><i style={{ width: `${index === 0 ? 100 : stage.retentionFromConsultation}%` }} /></div><small>{index === 0 ? "100% da base" : `${stage.retentionFromConsultation}% retidos desde a Consulta · ${stage.rateFromPrevious}% da etapa anterior`}</small></article>)}</div>
    <div className="admin-retention-note"><AlertCircle size={18} /><div><strong>Como ler a retenção</strong><p>{consultationSessions ? `De ${consultationSessions} sessões que consultaram valores, ${funnel[1]?.sessions || 0} chegaram à Identidade e ${funnel[2]?.sessions || 0} abriram o Recebimento.` : "As métricas aparecerão quando o primeiro visitante percorrer o funil público."}</p></div></div>
    <QuizRetentionSection quiz={metrics?.quiz} />
    <section className="admin-card admin-retention-orders"><div className="admin-card-heading"><div><h2>Conversão em pagamento</h2><p>Contexto complementar dos pedidos PIX já criados.</p></div><WalletCards size={20} /></div><div className="admin-retention-order-stats"><div><span>Pedidos criados</span><strong>{total}</strong></div><div><span>PIX copiado</span><strong>{copied}</strong><small>{copyRate}% dos pedidos</small></div><div><span>Pagamento aprovado</span><strong>{paid}</strong><small>{paidRate}% dos pedidos</small></div></div></section>
  </div>;
}

function QuizRetentionSection({ quiz }: { quiz: Metrics["quiz"] | undefined }) {
  const started = quiz?.started || 0;
  const questions = quiz?.questions || [];
  const completed = quiz?.completed || 0;
  const completionRate = quiz?.completionRate ?? 0;
  return <section className="admin-card admin-quiz-retention">
    <div className="admin-card-heading"><div><h2>Questionário de elegibilidade</h2><p>Quantas sessões chegaram e abandonaram em cada pergunta, nos últimos {quiz?.periodDays || 30} dias.</p></div><Layers3 size={20} /></div>
    {started === 0
      ? <div className="admin-pixel-empty">Ainda não há sessões suficientes no questionário para calcular a retenção por pergunta.</div>
      : <>
        <div className="admin-quiz-summary">
          <div><span>Iniciaram o questionário</span><strong>{started}</strong></div>
          <div><span>Concluíram todas as perguntas</span><strong>{completed}</strong><small>{completionRate}% de conclusão</small></div>
        </div>
        <div className="admin-quiz-question-list">
          {questions.map((item) => <div className="admin-quiz-question-row" key={item.index}>
            <div className="admin-quiz-question-label"><strong>Pergunta {item.index}</strong><small>{item.sessions} de {started} chegaram aqui</small></div>
            <div className="admin-quiz-question-bar"><i style={{ width: `${item.reachRate}%` }} /></div>
            <div className="admin-quiz-question-rate"><strong>{item.reachRate}%</strong><small>{item.index === 1 ? "do início" : `${item.rateFromPrevious}% da anterior`}</small></div>
          </div>)}
        </div>
      </>}
  </section>;
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("orders");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [gateways, setGateways] = useState<Gateway[]>(DEFAULT_GATEWAYS);
  const [activeGatewayKey, setActiveGatewayKey] = useState("freepay");
  const [productName, setProductName] = useState("Ebook Emagrecimento*");
  const [originalFeeCents, setOriginalFeeCents] = useState(6897);
  const [feeCents, setFeeCents] = useState(4781);
  const [keys, setKeys] = useState<GatewayKeys[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [pixels, setPixels] = useState<TrackingPixel[]>([]);
  const [toastMessage, setToastMessage] = useState("");

  const toast = (message: string) => {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 2800);
  };
  const loadGateway = async () => {
    const [configResult, keysResult] = await Promise.allSettled([
      api<{ activeGatewayKey: string; productName: string; originalFeeCents: number; feeCents: number; gateways: Gateway[] }>("/admin/gateway-config"),
      api<{ gateways: GatewayKeys[] }>("/admin/gateway-keys"),
    ]);
    if (configResult.status === "fulfilled") {
      const config = configResult.value;
      if (Array.isArray(config.gateways) && config.gateways.length > 0) setGateways(config.gateways);
      if (config.activeGatewayKey) setActiveGatewayKey(config.activeGatewayKey);
      if (config.productName) setProductName(config.productName);
      if (typeof config.originalFeeCents === "number") setOriginalFeeCents(config.originalFeeCents);
      if (typeof config.feeCents === "number") setFeeCents(config.feeCents);
    }
    if (keysResult.status === "fulfilled" && Array.isArray(keysResult.value.gateways)) {
      setKeys(keysResult.value.gateways);
    }
    if (configResult.status === "rejected" && keysResult.status === "rejected") {
      throw configResult.reason;
    }
  };
  const loadOrders = async () => {
    const [orderResult, metricResult] = await Promise.allSettled([
      api<{ orders: Order[] }>("/admin/orders"),
      api<{ metrics: Metrics }>("/admin/metrics"),
    ]);
    // A malformed or unexpected response (e.g. the backend isn't fully
    // configured yet) must never replace known-good state with garbage —
    // that's what used to turn one flaky request into a blank crashed panel.
    if (orderResult.status === "fulfilled" && Array.isArray(orderResult.value.orders)) {
      setOrders(orderResult.value.orders);
    }
    if (metricResult.status === "fulfilled" && metricResult.value.metrics) {
      setMetrics(metricResult.value.metrics);
    }
    if (orderResult.status === "rejected" && metricResult.status === "rejected") {
      throw orderResult.reason;
    }
  };
  const loadPixels = async () => {
    const result = await api<{ pixels: TrackingPixel[] }>("/admin/tracking-pixels");
    if (Array.isArray(result.pixels)) setPixels(result.pixels);
  };
  useEffect(() => {
    void Promise.allSettled([loadGateway(), loadOrders(), loadPixels()]);
    const timer = window.setInterval(() => { void loadOrders().catch(() => undefined); }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  return <div className="admin-app"><Sidebar tab={tab} setTab={setTab} onLogout={onLogout} open={sidebarOpen} onClose={() => setSidebarOpen(false)} /><main className="admin-main"><header className="admin-topbar"><button className="admin-menu-button" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button><div className="admin-topbar-title"><span>Painel administrativo</span><small>Visão geral da operação</small></div><div className="admin-topbar-right"><span className="admin-topbar-secure"><ShieldCheck size={16} /> Sessão segura</span><button className="admin-avatar" onClick={onLogout} title="Sair">RB</button></div></header><div className="admin-content">{tab === "gateway" && <GatewayPanel gateways={gateways} activeGatewayKey={activeGatewayKey} productName={productName} originalFeeCents={originalFeeCents} feeCents={feeCents} keys={keys} reload={loadGateway} toast={toast} />}{tab === "pixels" && <TrackingPixelsPanel pixels={pixels} reload={loadPixels} toast={toast} />}{tab === "orders" && <OrdersPanel orders={orders} metrics={metrics} reload={loadOrders} toast={toast} />}{tab === "retention" && <RetentionPanel metrics={metrics} />}</div></main>{toastMessage && <div className="admin-toast"><CheckCircle2 size={17} /> {toastMessage}</div>}</div>;
}

export default function AdminApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ authenticated: boolean }>("/admin/auth/me").then(() => setAuthenticated(true)).catch(() => setAuthenticated(false));
  }, []);
  if (authenticated === null) return <div className="admin-loading"><RefreshCw size={21} className="spin" /> Carregando painel...</div>;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <Dashboard onLogout={() => { void api("/admin/auth/logout", { method: "POST" }).finally(() => setAuthenticated(false)); }} />;
}