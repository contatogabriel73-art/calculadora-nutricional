/* ============================================================
   cep.js — preenchimento automático de endereço pela ViaCEP

   ViaCEP (viacep.com.br) é uma API pública brasileira, gratuita, sem
   necessidade de chave. Devolve rua, bairro, cidade e UF a partir do
   CEP; número e complemento continuam sendo digitados à mão, porque a
   ViaCEP não tem como saber esses dois.

   Ela não é infalível: CEP novo, rural ou de condomínio às vezes não
   está na base, e a rede pode falhar. Em qualquer um desses casos quem
   chama recebe `ok: false` e a tela libera os campos para preenchimento
   manual — nunca trava o cadastro por causa disso.
   ============================================================ */

'use strict';

const Cep = (() => {

  function apenasDigitos(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function mascarar(v) {
    const d = apenasDigitos(v).slice(0, 8);
    return d.length <= 5 ? d : d.slice(0, 5) + '-' + d.slice(5);
  }

  /**
   * @param {string} cep 8 dígitos, com ou sem traço
   * @returns {Promise<{ok: boolean, rua?, bairro?, cidade?, estado?, erro?: string}>}
   */
  async function consultar(cep) {
    const d = apenasDigitos(cep);
    if (d.length !== 8) return { ok: false, erro: 'CEP incompleto.' };

    let resposta;
    try {
      resposta = await fetch('https://viacep.com.br/ws/' + d + '/json/');
    } catch (e) {
      return { ok: false, erro: 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.' };
    }

    if (!resposta.ok) {
      return { ok: false, erro: 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.' };
    }

    let dados;
    try {
      dados = await resposta.json();
    } catch (e) {
      return { ok: false, erro: 'A resposta do CEP veio num formato inesperado. Preencha manualmente.' };
    }

    // A ViaCEP devolve HTTP 200 com {"erro": true} para CEP inexistente
    // — não é uma falha de rede, é "este CEP não está cadastrado".
    if (dados.erro) {
      return { ok: false, erro: 'CEP não encontrado. Preencha o endereço manualmente.' };
    }

    return {
      ok: true,
      rua: dados.logradouro || '',
      bairro: dados.bairro || '',
      cidade: dados.localidade || '',
      estado: dados.uf || ''
    };
  }

  return { mascarar, apenasDigitos, consultar };
})();
