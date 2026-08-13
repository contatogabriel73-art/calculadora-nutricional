/* ============================================================
   auth.js — autenticação (Supabase Auth)

   Antes daqui morava um login fictício, com a senha escrita no código.
   Agora é conta de verdade: e-mail e senha guardados pelo Supabase, com
   sessão que sobrevive a fechar o navegador.

   As assinaturas continuam as mesmas de antes (login, logout, estaLogado,
   usuarioAtual, exigirLogin) justamente para as telas que chamam não
   precisarem mudar.

   DOIS PAPÉIS. Toda conta é nutricionista ou paciente, e o papel fica na
   tabela `perfis` — não só no metadata do login. Está lá porque as
   políticas de segurança do banco precisam consultá-lo, e porque o
   metadata é gravado a partir do cadastro, num lugar que o próprio
   usuário influencia.

   Carregue depois do cliente do banco:
     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="js/supabase-config.js"></script>
     <script src="js/supabase-client.js"></script>
     <script src="js/auth.js"></script>
   ============================================================ */

'use strict';

const Auth = (() => {

  const PAPEIS = ['nutricionista', 'paciente'];

  /* Onde cada papel começa depois de entrar. */
  const INICIO = {
    nutricionista: 'painel.html',
    paciente: 'area-paciente.html'
  };

  /* O perfil é lido do banco uma vez por carregamento de página. Sem
     isto, `montarCabecalho` e o guarda de rota fariam a mesma consulta
     duas vezes, um atrás do outro, antes de qualquer pixel aparecer. */
  let perfilCache = null;
  let perfilCarregado = false;

  function limparCache() {
    perfilCache = null;
    perfilCarregado = false;
  }

  function paginaInicial(papel) {
    return INICIO[papel] || INICIO.nutricionista;
  }

  /* ───────────── Sessão ───────────── */

  async function sessao() {
    const c = Banco.cx();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return (data && data.session) || null;
  }

  async function estaLogado() {
    return !!(await sessao());
  }

  /**
   * O perfil do usuário logado (linha da tabela `perfis`).
   * @returns {Promise<object|null>}
   */
  async function perfilAtual() {
    if (perfilCarregado) return perfilCache;

    const s = await sessao();
    if (!s) {
      perfilCarregado = true;
      perfilCache = null;
      return null;
    }

    const { data, error } = await Banco.tabela('perfis')
      .select('*')
      .eq('id', s.user.id)
      .maybeSingle();

    perfilCarregado = true;
    perfilCache = error ? null : data;
    return perfilCache;
  }

  /**
   * Quem está logado, no formato que as telas já esperavam
   * ({nome, email}) mais o id e o papel.
   * @returns {Promise<object|null>}
   */
  async function usuarioAtual() {
    const s = await sessao();
    if (!s) return null;

    const perfil = await perfilAtual();
    return {
      id: s.user.id,
      email: s.user.email || '',
      // Sem nome no perfil, a parte do e-mail antes do @ é melhor do que
      // um cabeçalho vazio.
      nome: (perfil && perfil.nome) || (s.user.email || '').split('@')[0],
      papel: (perfil && perfil.papel) || '',
      perfil
    };
  }

  async function papelAtual() {
    const perfil = await perfilAtual();
    return perfil ? perfil.papel : '';
  }

  /* ───────────── Entrar, cadastrar, sair ───────────── */

  /**
   * @returns {Promise<{ok: boolean, erro?: string, usuario?: object}>}
   */
  async function login(email, senha) {
    const emailLimpo = String(email || '').trim().toLowerCase();
    const senhaLimpa = String(senha || '');

    if (!emailLimpo || !senhaLimpa) {
      return { ok: false, erro: 'Informe e-mail e senha.' };
    }

    const c = Banco.cx();
    if (!c) return { ok: false, erro: Banco.motivo() };

    const { data, error } = await c.auth.signInWithPassword({
      email: emailLimpo,
      password: senhaLimpa
    });
    if (error) return { ok: false, erro: Banco.traduzirErro(error) };

    limparCache();
    const usuario = await usuarioAtual();

    /* Conta sem perfil não deveria existir: o gatilho do banco cria a
       linha na mesma transação do cadastro. Se acontecer, é melhor
       barrar do que deixar a pessoa entrar num sistema que não sabe o
       que ela pode ver. */
    if (!usuario || !usuario.papel) {
      await c.auth.signOut();
      limparCache();
      return {
        ok: false,
        erro: 'Esta conta está sem perfil. Fale com o suporte para regularizar.'
      };
    }

    return { ok: true, usuario, destino: paginaInicial(usuario.papel) };
  }

  /**
   * Cria a conta e o perfil. O papel vai no metadata do cadastro, e um
   * gatilho no banco cria a linha em `perfis` a partir dele — assim o
   * perfil nasce junto com a conta, e não numa segunda chamada que pode
   * falhar depois da conta já existir.
   *
   * @param {object} dados { nome, email, senha, papel }
   * @returns {Promise<{ok: boolean, erro?: string, destino?: string, precisaConfirmar?: boolean}>}
   */
  async function cadastrar(dados) {
    const nome = String(dados.nome || '').trim();
    const email = String(dados.email || '').trim().toLowerCase();
    const senha = String(dados.senha || '');
    const papel = PAPEIS.includes(dados.papel) ? dados.papel : '';

    if (!papel) return { ok: false, erro: 'Escolha se você é nutricionista ou paciente.' };
    if (!nome) return { ok: false, erro: 'Informe seu nome.' };
    if (!email) return { ok: false, erro: 'Informe seu e-mail.' };
    if (senha.length < 6) return { ok: false, erro: 'A senha precisa ter pelo menos 6 caracteres.' };

    const c = Banco.cx();
    if (!c) return { ok: false, erro: Banco.motivo() };

    const { data, error } = await c.auth.signUp({
      email,
      password: senha,
      options: { data: { nome, papel } }
    });
    if (error) return { ok: false, erro: Banco.traduzirErro(error) };

    limparCache();

    /* Com "Confirm email" ligado no projeto, o cadastro não devolve
       sessão: a pessoa precisa clicar no link do e-mail antes. Quem
       chama precisa saber a diferença para não mandar para uma área
       interna que vai rebater para o login. */
    if (!data.session) {
      return { ok: true, precisaConfirmar: true, email };
    }

    return { ok: true, destino: paginaInicial(papel) };
  }

  async function logout() {
    const c = Banco.cx();
    if (c) await c.auth.signOut();
    limparCache();
  }

  /* ───────────── Guardas de rota ───────────── */

  /**
   * Protege uma página interna. Manda para o login quem não entrou, e
   * manda para a própria área quem entrou com o papel errado — um
   * paciente abrindo o financeiro do consultório, por exemplo.
   *
   * O padrão é 'nutricionista' porque todas as telas internas de hoje
   * são do profissional; a área do paciente pede o papel dela
   * explicitamente.
   *
   * @param {string} papelExigido 'nutricionista' | 'paciente' | '' (qualquer)
   * @returns {Promise<boolean>} false quando redirecionou
   */
  async function exigirLogin(papelExigido = 'nutricionista') {
    /* As telas internas nascem invisíveis (body.protegida no CSS) para
       não piscarem antes desta decisão. Revelar é responsabilidade de
       quem libera — todo caminho que devolve `true`, e a tela de erro
       abaixo, precisam chamar isto. Quem redireciona deixa escondido. */
    const liberar = () => document.body.classList.add('liberada');

    if (!Banco.configurado()) {
      // Sem banco configurado não há login possível, e mandar para a
      // tela de login só faria a pessoa girar em círculo.
      document.body.innerHTML =
        '<main class="wrap" style="padding:3rem 1rem;max-width:40rem">' +
        '<h1>Banco de dados não configurado</h1>' +
        '<p>' + Banco.motivo() + '</p></main>';
      liberar();
      return false;
    }

    if (!(await estaLogado())) {
      const destino = location.pathname.split('/').pop() + location.search;
      location.replace('login.html?destino=' + encodeURIComponent(destino));
      return false;
    }

    if (papelExigido) {
      const papel = await papelAtual();
      if (papel && papel !== papelExigido) {
        location.replace(paginaInicial(papel));
        return false;
      }
      if (!papel) {
        await logout();
        location.replace('login.html');
        return false;
      }
    }

    liberar();
    return true;
  }

  return {
    PAPEIS, paginaInicial,
    login, cadastrar, logout,
    estaLogado, usuarioAtual, perfilAtual, papelAtual,
    exigirLogin
  };
})();
