/* ============================================================
   supabase-client.js — conexão única com o banco

   Todo módulo que fala com o Supabase passa por aqui, em vez de criar
   o próprio cliente. Dois clientes na mesma página teriam sessões
   independentes: um renovaria o token e o outro seguiria com o antigo,
   e a tela começaria a receber 401 sem motivo aparente.

   Carregue nesta ordem, antes de qualquer *-storage.js:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="js/supabase-config.js"></script>
     <script src="js/supabase-client.js"></script>

   A biblioteca do CDN publica `window.supabase` (a fábrica). O que
   este arquivo publica é `Banco` — o cliente já configurado. Nomes
   diferentes de propósito, para não haver dúvida sobre qual é qual.
   ============================================================ */

'use strict';

const Banco = (() => {

  const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  let cliente = null;
  let motivoFalha = '';

  function config() {
    return window.SUPABASE_CONFIG || {};
  }

  /** true quando url e chave foram preenchidas em supabase-config.js. */
  function configurado() {
    const c = config();
    return !!(String(c.url || '').trim() && String(c.anonKey || '').trim());
  }

  /**
   * O cliente do Supabase, criado na primeira chamada.
   * @returns {object|null} null quando falta config ou a biblioteca não carregou
   */
  function cx() {
    if (cliente) return cliente;

    if (!configurado()) {
      motivoFalha = 'Faltam a URL e a chave do projeto em js/supabase-config.js.';
      return null;
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      motivoFalha = 'A biblioteca do Supabase não carregou. Verifique a conexão e se ' +
                    'a tag <script src="' + CDN + '"> está na página, antes deste arquivo.';
      return null;
    }

    const c = config();
    cliente = window.supabase.createClient(String(c.url).trim(), String(c.anonKey).trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // O link de confirmação de e-mail volta com o token no #hash da
        // URL; sem isto a sessão não seria criada ao clicar nele.
        detectSessionInUrl: true,
        storageKey: 'nutrificha-auth'
      }
    });
    motivoFalha = '';
    return cliente;
  }

  /** Explicação em português do porquê `cx()` devolveu null. */
  function motivo() {
    return motivoFalha;
  }

  /**
   * Atalho para uma tabela, já com o cliente resolvido.
   * @throws quando não há conexão — evita o "cannot read property of null"
   *         algumas camadas abaixo, longe da causa real.
   */
  function tabela(nome) {
    const c = cx();
    if (!c) throw new Error(motivoFalha || 'Sem conexão com o banco de dados.');
    return c.from(nome);
  }

  /* Mensagens do Supabase chegam em inglês e algumas são técnicas
     demais para aparecer na tela. Traduz as comuns e devolve o resto
     como veio — texto em inglês é ruim, mas some é pior. */
  const TRADUCOES = [
    [/invalid login credentials/i,        'E-mail ou senha incorretos.'],
    [/email not confirmed/i,              'Confirme o e-mail pelo link que enviamos antes de entrar.'],
    [/user already registered/i,          'Já existe uma conta com este e-mail.'],
    [/password should be at least (\d+)/i, 'A senha precisa ter pelo menos $1 caracteres.'],
    [/unable to validate email address/i, 'E-mail inválido.'],
    [/email rate limit exceeded/i,        'Muitas tentativas seguidas. Espere alguns minutos.'],
    [/for security purposes.*(\d+) seconds/i, 'Espere $1 segundos antes de tentar de novo.'],
    [/row-level security/i,               'Você não tem permissão para acessar este registro.'],
    [/duplicate key value/i,              'Este registro já existe.'],
    [/jwt expired|invalid claim/i,        'Sua sessão expirou. Entre novamente.'],
    [/failed to fetch|network ?error/i,   'Sem conexão com o servidor. Verifique a internet.']
  ];

  /** @param {*} erro objeto de erro do Supabase, ou string */
  function traduzirErro(erro) {
    if (!erro) return '';
    const texto = String(erro.message || erro.error_description || erro || '');
    for (const [padrao, traducao] of TRADUCOES) {
      if (padrao.test(texto)) return texto.replace(padrao, traducao);
    }
    return texto || 'Não foi possível concluir a operação.';
  }

  /**
   * Verifica se a conexão e o schema estão de pé. Usado por
   * supabase-teste.html; nenhuma tela do app depende disto.
   * @returns {Promise<{ok: boolean, erro?: string, tabelas?: object}>}
   */
  async function diagnostico() {
    const c = cx();
    if (!c) return { ok: false, erro: motivoFalha };

    const NOMES = [
      'perfis', 'pacientes', 'consultas', 'pagamentos', 'anamneses',
      'avaliacoes', 'fichas_tecnicas', 'planos', 'metas'
    ];

    const tabelas = {};
    for (const nome of NOMES) {
      // head + count não traz linha nenhuma: só queremos saber se a
      // tabela existe e se a política deixa consultar.
      const { error } = await c.from(nome).select('id', { count: 'exact', head: true });
      tabelas[nome] = error ? traduzirErro(error) : 'ok';
    }

    return { ok: Object.values(tabelas).every((v) => v === 'ok'), tabelas };
  }

  return { CDN, configurado, cx, tabela, motivo, traduzirErro, diagnostico };
})();
