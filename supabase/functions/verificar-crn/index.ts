// ============================================================
// verificar-crn — Edge Function de melhor esforço
//
// Consulta a Consulta Nacional de Nutricionistas do CFN
// (https://cnn.cfn.org.br/application/index/consulta-nacional) para
// tentar confirmar automaticamente o CRN que o nutricionista informou
// no cadastro. Se o registro existir, estiver ATIVO e o nome bater,
// marca a conta como verificada. Em QUALQUER outro caso — não achou,
// nome não bate, registro cancelado/transferido, o site do CFN não
// respondeu — a conta continua 'pendente' para um admin revisar à mão.
//
// ⚠️ DEPENDÊNCIA FRÁGIL, DE PROPÓSITO TOLERADA
// A Consulta Nacional de Nutricionistas não é uma API documentada nem
// contratada — é uma tela pública do CFN que devolve JSON, mas pode
// mudar de formato, endereço ou comportamento sem aviso a qualquer
// momento, porque não foi feita para uso por terceiros. Todo o código
// abaixo assume isso: qualquer coisa inesperada (rede fora do ar,
// resposta com formato diferente, timeout) cai para 'pendente' em vez
// de travar ou de quebrar o cadastro. Se um dia parar de funcionar
// silenciosamente, é esse comportamento — pendente — que se espera ver,
// não um erro no cadastro do nutricionista.
//
// Chamada apenas pelo nutricionista autenticado, sobre o próprio
// perfil — não recebe CRN nem nome pelo corpo da requisição. Ver
// js/auth.js (tentarVerificarCrn) para quem chama e quando.
// ============================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const CABECALHOS_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CABECALHOS_CORS, "Content-Type": "application/json" },
  });
}

/**
 * "CRN-3 12345", "crn3 012345", "CRN 03 - 3788D" → { regiao: "3", registro: "12345" }.
 * O CFN divide o Brasil em 11 conselhos regionais (CRN-1 a CRN-11); o
 * número de registro às vezes carrega uma letra ou barra junto
 * (ex.: "3788D", "0598/P") — por isso o registro aceita letras e barra,
 * não só dígitos.
 */
function interpretarCrn(bruto: string): { regiao: string; registro: string } | null {
  const texto = String(bruto || "").toUpperCase();
  const m = texto.match(/CRN[\s-]*(\d{1,2})\D+([0-9][0-9A-Z/]*)/);
  if (!m) return null;

  const regiao = String(Number(m[1]));
  if (Number(regiao) < 1 || Number(regiao) > 11) return null;

  const registro = m[2].trim();
  if (!registro) return null;

  return { regiao, registro };
}

/** Maiúsculo, sem acento, espaços colapsados — para comparar nomes com tolerância. */
const MARCAS_DIACRITICAS = /[\u0300-\u036f]/g;

function normalizarNome(s: string): string {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(MARCAS_DIACRITICAS, "")
    .replace(/\s+/g, " ")
    .trim();
}

const CONECTIVOS = new Set(["DE", "DA", "DO", "DAS", "DOS", "E"]);

/**
 * Tolerante a diferença de acento, caixa, espaço e a nome do meio
 * faltando ou fora de ordem — mas não a nomes realmente diferentes.
 * Todas as palavras significativas do nome mais curto precisam
 * aparecer no mais longo.
 */
