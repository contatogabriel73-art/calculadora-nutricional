// ============================================================
// convidar-paciente — Edge Function
//
// Quando o nutricionista cadastra ou revisita a ficha de um paciente
// com e-mail preenchido, esta função cria a conta de paciente (papel
// 'paciente') pela Admin API do Supabase e já dispara o e-mail de
// convite embutido do Supabase Auth — o paciente clica no link, cai
// autenticado direto na área dele, sem precisar digitar nenhum
// código de convite. O código manual (resgatar_convite, ver
// schema.sql) continua existindo como caminho alternativo — por
// exemplo, se o paciente não tiver e-mail cadastrado, ou se o envio
// automático falhar.
//
// Só o nutricionista dono da ficha pode chamar, e só sobre uma ficha
// que já é dele — nunca cria conta em nome de e-mail arbitrário
// mandado pelo cliente sem checar a ficha primeiro.
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CABECALHOS_CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const cabecalhoAuth = req.headers.get("Authorization") || "";
  if (!cabecalhoAuth) return json({ erro: "Sem autenticação." }, 401);

  let corpo: { pacienteId?: string };
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: "Corpo da requisição inválido." }, 400);
  }
  const pacienteId = String(corpo.pacienteId || "").trim();
  if (!pacienteId) return json({ erro: "Falta o id do paciente." }, 400);

  // Cliente com o JWT de quem chamou — só pra descobrir quem é e
  // confirmar que é nutricionista. A ficha em si é lida com a chave de
  // serviço, mas sempre filtrando nutricionista_id = quem chamou, pra
  // ninguém convidar em nome de uma ficha de outro profissional.
  const comoUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: cabecalhoAuth } },
  });
  const { data: sessao, error: erroSessao } = await comoUsuario.auth.getUser();
  if (erroSessao || !sessao?.user) return json({ erro: "Sessão inválida ou expirada." }, 401);

  const comoServico = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: perfil, error: erroPerfil } = await comoServico
    .from("perfis")
    .select("papel")
    .eq("id", sessao.user.id)
    .single();

  if (erroPerfil || !perfil || perfil.papel !== "nutricionista") {
    return json({ erro: "Só uma conta de nutricionista pode convidar paciente." }, 403);
  }

  const { data: ficha, error: erroFicha } = await comoServico
    .from("pacientes")
    .select("id, nome, email, usuario_id")
    .eq("id", pacienteId)
    .eq("nutricionista_id", sessao.user.id)
    .maybeSingle();

  if (erroFicha || !ficha) {
    return json({ erro: "Ficha de paciente não encontrada." }, 404);
  }
  if (ficha.usuario_id) {
    return json({ erro: "Este paciente já está vinculado a uma conta." }, 409);
  }
  if (!ficha.email) {
    return json({ erro: "Cadastre um e-mail na ficha do paciente antes de convidar." }, 400);
  }

  // redirectTo: o link do e-mail já deixa a pessoa autenticada e cai
  // direto na área dela — o vínculo com a ficha é gravado abaixo, antes
  // do e-mail sair, então quando ela chegar lá já está tudo pronto, sem
  // precisar digitar código nenhum.
  const origem = req.headers.get("origin") || req.headers.get("referer") || "";
  const redirectTo = origem
    ? new URL("area-paciente.html", origem).toString()
    : undefined;

  const { data: convite, error: erroConvite } = await comoServico.auth.admin.inviteUserByEmail(
    ficha.email,
    {
      data: { papel: "paciente", nome: ficha.nome },
      redirectTo,
    },
  );

  if (erroConvite || !convite?.user) {
    // "already registered" é o caso mais comum de falha: o e-mail já
    // tem conta (de outro paciente, ou criada por outro caminho). Nesse
    // caso o código de convite manual continua sendo a saída.
    const mensagem = String(erroConvite?.message || "");
    if (/already.*(registered|exists|invited)/i.test(mensagem)) {
      return json({
        erro: "Já existe uma conta com este e-mail. Use o código de convite manual para vincular.",
      }, 409);
    }
    console.error("convidar-paciente: falha ao convidar —", erroConvite);
    return json({ erro: "Não foi possível enviar o convite agora. Tente de novo em instantes." }, 502);
  }

  const { error: erroVincular } = await comoServico
    .from("pacientes")
    .update({ usuario_id: convite.user.id })
    .eq("id", pacienteId);

  if (erroVincular) {
    console.error("convidar-paciente: convite enviado mas falhou ao vincular —", erroVincular);
    return json({
      erro: "O convite foi enviado, mas houve um erro ao vincular a ficha. Avise o suporte.",
    }, 500);
  }

  return json({ ok: true, email: ficha.email });
});
