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

  /* Nutricionista sem status_verificacao = 'verificado' não entra no
     painel — vai para cá, verificado ou não pela Fase 2 (CRN batendo
     sozinho) ou por um admin aprovando na mão. */
  const PAGINA_ANALISE = 'cadastro-em-analise.html';

  /* O perfil é lido do banco uma vez por carregamento de página. Sem
     isto, `montarCabecalho` e o guarda de rota fariam a mesma consulta
     duas vezes, um atrás do outro, antes de qualquer pixel aparecer. */
  let perfilCache = null;
  let perfilCarregado = false;

  function limparCache() {
    perfilCache = null;
    perfilCarregado = false;
  }

  /**
   * Substitui o perfil em cache depois de uma gravação, para o
   * cabeçalho não continuar mostrando o nome antigo até a próxima
   * navegação. Usado por perfil-storage.js.
   */
  function atualizarPerfilEmCache(linha) {
    if (!linha) return;
    perfilCache = linha;
    perfilCarregado = true;
  }

  function paginaInicial(papel) {
    return INICIO[papel] || INICIO.nutricionista;
  }

  /**
   * Para onde mandar alguém logo depois de entrar (ou de cadastrar),
   * considerando não só o papel mas — para nutricionista — se a conta já
   * está liberada. Sem isto, `paginaInicial()` sozinha mandaria todo
   * nutricionista pendente direto para o painel completo.
   */
  function destinoParaPerfil(perfil) {
    if (!perfil) return 'login.html';
    if (perfil.papel === 'nutricionista' && perfil.status_verificacao !== 'verificado') {
      return PAGINA_ANALISE;
    }
    return paginaInicial(perfil.papel);
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

  /**
   * O auth.uid() de quem está logado. É o que vai na coluna
   * `nutricionista_id` de tudo que o profissional cria, e o que as
   * políticas do banco comparam.
   * @returns {Promise<string>} '' quando não há sessão
   */
  async function idAtual() {
    const s = await sessao();
    return s ? s.user.id : '';
  }

  /**
   * Chama a Edge Function que tenta confirmar o CRN contra a Consulta
   * Nacional de Nutricionistas do CFN (ver supabase/functions/verificar-crn).
   * Melhor esforço, nunca lança: qualquer falha (rede, CFN fora do ar,
   * nome não bate) devolve status 'pendente' em vez de erro — quem
   * chama não precisa tratar exceção, só olhar o status devolvido.
   *
   * @returns {Promise<{ok: boolean, status?: string, motivo?: string, erro?: string}>}
   */
  async function tentarVerificarCrn() {
    const c = Banco.cx();
    if (!c) return { ok: false, erro: Banco.motivo() };

    const s = await sessao();
    if (!s) return { ok: false, erro: 'Sua sessão expirou. Entre novamente.' };

    try {
      const { data, error } = await c.functions.invoke('verificar-crn', { method: 'POST' });
      if (error) return { ok: false, erro: Banco.traduzirErro(error) };

      // O status pode ter mudado (pendente → verificado) — o cabeçalho
      // e qualquer tela que já tenha lido o perfil precisam do valor novo.
      limparCache();
      return data;
    } catch (e) {
      // Falha de rede chegando até aqui (não da Edge Function em si,
      // que já trata isso) — mesmo assim não trava: só não confirma agora.
      return { ok: true, status: 'pendente', motivo: 'Não foi possível verificar agora.' };
    }
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
    let usuario = await usuarioAtual();

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

    /* Nutricionista pendente tenta se confirmar sozinho a cada login —
       assim quem tem CRN válido nunca chega a ver a tela de análise: a
       verificação já rodou por trás antes do redirecionamento. */
    if (usuario.papel === 'nutricionista' && usuario.perfil &&
        usuario.perfil.status_verificacao === 'pendente') {
      await tentarVerificarCrn();
      usuario = await usuarioAtual();
    }

    return { ok: true, usuario, destino: destinoParaPerfil(usuario.perfil) };
  }

  /* Campos de endereço/documento que só o cadastro de nutricionista
     preenche. A página de código de convite (papel paciente) não manda
     nada disso — o gatilho no banco trata a ausência com coalesce(''). */
  const CAMPOS_NUTRICIONISTA = ['cpf', 'crn', 'cep', 'rua', 'numero', 'complemento', 'bairro', 'cidade', 'estado'];

  /**
   * Cria a conta e o perfil. O papel vai no metadata do cadastro, e um
   * gatilho no banco cria a linha em `perfis` a partir dele — assim o
   * perfil nasce junto com a conta, e não numa segunda chamada que pode
   * falhar depois da conta já existir.
   *
   * Só o cadastro de nutricionista usa cpf/crn/endereço; a página de
   * código de convite cadastra um paciente passando só nome/email/senha.
   *
   * @param {object} dados { nome, email, senha, papel, cpf?, crn?, cep?, rua?, numero?, complemento?, bairro?, cidade?, estado? }
   * @returns {Promise<{ok: boolean, erro?: string, destino?: string, precisaConfirmar?: boolean}>}
   */
  async function cadastrar(dados) {
    const nome = String(dados.nome || '').trim();
    const email = String(dados.email || '').trim().toLowerCase();
    const senha = String(dados.senha || '');
    const papel = PAPEIS.includes(dados.papel) ? dados.papel : '';

    if (!papel) return { ok: false, erro: 'Não foi possível identificar o tipo de cadastro.' };
    if (!nome) return { ok: false, erro: 'Informe seu nome.' };
    if (!email) return { ok: false, erro: 'Informe seu e-mail.' };
    if (senha.length < 6) return { ok: false, erro: 'A senha precisa ter pelo menos 6 caracteres.' };

    if (papel === 'nutricionista') {
      const cpfLimpo = CPF.apenasDigitos(dados.cpf);
      if (!CPF.valido(cpfLimpo)) return { ok: false, erro: 'CPF inválido. Confira os números digitados.' };
      if (!String(dados.crn || '').trim()) return { ok: false, erro: 'Informe seu número de CRN.' };
      if (!String(dados.cep || '').trim()) return { ok: false, erro: 'Informe o CEP do seu endereço.' };
      if (!String(dados.rua || '').trim()) return { ok: false, erro: 'Informe a rua do seu endereço.' };
      if (!String(dados.numero || '').trim()) return { ok: false, erro: 'Informe o número do seu endereço.' };
      if (!String(dados.cidade || '').trim()) return { ok: false, erro: 'Informe a cidade do seu endereço.' };
      if (!String(dados.estado || '').trim()) return { ok: false, erro: 'Informe o estado do seu endereço.' };
    }

    const c = Banco.cx();
    if (!c) return { ok: false, erro: Banco.motivo() };

    const metadata = { nome, papel };
    if (papel === 'nutricionista') {
      metadata.cpf = CPF.mascarar(dados.cpf);
      CAMPOS_NUTRICIONISTA.filter((k) => k !== 'cpf').forEach((k) => {
        metadata[k] = String(dados[k] || '').trim();
      });
    }

    const { data, error } = await c.auth.signUp({
      email,
      password: senha,
      options: { data: metadata }
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

    // Sem "Confirm email" no projeto, o cadastro já devolve sessão —
    // mesma tentativa de autoverificação do login, para quem digitou um
    // CRN válido não precisar sair e entrar de novo para ver o painel.
    if (papel === 'nutricionista') {
      await tentarVerificarCrn();
    }

    return { ok: true, destino: destinoParaPerfil(await perfilAtual()) };
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
   * @param {object} [opcoes] { pularGateStatus?: boolean } — só a própria
   *   tela de análise usa isto, para não cair num loop se redirecionando
   *   para si mesma.
   * @returns {Promise<boolean>} false quando redirecionou
   */
  async function exigirLogin(papelExigido = 'nutricionista', opcoes = {}) {
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
      const perfil = await perfilAtual();
      const papel = perfil ? perfil.papel : '';

      if (!papel) {
        await logout();
        location.replace('login.html');
        return false;
      }
      if (papel !== papelExigido) {
        location.replace(destinoParaPerfil(perfil));
        return false;
      }

      /* Nutricionista pendente ou recusado não abre as telas internas do
         consultório — a única exceção é a própria tela de análise, que
         chama com pularGateStatus para não redirecionar para si mesma. */
      if (!opcoes.pularGateStatus && papel === 'nutricionista' &&
          perfil.status_verificacao !== 'verificado') {
        location.replace(PAGINA_ANALISE);
        return false;
      }
    }

    liberar();
    return true;
  }

  return {
    PAPEIS, paginaInicial, destinoParaPerfil,
    login, cadastrar, logout,
    estaLogado, usuarioAtual, perfilAtual, papelAtual, idAtual,
    atualizarPerfilEmCache, tentarVerificarCrn, exigirLogin
  };
})();
