import { Router, type IRouter } from "express";
import { ConsultCpfQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

function extractName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const nameKeys = ["nome_da_pf", "nome", "nome_completo", "Nome", "name"];
  const nestedKeys = ["result", "data", "dados", "response", "retorno"];

  const findName = (value: unknown, depth: number): string | null => {
    if (!value || typeof value !== "object" || depth > 2) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const name = findName(item, depth + 1);
        if (name) return name;
      }
      return null;
    }

    const record = value as Record<string, unknown>;
    for (const key of nameKeys) {
      if (typeof record[key] === "string" && record[key].trim()) {
        return record[key].trim().toUpperCase();
      }
    }
    for (const key of nestedKeys) {
      const name = findName(record[key], depth + 1);
      if (name) return name;
    }
    return null;
  };

  return findName(payload, 0);
}

function extractBirthDate(payload: unknown): string | null {
  const dateKeys = [
    "data_nascimento",
    "data_de_nascimento",
    "dataNascimento",
    "nascimento",
    "dt_nascimento",
    "birth_date",
    "birthDate",
  ];
  const nestedKeys = ["result", "data", "dados", "response", "retorno"];

  const normalizeDate = (value: string) => {
    const trimmed = value.trim();
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
    const brazilianMatch = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (brazilianMatch) return `${brazilianMatch[1]}/${brazilianMatch[2]}/${brazilianMatch[3]}`;
    return trimmed || null;
  };

  const findDate = (value: unknown, depth: number): string | null => {
    if (!value || typeof value !== "object" || depth > 2) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const date = findDate(item, depth + 1);
        if (date) return date;
      }
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const key of dateKeys) {
      if (typeof record[key] === "string") {
        const date = normalizeDate(record[key]);
        if (date) return date;
      }
    }
    for (const key of nestedKeys) {
      const date = findDate(record[key], depth + 1);
      if (date) return date;
    }
    return null;
  };

  return findDate(payload, 0);
}

router.get("/consulta-cpf", async (req, res) => {
  const parsed = ConsultCpfQueryParams.safeParse({
    cpf: typeof req.query.cpf === "string" ? req.query.cpf : "",
  });

  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "CPF inválido." });
  }

  const cpf = parsed.data.cpf.replace(/\D/g, "");
  if (cpf.length !== 11) {
    return res.status(400).json({ success: false, error: "CPF deve conter 11 dígitos." });
  }

  const configuredSource = process.env.ZAPGROUP_API_TOKEN?.trim();
  if (!configuredSource) {
    req.log.error("ZAPGROUP_API_TOKEN is not configured");
    return res.status(503).json({ success: false, error: "Serviço de consulta indisponível." });
  }

  try {
    const endpoint = configuredSource.includes("consultar-filtrada/cpf")
      ? new URL(configuredSource.replace("CPFAQUI", encodeURIComponent(cpf)))
      : new URL("https://api.zapgroup.shop/consultar-filtrada/cpf");
    if (!configuredSource.includes("consultar-filtrada/cpf")) {
      endpoint.searchParams.set("cpf", cpf);
      endpoint.searchParams.set("token", configuredSource);
    }
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => null);
    const nome = extractName(payload);
    const dataNascimento = extractBirthDate(payload);
    if (!response.ok) {
      req.log.warn({ status: response.status }, "ZapGroup CPF consultation returned an error");
    }

    return res.json({
      success: response.ok && Boolean(nome),
      cpf,
      nome,
      dataNascimento,
      source: nome ? "zapgroup" : "none",
    });
  } catch (error) {
    req.log.warn({ err: error }, "ZapGroup CPF consultation failed");
    return res.json({ success: false, cpf, nome: null, dataNascimento: null, source: "none" });
  }
});

export default router;