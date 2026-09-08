type AnalyticsData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

function getFunnelSessionId(): string | null {
  try {
    let sessionId = localStorage.getItem('recupera_funnel_session');
    if (!sessionId) {
      sessionId = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('recupera_funnel_session', sessionId);
    }
    return sessionId;
  } catch {
    return null;
  }
}

function sendFunnelEvent(eventName: string, stage: string): void {
  const sessionId = getFunnelSessionId();
  if (!sessionId) return;
  try {
    void fetch('/api/analytics/event', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, eventName, stage }),
    }).catch(() => undefined);
  } catch {
    // Funnel telemetry must never break the public flow.
  }
}

export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === 'undefined') return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never break the app.
  }

  if (name !== 'funnel_stage_viewed') return;
  const stageMap: Record<string, string> = {
    intro: 'consulta',
    scanning: 'consulta',
    result: 'identidade',
    verification: 'identidade',
    checkout: 'recebimento',
    success: 'recebimento',
  };
  const rawStage = typeof data?.stage === 'string' ? data.stage : '';
  const stage = stageMap[rawStage];
  if (!stage) return;
  sendFunnelEvent(name, stage);
}

/** Records that the visitor reached a given eligibility-quiz question, so
 * the admin Retention panel can show response/drop-off rate per question. */
export function trackQuizQuestionViewed(questionIndex: number): void {
  if (typeof window === 'undefined') return;
  sendFunnelEvent('quiz_question_viewed', `q${questionIndex + 1}`);
}

/** Records that the visitor answered the last question and finished the quiz. */
export function trackQuizCompleted(questionCount: number): void {
  if (typeof window === 'undefined') return;
  sendFunnelEvent('quiz_question_viewed', `q${questionCount + 1}`);
}