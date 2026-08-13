/* ============================================================
   cpf.js — máscara e validação de CPF

   Só valida o FORMATO — o dígito verificador é aritmética pública sobre
   o número que a própria pessoa digitou, não uma consulta a nenhuma
   base de dados. Não confirma que o CPF existe, nem que pertence a quem
   está cadastrando; só pega erro de digitação antes de gravar.

   Deliberadamente não existe verificação de CPF contra nenhum cadastro
   externo (Receita Federal ou qualquer outro): não há fonte pública
   legítima para isso, e cruzar CPF com uma base de terceiros sem base
   legal clara é o tipo de coisa que a LGPD trata como risco, não
   funcionalidade.
   ============================================================ */

'use strict';

const CPF = (() => {

  function apenasDigitos(v) {
    return String(v || '').replace(/\D/g, '');
  }

  /** "12345678900" → "123.456.789-00", formatando enquanto digita. */
  function mascarar(v) {
    const d = apenasDigitos(v).slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + '.' + d.slice(3);
    if (d.length <= 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6);
    return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
  }

  function digitoVerificador(base) {
    let soma = 0;
    let peso = base.length + 1;
    for (const c of base) soma += Number(c) * peso--;
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  }

  /** @returns {boolean} formato e dígitos verificadores válidos */
  function valido(v) {
    const d = apenasDigitos(v);
    if (d.length !== 11) return false;
    // Sequências repetidas (000.000.000-00, 111.111.111-11...) têm
    // dígito verificador matematicamente "válido", mas nenhuma é CPF real.
    if (/^(\d)\1{10}$/.test(d)) return false;

    const d1 = digitoVerificador(d.slice(0, 9));
    const d2 = digitoVerificador(d.slice(0, 9) + d1);
    return d === d.slice(0, 9) + String(d1) + String(d2);
  }

  return { mascarar, valido, apenasDigitos };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CPF;
