/* ============================================================
   Fase 4 — cria a conta de teste/admin do Gabriel.

   Não passa pela tela de cadastro normal (cadastro.html) de propósito:
   esta conta pula a verificação de CRN e já nasce com acesso completo,
   então não pode ser algo que qualquer pessoa consiga criar sozinha
   pelo formulário público.

   Como rodar (Windows / PowerShell):

     $env:SUPABASE_URL = "https://<projeto>.supabase.co"
     $env:SUPABASE_SERVICE_ROLE_KEY = "<a chave service_role, NUNCA a anon>"
     node supabase/seed-conta-teste.js seu@email.com "sua-senha" "Seu Nome"

   O e-mail, a senha e o nome são escolhidos por quem roda o script — nada
   vem fixo aqui. As duas variáveis de ambiente ficam em
   Project Settings → API no painel do Supabase; a chave service_role
   NUNCA deve ir para o js/supabase-config.js nem para o GitHub, porque
   ela ignora Row Level Security (ver supabase/README.md, seção 3).

   ⚠️ CONTA DE TESTE — exclua em Authentication → Users antes do
   lançamento em produção. O banco também marca isso sozinho: a linha
   nasce com `conta_teste = true` em `perfis`.
   ============================================================ */

'use strict';

const URL_BASE = process.env.SUPABASE_URL;
const CHAVE_SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY;

const [, , email, senha, nome] = process.argv;

function sair(mensagem) {
  console.error(mensagem);
  process.exit(1);
}

if (!URL_BASE || !CHAVE_SERVICO) {
  sair(
    'Faltam as variáveis de ambiente SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY.\n' +
    'Encontre as duas em Project Settings → API no painel do Supabase.'
  );
}
if (!email || !senha) {
  sair(
    'Uso: node supabase/seed-conta-teste.js <email> <senha> ["Nome opcional"]\n' +
    'Ex.:  node supabase/seed-conta-teste.js voce@exemplo.com "senha-forte-123" "Gabriel"'
  );
}
if (senha.length < 6) {
  sair('A senha precisa ter pelo menos 6 caracteres (mínimo do Supabase Auth).');
}

const cabecalhos = {
  apikey: CHAVE_SERVICO,
  Authorization: `Bearer ${CHAVE_SERVICO}`,
  'Content-Type': 'application/json'
};

async function criarConta() {
  // email_confirm: true pula o e-mail de confirmação — é uma conta criada
  // por quem já tem a chave service_role, não um cadastro anônimo, então
  // a mesma cautela da seção 5 do README não se aplica aqui.
  const respCriacao = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabecalhos,
    body: JSON.stringify({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome: nome || 'Conta de teste' }
    })
  });

  const corpoCriacao = await respCriacao.json();
  if (!respCriacao.ok) {
    sair(`Falha ao criar a conta no Supabase Auth: ${JSON.stringify(corpoCriacao)}`);
  }

  const id = corpoCriacao.id;
  console.log(`Conta criada em auth.users (id ${id}). Perfil nasceu 'pendente' pelo trigger — corrigindo agora.`);

  // O trigger trg_criar_perfil já inseriu a linha em perfis como
  // 'pendente'. Esta chamada usa a mesma chave service_role para marcar
  // verificado/admin/teste — é o mesmo bypass que a Edge Function
  // verificar-crn usa (ver proteger_campos_privilegiados no schema.sql).
  const respPerfil = await fetch(`${URL_BASE}/rest/v1/perfis?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...cabecalhos, Prefer: 'return=representation' },
    body: JSON.stringify({
      status_verificacao: 'verificado',
      papel_admin: true,
      conta_teste: true
    })
  });

  const corpoPerfil = await respPerfil.json();
  if (!respPerfil.ok) {
    sair(`Conta criada, mas falhou ao marcar o perfil: ${JSON.stringify(corpoPerfil)}`);
  }

  console.log('Pronto. Conta de teste/admin:');
  console.log(`  e-mail: ${email}`);
  console.log(`  papel: nutricionista, verificado, papel_admin = true, conta_teste = true`);
  console.log('Entra direto pelo login.html e já tem acesso a admin.html.');
  console.log('Lembrete: exclua esta conta (Authentication → Users) antes do lançamento em produção.');
}

criarConta().catch((erro) => sair(`Erro inesperado: ${erro.message}`));
