/* ============================================================
   Troca a senha de uma conta já existente no Supabase Auth, pela
   Admin API — para quando alguém esquece ou digitou errado a senha
   de uma conta plantada por seed-conta-teste.js (sem tela de "esqueci
   minha senha" no site, ver login.html).

   Como rodar (Windows / PowerShell):

     $env:SUPABASE_URL = "https://<projeto>.supabase.co"
     $env:SUPABASE_SERVICE_ROLE_KEY = "<a chave service_role, NUNCA a anon>"
     node supabase/resetar-senha.js seu@email.com "senha-nova"

   Mesmo aviso do seed-conta-teste.js: a chave service_role ignora Row
   Level Security. Usa só neste comando, no seu terminal, nunca cola em
   arquivo do repositório.
   ============================================================ */

'use strict';

const URL_BASE = process.env.SUPABASE_URL;
const CHAVE_SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY;

const [, , email, novaSenha] = process.argv;

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
if (!email || !novaSenha) {
  sair('Uso: node supabase/resetar-senha.js <email> <senha-nova>');
}
if (novaSenha.length < 6) {
  sair('A senha precisa ter pelo menos 6 caracteres (mínimo do Supabase Auth).');
}

const cabecalhos = {
  apikey: CHAVE_SERVICO,
  Authorization: `Bearer ${CHAVE_SERVICO}`,
  'Content-Type': 'application/json'
};

async function resetarSenha() {
  // A Admin API não tem "buscar por e-mail" direto, então lista e filtra
  // aqui — o projeto tem poucas contas, então isso é barato.
  const respLista = await fetch(`${URL_BASE}/auth/v1/admin/users?per_page=200`, {
    headers: cabecalhos
  });
  const corpoLista = await respLista.json();
  if (!respLista.ok) {
    sair(`Falha ao listar contas: ${JSON.stringify(corpoLista)}`);
  }

  const usuario = (corpoLista.users || []).find(
    (u) => u.email.toLowerCase() === email.toLowerCase()
  );
  if (!usuario) {
    sair(`Nenhuma conta encontrada com o e-mail ${email}.`);
  }

  const respTroca = await fetch(`${URL_BASE}/auth/v1/admin/users/${usuario.id}`, {
    method: 'PUT',
    headers: cabecalhos,
    body: JSON.stringify({ password: novaSenha })
  });
  const corpoTroca = await respTroca.json();
  if (!respTroca.ok) {
    sair(`Falha ao trocar a senha: ${JSON.stringify(corpoTroca)}`);
  }

  console.log(`Senha trocada para a conta ${email}. Já dá para entrar em login.html com a senha nova.`);
}

resetarSenha().catch((erro) => sair(`Erro inesperado: ${erro.message}`));
