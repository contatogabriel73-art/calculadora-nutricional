/* ============================================================
   vinculo-storage.js — código de convite entre paciente e nutricionista

   O nutricionista gera um código na ficha do paciente (uma vez, sob
   demanda) e passa para ele por fora do sistema — WhatsApp, papel,
   verbalmente. O paciente digita esse código na área dele.

   Por que resgatar o código passa por uma função do banco
   (`resgatar_convite`) e não por um update direto daqui: um paciente
   sem vínculo não enxerga NENHUMA linha de `pacientes` — é a Row Level
   Security fazendo o trabalho dela. Ele não teria como encontrar a
   ficha pelo código para gravar o próprio `usuario_id` nela. A função
   roda com privilégio elevado só para essa operação específica; ver
   supabase/schema.sql.
   ============================================================ */

'use strict';

const VinculoStore = (() => {

  function novoCodigo() {
    // Sem caracteres ambíguos ao ditar por telefone (0/O, 1/I/l).
    const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 6; i++) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
    return c;
  }

  /**
   * Garante que o paciente tenha um código para passar adiante.
   * Se já tiver um (ainda não usado), devolve o mesmo — trocar a cada
   * clique invalidaria um código que a pessoa já anotou.
   * @returns {Promise<{ok: boolean, codigo?: string, erro?: string}>}
   */
  async function gerarCodigoConvite(pacienteId) {
    const atual = await Banco.tabela('pacientes')
      .select('codigo_convite, usuario_id').eq('id', pacienteId).maybeSingle();

    if (atual.error) return { ok: false, erro: Banco.traduzirErro(atual.error) };
    if (atual.data && atual.data.usuario_id) {
      return { ok: false, erro: 'Este paciente já está vinculado a uma conta.' };
    }
    if (atual.data && atual.data.codigo_convite) {
      return { ok: true, codigo: atual.data.codigo_convite };
    }

    // Tenta algumas vezes: o código é curto o bastante para colidir
    // ocasionalmente com um já existente, e a coluna é `unique`.
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const codigo = novoCodigo();
      const { data, error } = await Banco.tabela('pacientes')
        .update({ codigo_convite: codigo })
        .eq('id', pacienteId)
        .select('codigo_convite');

      if (!error) {
        if (!data || !data.length) {
          return { ok: false, erro: 'Este paciente não está mais disponível.' };
        }
        return { ok: true, codigo: data[0].codigo_convite };
      }
      // 23505 = violação de unique. Qualquer outro erro não se resolve tentando de novo.
      if (error.code !== '23505') return { ok: false, erro: Banco.traduzirErro(error) };
    }
    return { ok: false, erro: 'Não foi possível gerar um código. Tente novamente.' };
  }

  /**
   * O paciente usa um código para assumir a própria ficha.
   * @returns {Promise<{ok: boolean, nutricionistaNome?: string, erro?: string}>}
   */
  async function resgatarConvite(codigo) {
    const limpo = String(codigo || '').trim();
    if (!limpo) return { ok: false, erro: 'Digite o código que seu nutricionista te passou.' };

    const { data, error } = await Banco.cx().rpc('resgatar_convite', { codigo: limpo });

    if (error) return { ok: false, erro: Banco.traduzirErro(error) };
    if (!data || !data.length) return { ok: false, erro: 'Código inválido ou já utilizado.' };

    return { ok: true, nutricionistaNome: data[0].nutricionista_nome || '' };
  }

  /**
   * A ficha (em `pacientes`) vinculada à conta de paciente logada, se
   * houver. É o ponto de partida de toda tela da área do paciente.
   * @returns {Promise<object|null>}
   */
  async function fichaVinculada() {
    const id = await Auth.idAtual();
    if (!id) return null;

    const { data, error } = await Banco.tabela('pacientes')
      .select('id, nutricionista_id, nome, nascimento, sexo')
      .eq('usuario_id', id)
      .maybeSingle();

    return error ? null : data;
  }

  /**
   * Cria a conta de paciente e manda o convite por e-mail (Edge Function
   * `convidar-paciente`) — já vincula a ficha, sem precisar de código.
   * Exige e-mail cadastrado na ficha; se o e-mail já tiver conta em
   * outro lugar, a função devolve erro sugerindo o código manual.
   * @returns {Promise<{ok: boolean, email?: string, erro?: string}>}
   */
  async function convidarPorEmail(pacienteId) {
    const c = Banco.cx();
    if (!c) return { ok: false, erro: Banco.motivo() };

    try {
      const { data, error } = await c.functions.invoke('convidar-paciente', {
        method: 'POST',
        body: { pacienteId }
      });
      if (error) {
        // FunctionsHttpError guarda a resposta original (com a mensagem
        // em português que a função devolveu) em error.context.
        const corpo = error.context && typeof error.context.json === 'function'
          ? await error.context.json().catch(() => null)
          : null;
        return { ok: false, erro: (corpo && corpo.erro) || Banco.traduzirErro(error) };
      }
      if (!data || !data.ok) return { ok: false, erro: (data && data.erro) || 'Não foi possível enviar o convite.' };
      return { ok: true, email: data.email };
    } catch (e) {
      return { ok: false, erro: 'Sem conexão com o servidor. Verifique a internet.' };
    }
  }

  return { gerarCodigoConvite, resgatarConvite, fichaVinculada, convidarPorEmail };
})();
