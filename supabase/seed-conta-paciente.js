/* ============================================================
   Cria uma conta de paciente de teste — mesmo motivo do
   seed-conta-teste.js: hoje só existe cadastro público de
   nutricionista (cadastro.html), então uma conta de paciente só nasce
   por aqui ou pelo painel do Supabase.

   Como rodar (Windows / PowerShell):

     $env:SUPABASE_URL = "https://<projeto>.supabase.co"
     $env:SUPABASE_SERVICE_ROLE_KEY = Read-Host "Cole a chave service_role"
     node supabase/seed-conta-paciente.js seu@email.com "sua-senha" "Seu Nome"

   Mesmos avisos do seed-conta-teste.js: as três variáveis não vêm
   fixas no arquivo, e a chave service_role nunca deve ir pro
   supabase-config.js nem pro GitHub.

   Cria só a conta — não vincula a nenhuma ficha de paciente. O
   vínculo continua sendo o fluxo normal: gerar um código de convite
   na ficha (paciente.html) e resgatar em area-paciente.html depois de
   entrar com esta conta.

   ⚠️ CONTA DE TESTE — exclua em Authentication → Users antes do
   lançamento em produção (nasce com `conta_teste = true` em `perfis`).
   ============================================================ */

'use strict';

const URL_BASE = process.env.SUPABASE_URL;
const CHAVE_SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY;

const [, , email, senha, nome] = process.argv;

// Ver o comentário equivalente em seed-conta-teste.js: nunca
// process.exit() depois de um fetch, trava o Node no Windows.
class Falha extends Error {}

function sair(mensagem) {
  console.error(mensagem);
  process.exitCode = 1;
  throw new Falha(mensagem);
}

const cabecalhos = {
  apikey: CHAVE_SERVICO,
  Authorization: `Bearer ${CHAVE_SERVICO}`,
  'Content-Type': 'application/json'
};

async function main() {
  if (!URL_BASE || !CHAVE_SERVICO) {
    sair(
      'Faltam as variáveis de ambiente SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Encontre as duas em Project Settings → API no painel do Supabase.'
    );
  }
  if (!email || !senha) {
    sair(
      'Uso: node supabase/seed-conta-paciente.js <email> <senha> ["Nome opcional"]\n' +
      'Ex.:  node supabase/seed-conta-paciente.js voce+paciente@exemplo.com "senha-forte-123" "Seu Nome"'
    );
  }
  if (senha.length < 6) {
    sair('A senha precisa ter pelo menos 6 caracteres (mínimo do Supabase Auth).');
  }

  // papel: 'paciente' no metadata é o que o trigger criar_perfil_no_cadastro
  // lê pra decidir o papel — sem isso ele assume nutricionista (ver
  // schema.sql). email_confirm: true pula a confirmação, mesmo motivo do
  // outro script: quem roda isso já tem a chave service_role.
  const respCriacao = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabecalhos,
    body: JSON.stringify({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { papel: 'paciente', nome: nome || 'Paciente de teste' }
    })
  });

  const corpoCriacao = await respCriacao.json();
  if (!respCriacao.ok) {
    sair(`Falha ao criar a conta no Supabase Auth: ${JSON.stringify(corpoCriacao)}`);
  }

  const id = corpoCriacao.id;

  // Marca conta_teste = true, só como lembrete de limpeza — não afeta
  // nada do funcionamento da conta.
  const respPerfil = await fetch(`${URL_BASE}/rest/v1/perfis?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...cabecalhos, Prefer: 'return=representation' },
    body: JSON.stringify({ conta_teste: true })
  });

  const corpoPerfil = await respPerfil.json();
  if (!respPerfil.ok) {
    sair(`Conta criada, mas falhou ao marcar conta_teste: ${JSON.stringify(corpoPerfil)}`);
  }

  console.log('Pronto. Conta de paciente de teste:');
  console.log(`  e-mail: ${email}`);
  console.log('  papel: paciente');
  console.log('Entra pelo login.html — vai cair em area-paciente.html pedindo o código de convite.');
  console.log('Lembrete: exclua esta conta (Authentication → Users) antes do lançamento em produção.');
}

main().catch((erro) => {
  if (erro instanceof Falha) return;
  console.error(`Erro inesperado: ${erro.message}`);
  process.exitCode = 1;
});
