/* ============================================================
   auth.js — camada de autenticação

   ATENÇÃO: esta é uma autenticação FICTÍCIA, só para navegar pelas
   telas enquanto o backend não existe. As credenciais estão no código
   do cliente e o "estar logado" é uma flag no sessionStorage —
   qualquer pessoa consegue ler as credenciais ou marcar a flag pelo
   console do navegador. Não há nenhuma proteção real aqui.

   TROCA POR SUPABASE (ou qualquer backend):
   este arquivo é o único ponto a mexer. Mantenha as mesmas funções
   e assinaturas, trocando o miolo por chamadas reais:

     login(email, senha)  → supabase.auth.signInWithPassword(...)
     logout()             → supabase.auth.signOut()
     estaLogado()         → !!(await supabase.auth.getSession()).data.session
     usuarioAtual()       → (await supabase.auth.getUser()).data.user

   As funções já devolvem Promises justamente para que a troca não
   exija alterar quem as chama.
   ============================================================ */

'use strict';

const Auth = (() => {

  const CHAVE_SESSAO = 'nutri:sessao:v1';

  /* Credenciais de demonstração. Ficam expostas de propósito: o login
     é uma simulação e a tela de login mostra estes dados na tela. */
  const CREDENCIAIS_DEMO = {
    email: 'nutricionista@teste.com',
    senha: '123456',
    nome: 'Nutricionista (demo)'
  };

  function lerSessao() {
    try {
      return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null');
    } catch (e) {
      return null;
    }
  }

  /**
   * Autentica o usuário.
   * @returns {Promise<{ok: boolean, erro?: string, usuario?: object}>}
   */
  async function login(email, senha) {
    const emailLimpo = String(email || '').trim().toLowerCase();
    const senhaLimpa = String(senha || '');

    if (!emailLimpo || !senhaLimpa) {
      return { ok: false, erro: 'Informe e-mail e senha.' };
    }

    if (emailLimpo !== CREDENCIAIS_DEMO.email || senhaLimpa !== CREDENCIAIS_DEMO.senha) {
      return { ok: false, erro: 'E-mail ou senha incorretos.' };
    }

    const usuario = {
      email: CREDENCIAIS_DEMO.email,
      nome: CREDENCIAIS_DEMO.nome,
      entrouEm: new Date().toISOString()
    };

    try {
      sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(usuario));
    } catch (e) {
      return { ok: false, erro: 'Não foi possível iniciar a sessão neste navegador.' };
    }

    return { ok: true, usuario };
  }

  async function logout() {
    try { sessionStorage.removeItem(CHAVE_SESSAO); } catch (e) {}
  }

  async function estaLogado() {
    return !!lerSessao();
  }

  async function usuarioAtual() {
    return lerSessao();
  }

  /**
   * Guarda de rota: manda para o login quem não está autenticado.
   * Chame no topo de toda página interna.
   * @returns {Promise<boolean>} false quando redirecionou.
   */
  async function exigirLogin() {
    if (await estaLogado()) return true;
    const destino = location.pathname.split('/').pop() + location.search;
    location.replace('login.html?destino=' + encodeURIComponent(destino));
    return false;
  }

  /** Dados de demonstração, exibidos na tela de login. */
  function credenciaisDemo() {
    return { email: CREDENCIAIS_DEMO.email, senha: CREDENCIAIS_DEMO.senha };
  }

  return { login, logout, estaLogado, usuarioAtual, exigirLogin, credenciaisDemo };
})();
