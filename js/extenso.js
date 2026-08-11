/* ============================================================
   extenso.js — valor monetário por extenso

   Recibo brasileiro traz o valor escrito por extenso, então isso não é
   enfeite: é o que dá ao documento a forma que as pessoas esperam.

   Regras que a implementação respeita:
   • 100 exato é "cem"; com resto vira "cento e ..." (cento e um)
   • o "e" liga centena a dezena e dezena a unidade: "cento e vinte e três"
   • entre grupos de milhar o "e" só entra quando o último grupo é menor
     que 100 ou é centena redonda: "mil e duzentos", mas "mil duzentos e um"
   • concorda o singular: "um real", "um centavo"
   ============================================================ */

'use strict';

const Extenso = (() => {

  const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const DEZ_A_DEZENOVE = ['dez', 'onze', 'doze', 'treze', 'catorze', 'quinze',
                          'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta',
                   'sessenta', 'setenta', 'oitenta', 'noventa'];
  const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
                    'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  const ESCALAS = [
    { singular: '', plural: '' },
    { singular: 'mil', plural: 'mil' },
    { singular: 'milhão', plural: 'milhões' },
    { singular: 'bilhão', plural: 'bilhões' }
  ];

  /** Escreve um número de 1 a 999. */
  function ateNovecentos(n) {
    if (n === 100) return 'cem';

    const partes = [];
    const c = Math.floor(n / 100);
    const resto = n % 100;

    if (c > 0) partes.push(CENTENAS[c]);

    if (resto >= 10 && resto <= 19) {
      partes.push(DEZ_A_DEZENOVE[resto - 10]);
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      if (d > 0) partes.push(DEZENAS[d]);
      if (u > 0) partes.push(UNIDADES[u]);
    }

    return partes.join(' e ');
  }

  /** Escreve um inteiro de 0 a 999.999.999.999. */
  function inteiro(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    if (n === 0) return 'zero';

    // Quebra em grupos de três, do menos significativo para o mais.
    const grupos = [];
    let resto = n;
    while (resto > 0) {
      grupos.push(resto % 1000);
      resto = Math.floor(resto / 1000);
    }
    if (grupos.length > ESCALAS.length) return String(n);

    const escritos = [];
    for (let i = grupos.length - 1; i >= 0; i--) {
      const valor = grupos[i];
      if (valor === 0) continue;

      const escala = ESCALAS[i];
      // "mil" não leva "um" na frente: 1000 é "mil", não "um mil".
      const texto = (i === 1 && valor === 1)
        ? 'mil'
        : ateNovecentos(valor) + (escala.singular ? ' ' + (valor === 1 ? escala.singular : escala.plural) : '');

      escritos.push({ texto, valor, escala: i });
    }

    // Junta os grupos. O "e" antes do último só entra quando esse último
    // grupo é menor que 100 ou é centena redonda.
    let frase = '';
    escritos.forEach((g, idx) => {
      if (idx === 0) { frase = g.texto; return; }
      const ehUltimo = idx === escritos.length - 1;
      const ligaComE = ehUltimo && (g.valor < 100 || (g.valor % 100 === 0 && g.valor < 1000));
      frase += (ligaComE ? ' e ' : ' ') + g.texto;
    });

    return frase;
  }

  /**
   * Valor em reais por extenso.
   * @param {number} valor
   * @returns {string} "mil duzentos e trinta e quatro reais e cinquenta centavos"
   */
  function reais(valor) {
    const n = Number(valor);
    if (!isFinite(n)) return '';

    // Arredonda em centavos para evitar 0,1+0,2 virar 0,30000000000000004.
    const totalCentavos = Math.round(Math.abs(n) * 100);
    const parteInteira = Math.floor(totalCentavos / 100);
    const centavos = totalCentavos % 100;

    const partes = [];

    if (parteInteira > 0) {
      const texto = inteiro(parteInteira);
      // "milhão" e "bilhão" pedem preposição quando fecham o número:
      // "um milhão DE reais", mas "um milhão e duzentos mil reais".
      const pedeDe = /(milhão|milhões|bilhão|bilhões)$/.test(texto);
      const moeda = parteInteira === 1 ? ' real' : ' reais';
      partes.push(texto + (pedeDe ? ' de' : '') + moeda);
    }
    if (centavos > 0) {
      partes.push(inteiro(centavos) + (centavos === 1 ? ' centavo' : ' centavos'));
    }
    if (!partes.length) return 'zero real';

    return partes.join(' e ');
  }

  return { inteiro, reais, ateNovecentos };
})();

/* Permite conferir fora do navegador: node js/extenso.js */
if (typeof module !== 'undefined' && module.exports) module.exports = Extenso;
