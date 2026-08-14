// ============================================================
// convidar-paciente — Edge Function
//
// Quando o nutricionista cadastra ou revisita a ficha de um paciente
// com e-mail preenchido, esta função cria a conta de paciente (papel
// 'paciente') pela Admin API do Supabase e já dispara o e-mail de
// convite embutido do Supabase Auth. O código manual (resgatar_convite,
// ver schema.sql) continua existindo como caminho alternativo — por
// exemplo, se o paciente não tiver e-mail cadastrado, ou se o envio
// automático falhar.
//
// O e-mail mostra e-mail + senha temporária em texto, pra pessoa logar
// direto em login.html (a pedido do Gabriel) — não só um link mágico.
// Isso exige um passo a mais que o Admin API não faz sozinho: o único
// jeito de disparar e-mail automaticamente pela Admin API é
// inviteUserByEmail, mas essa chamada cria a conta SEM senha (só com um
// token de link). Por isso: manda o convite (o disparo do e-mail em si),
// e na sequência grava a senha gerada de verdade na conta com
// updateUserById — sem isso, e-mail e senha mostrados no corpo do
// e-mail não bateriam com a conta real.
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

/** Senha temporária aleatória — sem caracteres ambíguos (0/O, 1/I/l). */
function gerarSenhaTemporaria(): string {
  const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let senha = "";
  for (const b of bytes) senha += ALFABETO[b % ALFABETO.length];
  return senha;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CABECALHOS_CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const cabecalhoAuth = req.headers.get("Authorization") || "";
  if (!cabecalhoAuth) return json({ erro: "Sem autenticação." }, 401);

  let corpo: { pacienteId?: string; redirectTo?: string };
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

  // Nome de quem está convidando, só pro e-mail poder dizer "fulana te
  // cadastrou" em vez de um convite genérico e frio.
  const { data: perfilNutri } = await comoServico
    .from("perfis")
    .select("nome")
    .eq("id", sessao.user.id)
    .single();

  const senhaTemporaria = gerarSenhaTemporaria();

  // redirectTo: o link do e-mail já deixa a pessoa autenticada e cai
  // direto na área dela — o vínculo com a ficha é gravado abaixo, antes
  // do e-mail sair, então quando ela chegar lá já está tudo pronto, sem
  // precisar digitar código nenhum. É o caminho alternativo ao
  // e-mail/senha mostrados no corpo do e-mail — qualquer um dos dois
  // funciona.
  //
  // Preferimos o valor mandado pelo cliente: essa chamada é entre
  // origens diferentes (github.io → supabase.co), e nesse caso o
  // navegador só manda esquema+host nos cabeçalhos Referer/Origin, sem
  // caminho — não dá pra reconstruir "/calculadora-nutricional/..." a
  // partir deles (tentamos isso antes; o link saía sem o subcaminho do
  // GitHub Pages). Os cabeçalhos ficam só como fallback pra chamadas
  // antigas/de teste que não mandem redirectTo.
  const referenciador = req.headers.get("referer") || req.headers.get("origin") || "";
  const redirectTo = corpo.redirectTo
    ? corpo.redirectTo
    : referenciador
    ? new URL("area-paciente.html", referenciador).toString()
    : undefined;

  // senha_temporaria entra em `data` pra o template do e-mail (Passo 3,
  // configurado no painel do Supabase) poder mostrá-la via
  // {{ .Data.senha_temporaria }}.
  const { data: convite, error: erroConvite } = await comoServico.auth.admin.inviteUserByEmail(
    ficha.email,
    {
      data: {
        papel: "paciente",
        nome: ficha.nome,
        nutricionista_nome: perfilNutri?.nome || "",
        senha_temporaria: senhaTemporaria,
      },
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

  // inviteUserByEmail cria a conta sem senha (só o token do link) — pra
  // a senha mostrada no e-mail funcionar de verdade em login.html, ela
  // precisa ser gravada na conta agora, com a confirmação de e-mail já
  // marcada (senão o login por senha ficaria bloqueado até a pessoa
  // clicar no link).
  //
  // ⚠️ Não apaga senha_temporaria do metadata aqui. Tentamos isso antes
  // (setando null logo em seguida) e o e-mail chegava com a senha em
  // branco — o envio do e-mail pelo Supabase acontece de forma
  // assíncrona em relação ao retorno de inviteUserByEmail, então esse
  // update rodava antes do template terminar de renderizar e a
  // sobrescrevia no meio do caminho. Deixar a senha guardada em
  // user_metadata é um risco pequeno (quem tem acesso de leitura ao
  // banco a esse ponto já ignora Row Level Security de qualquer forma;
  // ver aviso sobre a chave service_role no supabase/README.md), e a
  // senha some de qualquer forma assim que o paciente troca ela no
  // primeiro acesso.
  const { error: erroSenha } = await comoServico.auth.admin.updateUserById(convite.user.id, {
    password: senhaTemporaria,
    email_confirm: true,
  });

  if (erroSenha) {
    console.error("convidar-paciente: convite enviado mas falhou ao definir a senha —", erroSenha);
    return json({
      erro: "O convite foi enviado, mas houve um erro ao configurar o acesso. Avise o suporte.",
    }, 500);
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
