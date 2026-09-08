import { Router, type IRouter } from "express";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, funnelEventsTable } from "@workspace/db";

const router: IRouter = Router();
const allowedStages = new Set(["consulta", "identidade", "recebimento"]);
const quizQuestionStage = /^q([1-9]|1[0-9]|20)$/;

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isValidStage(eventName: string, stage: string) {
  if (eventName === "funnel_stage_viewed") return allowedStages.has(stage);
  if (eventName === "quiz_question_viewed") return quizQuestionStage.test(stage);
  return false;
}

router.post("/analytics/event", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
  const sessionId = clean(body.sessionId, 128);
  const eventName = clean(body.eventName, 80);
  const stage = clean(body.stage, 30);
  const offerSlug = clean(body.offerSlug, 80).toLowerCase();
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(sessionId) || !isValidStage(eventName, stage)) {
    return res.status(400).json({ success: false, error: "Evento de funil inválido." });
  }
  try {
    await db.insert(funnelEventsTable).values({
      sessionId,
      eventName,
      stage,
      offerSlug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(offerSlug) ? offerSlug : null,
    }).onConflictDoNothing();
    return res.json({ success: true });
  } catch (error) {
    req.log.warn({ err: error }, "Funnel analytics event failed");
    return res.status(500).json({ success: false, error: "Não foi possível registrar a métrica." });
  }
});

export async function getFunnelRetentionMetrics() {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const rows = await db.select({
    stage: funnelEventsTable.stage,
    sessions: sql<number>`count(distinct ${funnelEventsTable.sessionId})`,
  }).from(funnelEventsTable)
    .where(and(
      gte(funnelEventsTable.createdAt, since),
      eq(funnelEventsTable.eventName, "funnel_stage_viewed"),
    ))
    .groupBy(funnelEventsTable.stage);
  const values = new Map(rows.map((row) => [row.stage, Number(row.sessions)]));
  const consulta = values.get("consulta") || 0;
  const identidade = values.get("identidade") || 0;
  const recebimento = values.get("recebimento") || 0;
  const percent = (value: number, base: number) => base ? Math.round((value / base) * 100) : 0;
  return {
    periodDays: 30,
    funnel: [
      { key: "consulta", label: "Consulta", sessions: consulta, rateFromPrevious: 100, retentionFromConsultation: 100 },
      { key: "identidade", label: "Identidade", sessions: identidade, rateFromPrevious: percent(identidade, consulta), retentionFromConsultation: percent(identidade, consulta) },
      { key: "recebimento", label: "Recebimento", sessions: recebimento, rateFromPrevious: percent(recebimento, identidade), retentionFromConsultation: percent(recebimento, consulta) },
    ],
    overallRate: percent(recebimento, consulta),
  };
}

export async function getQuizRetentionMetrics(questionCount: number) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const rows = await db.select({
    stage: funnelEventsTable.stage,
    sessions: sql<number>`count(distinct ${funnelEventsTable.sessionId})`,
  }).from(funnelEventsTable)
    .where(and(
      gte(funnelEventsTable.createdAt, since),
      eq(funnelEventsTable.eventName, "quiz_question_viewed"),
    ))
    .groupBy(funnelEventsTable.stage);
  const values = new Map(rows.map((row) => [row.stage, Number(row.sessions)]));
  const started = values.get("q1") || 0;
  const percent = (value: number, base: number) => base ? Math.round((value / base) * 100) : 0;
  const questions = Array.from({ length: questionCount }, (_, index) => {
    const sessions = values.get(`q${index + 1}`) || 0;
    const previousSessions = index === 0 ? sessions : (values.get(`q${index}`) || 0);
    return {
      index: index + 1,
      sessions,
      reachRate: percent(sessions, started),
      rateFromPrevious: index === 0 ? 100 : percent(sessions, previousSessions),
    };
  });
  const completed = values.get(`q${questionCount + 1}`) || 0;
  return {
    periodDays: 30,
    started,
    completed,
    completionRate: percent(completed, started),
    questions,
  };
}

export default router;