function nomesBatem(a: string, b: string): boolean {
  const na = normalizarNome(a);
  const nb = normalizarNome(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const palavras = (s: string) => s.split(" ").filter((w) => w.length >= 2 && !CONECTIVOS.has(w));
  const wa = palavras(na);
  const wb = palavras(nb);
  const [menor, maior] = wa.length <= wb.length ? [wa, wb] : [wb, wa];

  return menor.length > 0 && menor.every((w) => maior.includes(w));
}

interface RegistroCfn {
  nome: string;
  registro: string;
  crn: number;
  situacao: string;
  tipo_registro: string;
}

/**
 * Busca exata por região + número de registro. Devolve a lista bruta
 * (0 ou 1 item, na prática) — quem chama decide o que fazer com ela.
 * @throws em qualquer falha de rede, timeout ou resposta fora do formato esperado
 */
async function consultarCfn(regiao: string, registro: string): Promise<RegistroCfn[]> {
  const resposta = await fetch("https://cnn.cfn.org.br/application/front-resource/get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      comando: "get-nutricionista",
      options: { nome: "", crn: regiao, registro, geral: true },
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!resposta.ok) throw new Error("CFN respondeu HTTP " + resposta.status);

  const dados = await resposta.json();
  if (!dados || dados.success !== true || !Array.isArray(dados.data)) {
    throw new Error("Resposta do CFN em formato inesperado");
  }
  return dados.data;
}

/* Só um registro ativo confirma a conta sozinho. Transferido, cancelado,
   provisório vencido etc. — mesmo com nome batendo — fica para um humano
   decidir: o registro existiu, mas não está claro que ainda vale. */
function situacaoAceitaVerificacaoAutomatica(situacao: string): boolean {
  return String(situacao || "").trim().toUpperCase() === "ATIVO";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CABECALHOS_CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const cabecalhoAuth = req.headers.get("Authorization") || "";
  if (!cabecalhoAuth) return json({ erro: "Sem autenticação." }, 401);

  // Cliente com o JWT de quem chamou — só para descobrir QUEM está
  // pedindo. A decisão em si nunca confia em dado mandado pelo corpo da
  // requisição: crn e nome vêm do próprio perfil no banco, não do que o
  // cliente alegar ser.
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: cabecalhoAuth } },
  });
  const { data: sessao, error: erroSessao } = await comoUsuario.auth.getUser();
  if (erroSessao || !sessao?.user) return json({ erro: "Sessão inválida ou expirada." }, 401);

  // Cliente com a chave de serviço — só ele consegue gravar
  // status_verificacao (ver o trigger proteger_campos_privilegiados em
  // supabase/schema.sql, que libera especificamente auth.role() =
  // 'service_role').
  const comoServico = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: perfil, error: erroPerfil } = await comoServico
    .from("perfis")
    .select("nome, crn, papel, status_verificacao")
    .eq("id", sessao.user.id)
    .single();

  if (erroPerfil || !perfil) return json({ erro: "Perfil não encontrado." }, 404);

  if (perfil.papel !== "nutricionista") {
    return json({ ok: true, status: perfil.status_verificacao, motivo: "Verificação de CRN não se aplica a este papel." });
  }
  if (perfil.status_verificacao === "verificado") {
    return json({ ok: true, status: "verificado", jaEstava: true });
  }

  const alvo = interpretarCrn(perfil.crn);
  if (!alvo) {
    return json({ ok: true, status: "pendente", motivo: "Não foi possível interpretar o número de CRN informado." });
  }

  let registros: RegistroCfn[];
  try {
    registros = await consultarCfn(alvo.regiao, alvo.registro);
  } catch (erro) {
    console.error("verificar-crn: falha ao consultar o CFN —", erro);
    return json({ ok: true, status: "pendente", motivo: "Não foi possível consultar o CFN agora. Tentaremos de novo mais tarde." });
  }

  const encontrado = registros.find(
    (r) => nomesBatem(r.nome, perfil.nome) && situacaoAceitaVerificacaoAutomatica(r.situacao),
  );

  if (!encontrado) {
    const motivo = registros.length === 0
      ? "Nenhum registro encontrado para este CRN."
      : "Encontramos o CRN, mas o nome ou a situação do registro não conferem automaticamente.";
    return json({ ok: true, status: "pendente", motivo });
  }

  const { error: erroUpdate } = await comoServico
    .from("perfis")
    .update({ status_verificacao: "verificado" })
    .eq("id", sessao.user.id);

  if (erroUpdate) {
    console.error("verificar-crn: achou o registro mas falhou ao gravar —", erroUpdate);
    return json({ ok: true, status: "pendente", motivo: "Confirmamos o CRN, mas houve um erro ao salvar. Tente entrar de novo em instantes." });
  }

  return json({ ok: true, status: "verificado" });
});
