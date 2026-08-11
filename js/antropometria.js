/* ============================================================
   antropometria.js — cálculos da avaliação antropométrica

   Funções puras, sem DOM e sem storage: entram números, saem números.
   Ficam separadas para poderem ser conferidas isoladamente e reusadas
   nas metas do plano alimentar (Fase 2).

   Protocolos usados, todos declarados na tela para o profissional saber
   o que está sendo aplicado:

   • IMC = peso ÷ altura².
     Classificação da OMS para adultos e a de Lipschitz (1994) para
     pessoas com 60 anos ou mais — os pontos de corte são outros nessa
     faixa, e usar a tabela de adulto classificaria idoso eutrófico como
     sobrepeso.

   • % de gordura por Faulkner (1968), 4 dobras:
     tricipital + subescapular + suprailíaca + abdominal.
     Só calcula com as quatro preenchidas.

   • RCQ = cintura ÷ quadril, com corte de risco por sexo (OMS).
   ============================================================ */

'use strict';

const Antropometria = (() => {

  /** Aceita "70,5" e "70.5". Devolve null quando não há número. */
  function num(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = parseFloat(String(valor).replace(',', '.').replace(/[^0-9.]/g, ''));
    return isFinite(n) && n > 0 ? n : null;
  }

  /** IMC em kg/m². `altura` em centímetros. */
  function imc(pesoKg, alturaCm) {
    const p = num(pesoKg);
    const a = num(alturaCm);
    if (!p || !a) return null;
    const m = a / 100;
    return p / (m * m);
  }

  /**
   * Classificação do IMC. Usa Lipschitz a partir dos 60 anos.
   * @param {number|null} idade anos; null cai na tabela de adulto
   */
  function classificarImc(valor, idade) {
    if (valor == null || !isFinite(valor)) return null;

    if (idade != null && idade >= 60) {
      if (valor < 22) return { texto: 'Baixo peso', nivel: 'baixo', referencia: 'Lipschitz (≥ 60 anos)' };
      if (valor <= 27) return { texto: 'Eutrofia', nivel: 'ok', referencia: 'Lipschitz (≥ 60 anos)' };
      return { texto: 'Sobrepeso', nivel: 'alto', referencia: 'Lipschitz (≥ 60 anos)' };
    }

    if (valor < 18.5) return { texto: 'Baixo peso', nivel: 'baixo', referencia: 'OMS (adulto)' };
    if (valor < 25)   return { texto: 'Eutrofia', nivel: 'ok', referencia: 'OMS (adulto)' };
    if (valor < 30)   return { texto: 'Sobrepeso', nivel: 'atencao', referencia: 'OMS (adulto)' };
    if (valor < 35)   return { texto: 'Obesidade grau I', nivel: 'alto', referencia: 'OMS (adulto)' };
    if (valor < 40)   return { texto: 'Obesidade grau II', nivel: 'alto', referencia: 'OMS (adulto)' };
    return { texto: 'Obesidade grau III', nivel: 'alto', referencia: 'OMS (adulto)' };
  }

  /** Peso teórico para um IMC de 22 kg/m², usado como referência de meta. */
  function pesoIdeal(alturaCm) {
    const a = num(alturaCm);
    if (!a) return null;
    const m = a / 100;
    return 22 * m * m;
  }

  const DOBRAS_FAULKNER = ['tricipital', 'subescapular', 'suprailiaca', 'abdominal'];

  /**
   * % de gordura corporal por Faulkner.
   * @param {object} dobras valores em mm
   * @returns {{percentual, soma}|null} null se faltar alguma das 4 dobras
   */
  function gorduraFaulkner(dobras) {
    const valores = DOBRAS_FAULKNER.map((d) => num(dobras[d]));
    if (valores.some((v) => v == null)) return null;
    const soma = valores.reduce((a, b) => a + b, 0);
    return { percentual: soma * 0.153 + 5.783, soma };
  }

  /** Soma de todas as dobras informadas, com quantas entraram na conta. */
  function somaDobras(dobras) {
    const valores = Object.values(dobras || {}).map(num).filter((v) => v != null);
    if (!valores.length) return null;
    return { soma: valores.reduce((a, b) => a + b, 0), quantas: valores.length };
  }

  /** Massa gorda e massa magra em kg a partir do % de gordura. */
  function composicao(pesoKg, percentualGordura) {
    const p = num(pesoKg);
    if (!p || percentualGordura == null) return null;
    const gordura = (p * percentualGordura) / 100;
    return { massaGorda: gordura, massaMagra: p - gordura };
  }

  /** Relação cintura-quadril e o risco associado (corte da OMS, por sexo). */
  function rcq(cinturaCm, quadrilCm, sexo) {
    const c = num(cinturaCm);
    const q = num(quadrilCm);
    if (!c || !q) return null;

    const valor = c / q;
    let risco = null;
    if (sexo === 'F') risco = valor >= 0.85 ? 'elevado' : 'adequado';
    else if (sexo === 'M') risco = valor >= 0.90 ? 'elevado' : 'adequado';

    return { valor, risco };
  }

  /** Risco cardiovascular pela circunferência da cintura (OMS). */
  function riscoCintura(cinturaCm, sexo) {
    const c = num(cinturaCm);
    if (!c || !sexo) return null;
    const cortes = sexo === 'F' ? { atencao: 80, alto: 88 } : { atencao: 94, alto: 102 };
    if (c >= cortes.alto) return { texto: 'Risco muito elevado', nivel: 'alto' };
    if (c >= cortes.atencao) return { texto: 'Risco elevado', nivel: 'atencao' };
    return { texto: 'Sem risco aumentado', nivel: 'ok' };
  }

  /**
   * Reúne tudo o que dá para derivar de uma avaliação.
   * @param {object} av registro da avaliação
   * @param {object} paciente para idade e sexo
   */
  function analisar(av, paciente) {
    const idade = idadeNaData(paciente && paciente.nascimento, av.data);
    const sexo = (paciente && paciente.sexo) || '';

    const valorImc = imc(av.peso, av.altura);
    const dobras = av.dobras || {};
    const faulkner = gorduraFaulkner(dobras);
    const todas = somaDobras(dobras);
    const comp = faulkner ? composicao(av.peso, faulkner.percentual) : null;
    const circ = av.circunferencias || {};

    return {
      idade,
      imc: valorImc,
      classificacaoImc: classificarImc(valorImc, idade),
      pesoIdeal: pesoIdeal(av.altura),
      gordura: faulkner,
      somaDobras: todas,
      composicao: comp,
      rcq: rcq(circ.cintura, circ.quadril, sexo),
      riscoCintura: riscoCintura(circ.cintura, sexo)
    };
  }

  /* ───────────── Gasto energético ─────────────
     Mifflin-St Jeor (1990), que é a equação preditiva com melhor
     desempenho para adultos sem obesidade grave segundo a Academy of
     Nutrition and Dietetics. É estimativa: serve para escolher um ponto
     de partida, não para substituir calorimetria. */

  const FATORES_ATIVIDADE = [
    { valor: 1.2,   rotulo: 'Sedentário — pouco ou nenhum exercício' },
    { valor: 1.375, rotulo: 'Leve — exercício 1 a 3 dias/semana' },
    { valor: 1.55,  rotulo: 'Moderado — exercício 3 a 5 dias/semana' },
    { valor: 1.725, rotulo: 'Intenso — exercício 6 a 7 dias/semana' },
    { valor: 1.9,   rotulo: 'Muito intenso — trabalho físico ou 2 treinos/dia' }
  ];

  /** Taxa metabólica basal em kcal/dia. Precisa de peso, altura, idade e sexo. */
  function tmb(pesoKg, alturaCm, idade, sexo) {
    const p = num(pesoKg);
    const a = num(alturaCm);
    if (!p || !a || idade == null || !sexo) return null;
    const base = 10 * p + 6.25 * a - 5 * idade;
    return sexo === 'M' ? base + 5 : base - 161;
  }

  /** Gasto energético total = TMB × fator de atividade. */
  function get(pesoKg, alturaCm, idade, sexo, fator) {
    const b = tmb(pesoKg, alturaCm, idade, sexo);
    if (b == null) return null;
    return b * (num(fator) || 1.2);
  }

  /** Idade do paciente na data da avaliação (não a idade de hoje). */
  function idadeNaData(nascimento, dataAvaliacao) {
    if (!nascimento) return null;
    const nasc = new Date(nascimento + 'T00:00:00');
    const ref = dataAvaliacao ? new Date(dataAvaliacao + 'T00:00:00') : new Date();
    if (isNaN(nasc) || isNaN(ref)) return null;
    let idade = ref.getFullYear() - nasc.getFullYear();
    const m = ref.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && ref.getDate() < nasc.getDate())) idade--;
    return idade >= 0 && idade < 130 ? idade : null;
  }

  return {
    num, imc, classificarImc, pesoIdeal, gorduraFaulkner, somaDobras,
    composicao, rcq, riscoCintura, analisar, idadeNaData,
    tmb, get, DOBRAS_FAULKNER, FATORES_ATIVIDADE
  };
})();

/* Permite conferir os cálculos fora do navegador (node js/antropometria.js). */
if (typeof module !== 'undefined' && module.exports) module.exports = Antropometria;
