// ====================== CONFIGURAÇÕES ======================
const WEBAPP = "https://script.google.com/macros/s/AKfycbzKB9upgtV4jRI1SNA1nfBcqGRTXQMLRVBpb7QAxvkPtKm_RnWOsjmUN8aguZpYE8_Qgg/exec";
const SHEET_NAME = "MontagemLivre";

// MESMO ESQUEMA DO JOGO PFISTER – AJUSTE SE PRECISAR
const DRIVE_UPLOAD_URL = "https://script.google.com/macros/s/AKfycbxKEMl_4BlpgPNgtM-BmWhjmVov9Mg5u4QmrmXfHI0e6yQA8F5shtdESDAWwFijMbZ54w/exec";
const DRIVE_FOLDER_ID  = "1d1bYR4dnsSuoV3_3M9iiJ5MN8lMh6bTS";

// estado do CPF
let currentCPF = "";
const SHEETDB_BASE_URL = "https://sheetdb.io/api/v1/8pmdh33s9fvy8";
let currentPatientName = "";

// ====================== BUSCA NOME (SHEETDB) ======================
async function fetchPatientNameByCPF(cpf) {
  const cleanCPF = (cpf || '').replace(/\D/g, '');
  if (!cleanCPF) return "";

  try {
    const url = `${SHEETDB_BASE_URL}/search?sheet=Patients&cpf=${encodeURIComponent(cleanCPF)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('SheetDB HTTP error', res.status);
      return "";
    }

    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && data[0].nome) {
      return String(data[0].nome).trim();
    }
  } catch (e) {
    console.error('Erro ao buscar nome no SheetDB', e);
  }

  return "";
}

// ====================== JSONP (PLANILHA GOOGLE) ======================
function jsonp(url, params = {}) {
  return new Promise((resolve, reject) => {
    const cb = "cb_" + Math.random().toString(36).slice(2);
    params.callback = cb;
    const qs = new URLSearchParams(params).toString();
    const s = document.createElement("script");
    const timeout = setTimeout(() => { cleanup(); reject("timeout"); }, 15000);
    function cleanup() {
      clearTimeout(timeout);
      delete window[cb];
      s.remove();
    }
    window[cb] = (payload) => { cleanup(); resolve(payload); };
    s.onerror = () => { cleanup(); reject("script_error"); };
    s.src = `${url}?${qs}`;
    document.body.appendChild(s);
  });
}

// ====================== CPF GATE ======================
async function verifyCPF() {
  const input = document.getElementById('cpfInput');
  const fb    = document.getElementById('cpfFeedback');
  const btn   = document.getElementById('cpfCheckBtn');
  const cpf   = (input.value || '').replace(/\D/g,'');

  if (!cpf) {
    fb.style.color = '#c00';
    fb.innerText   = 'Digite um CPF válido.';
    return;
  }

  fb.style.color = '#444';
  fb.innerText   = 'Verificando...';
  btn.disabled   = true;

  try {
    const resp = await jsonp(WEBAPP, { action: 'check', cpf, sheet: SHEET_NAME });
    if (!resp || !resp.ok) throw new Error(resp?.error || 'Erro');

    if (resp.status === 'allowed') {
      currentCPF = cpf;

      // tenta buscar o nome do paciente na planilha "Patients"
      currentPatientName = await fetchPatientNameByCPF(cpf);

      fb.style.color = '#0a7';
      fb.innerText   = 'Liberado! Você pode iniciar.';
      input.disabled = true;
      btn.disabled   = true;

      setTimeout(() => {
        document.getElementById("cpfGate").style.display = "none";
      }, 1000);

      const container = document.getElementById('container');
      container.style.display = 'flex';

      // mostra a referência da Fase 1, mas ainda sem iniciar o tempo
      faseAtual = 0;
      montarReferencia();
      if (faseInfoEl) {
        faseInfoEl.textContent = 'Fase 1';
      }
      if (cronometroEl) {
        cronometroEl.textContent = '⏳ O tempo começará após você clicar em "Iniciar".';
      }
      if (resultado) {
        resultado.textContent = '';
      }
    } else if (resp.status === 'already_answered') {
      fb.style.color = '#c00';
      fb.innerText   = 'Teste já respondido. Não é possível responder novamente.';
    } else if (resp.status === 'not_allowed') {
      fb.style.color = '#c00';
      fb.innerText   = 'Teste não liberado para este CPF.';
    } else if (resp.status === 'not_found') {
      fb.style.color = '#c00';
      fb.innerText   = 'CPF não encontrado.';
    } else {
      fb.style.color = '#c00';
      fb.innerText   = 'Erro na verificação.';
    }
  } catch(e) {
    fb.style.color = '#c00';
    fb.innerText   = 'Falha na verificação. Tente novamente.';
  } finally {
    if (!currentCPF) btn.disabled = false;
  }
}

document.getElementById('cpfCheckBtn').onclick = verifyCPF;

// ====================== ELEMENTOS PRINCIPAIS ======================
const areaLivre        = document.getElementById('areaLivre');
const referencia       = document.getElementById('referencia');
const resultado        = document.getElementById('resultado');
const faseInfoEl       = document.getElementById('faseInfo');
const cronometroEl     = document.getElementById('cronometro');
const pecasDisponiveis = document.getElementById('pecasDisponiveis');

let inicioFaseTimestamp = null;
let faseAtual           = 0;
let dragOffset          = { x: 0, y: 0 };
let tentativaAtual      = 0;
let pontuacoes          = [];
let tempoRestante       = 0;
let cronometroIntervalo = null;
let painelResumo        = null;
let temposFases         = [];

// Arraste manual dentro da área de montagem (mantém a rotação visual)
let mouseDraggingPiece = null;
let mouseDragOffsetX = 0;
let mouseDragOffsetY = 0;

function enableMouseDrag(peca) {
  peca.addEventListener('mousedown', function (e) {
    // Só botão esquerdo
    if (e.button !== 0) return;

    // Se começou no botão de giro, NÃO inicia arraste
    if (e.target.tagName === 'SPAN') return;

    e.preventDefault();
    mouseDraggingPiece = peca;

    const rect = peca.getBoundingClientRect();
    mouseDragOffsetX = e.clientX - rect.left;
    mouseDragOffsetY = e.clientY - rect.top;

    peca.style.zIndex = 1000;
  });
}

// helper: remove peça da área preta se ela sair totalmente dela
function removeIfOutsideArea(peca) {
  // só remove se a peça estiver de fato dentro da áreaLivre
  if (!peca || peca.parentElement !== areaLivre) return false;

  const areaRect  = areaLivre.getBoundingClientRect();
  const pieceRect = peca.getBoundingClientRect();

  const saiu =
    pieceRect.right  < areaRect.left  ||
    pieceRect.left   > areaRect.right ||
    pieceRect.bottom < areaRect.top   ||
    pieceRect.top    > areaRect.bottom;

  if (saiu) {
    peca.remove();
    return true;
  }
  return false;
}

// Move a peça conforme o mouse
document.addEventListener('mousemove', function (e) {
  if (!mouseDraggingPiece) return;

  const areaRect = areaLivre.getBoundingClientRect();
  const x = e.clientX - areaRect.left - mouseDragOffsetX;
  const y = e.clientY - areaRect.top  - mouseDragOffsetY;

  mouseDraggingPiece.style.position = 'absolute';
  mouseDraggingPiece.style.left = x + 'px';
  mouseDraggingPiece.style.top  = y + 'px';

  // se saiu da área preta, some com a peça
  if (removeIfOutsideArea(mouseDraggingPiece)) {
    mouseDraggingPiece = null;
  }
});

// Solta a peça
document.addEventListener('mouseup', function () {
  if (!mouseDraggingPiece) return;
  // se ainda existe (não foi removida), volta o z-index
  if (document.body.contains(mouseDraggingPiece)) {
    mouseDraggingPiece.style.zIndex = 1;
  }
  mouseDraggingPiece = null;
});


// ====================== RESUMO / SNAPSHOT ======================
function formatarTempoSegundos(totalSegundos) {
  totalSegundos = totalSegundos || 0;
  const min = Math.floor(totalSegundos / 60);
  const seg = totalSegundos % 60;
  if (min <= 0) return `${seg}s`;
  return `${min}min ${String(seg).padStart(2, '0')}s`;
}

function garantirPainelResumo() {
  if (painelResumo) return painelResumo;

  painelResumo = document.createElement('div');
  painelResumo.id = 'painelResumoFases';
  painelResumo.style.position   = 'absolute';
  painelResumo.style.left       = '-9999px';
  painelResumo.style.top        = '0';
  painelResumo.style.width      = '900px';
  painelResumo.style.background = '#ffffff';
  painelResumo.style.color      = '#000000';
  painelResumo.style.padding    = '16px';
  painelResumo.style.boxSizing  = 'border-box';
  painelResumo.style.fontFamily = "'Segoe UI', sans-serif";

  const titulo = document.createElement('h2');
  titulo.textContent = 'Montagem Livre - Resumo das Fases';
  titulo.style.margin = '0 0 16px 0';
  painelResumo.appendChild(titulo);

  document.body.appendChild(painelResumo);
  return painelResumo;
}

function registrarFaseSnapshot(faseIndex, tempoGastoSegundos) {
  const painel    = garantirPainelResumo();
  const faseNumero = faseIndex + 1;
  const tempoFmt   = formatarTempoSegundos(tempoGastoSegundos || 0);

  const card = document.createElement('div');
  card.style.display       = 'flex';
  card.style.alignItems    = 'center';
  card.style.gap           = '16px';
  card.style.marginBottom  = '12px';
  card.style.border        = '1px solid #ddd';
  card.style.borderRadius  = '8px';
  card.style.padding       = '8px 10px';
  card.style.background    = '#fafafa';

  const info = document.createElement('div');
  info.style.fontSize   = '14px';
  info.style.fontWeight = '600';
  info.textContent      = `Fase ${faseNumero} — Tempo: ${tempoFmt}`;
  card.appendChild(info);

  const mini = document.createElement('div');
  mini.style.position   = 'relative';
  mini.style.width      = areaLivre.clientWidth + 'px';
  mini.style.height     = areaLivre.clientHeight + 'px';
  mini.style.background = '#000';
  mini.style.border     = '1px solid #ccc';
  mini.style.overflow   = 'hidden';
  mini.style.flexShrink = '0';

  const pecas = Array.from(areaLivre.querySelectorAll('.peca'));
  pecas.forEach(orig => {
    const clone = orig.cloneNode(true);
    clone.style.position = 'absolute';
    mini.appendChild(clone);
  });

  card.appendChild(mini);
  painel.appendChild(card);

  temposFases[faseIndex] = tempoGastoSegundos || 0;
}

// ====================== REGRAS DE TEMPO / PONTUAÇÃO ======================
const regrasTempo = {
  6:  [ [5,7], [10,6], [15,5], [Infinity,4] ],
  7:  [ [5,7], [10,6], [15,5], [Infinity,4] ],
  8:  [ [10,7], [15,6], [20,5], [Infinity,4] ],
  9:  [ [20,7], [25,6], [35,5], [Infinity,4] ],
 10: [ [30,7], [45,6], [65,5], [Infinity,4] ],
 11: [ [40,7], [55,6], [75,5], [Infinity,4] ],
 12: [ [40,7], [55,6], [75,5], [Infinity,4] ],
 13: [ [35,7], [45,6], [65,5], [Infinity,4] ],
};

const tentativasPorFase = [2,2,2,2,2,2,1,1,1,1,1,1,1,1];
const tempoPorFase      = [30,30,30,30,60,60,60,60,60,120,120,130,130,150];

// ====================== DEFINIÇÃO DAS FASES (CONFIG ORIGINAL) ======================
const fases = [
  [
    { tipo: 'vermelha',  x: 0,  y: 0,  rot: 0 },
    { tipo: 'vermelha',  x: 70, y: 0,  rot: 0 },
  ], // 1

  [
    { tipo: 'branca',  x: 0,  y: 0,  rot: 0 },
    { tipo: 'vermelha',  x: 70, y: 0,  rot: 0 },
  ], // 2

  [
    { tipo: 'branca',  x: 0,  y: 0,  rot: 0 },
    { tipo: 'branca',  x: 70, y: 0,  rot: 0 },
    { tipo: 'branca',    x: 0,  y: 70, rot: 0 },
    { tipo: 'dividida',    x: 70, y: 70, rot: 180 }
  ], // 3

  [
    { tipo: 'vermelha',  x: 0,  y: 0,  rot: 0 },
    { tipo: 'branca',  x: 70, y: 0,  rot: 0 },
    { tipo: 'branca',    x: 0,  y: 70, rot: 0 },
    { tipo: 'vermelha',    x: 70, y: 70, rot: 0 }
  ], // 4

  [
    { tipo: 'vermelha',  x: 0,  y: 0,  rot: 0 },
    { tipo: 'vermelha',  x: 70, y: 0,  rot: 0 },
    { tipo: 'dividida',    x: 0,  y: 70, rot: 180 },
    { tipo: 'branca',    x: 70, y: 70, rot: 0 }
  ], // 5

  [
    { tipo: 'vermelha',  x: 0,  y: 0,  rot: 0 },
    { tipo: 'vermelha',  x: 70, y: 0,  rot: 0 },
    { tipo: 'dividida',    x: 0,  y: 70, rot: 90 },
    { tipo: 'dividida',    x: 70, y: 70, rot: 0 }
  ], // 6

  [
    { tipo: 'branca',  x: 0,  y: 0,  rot: 0 },
    { tipo: 'dividida',  x: 70, y: 0,  rot: 270 },
    { tipo: 'dividida',  x: 0,  y: 70, rot: 90 },
    { tipo: 'branca',    x: 70, y: 70, rot: 0 }
  ], // 7

  [
    { tipo: 'dividida',  x: 0,  y: 0,  rot: 180 },
    { tipo: 'vermelha',  x: 70, y: 0,  rot: 0 },
    { tipo: 'vermelha',    x: 0,  y: 70, rot: 0 },
    { tipo: 'dividida',    x: 70, y: 70, rot: 0 }
  ], // 8

  [
    { tipo: 'dividida',  x: 0,  y: 0,  rot: 180 },
    { tipo: 'dividida',  x: 70, y: 0,  rot: 270 },
    { tipo: 'dividida',    x: 0,  y: 70, rot: 0 },
    { tipo: 'dividida',    x: 70, y: 70, rot: 90 }
  ], // 9

  [
    { tipo: 'dividida',  x: 0,   y: 0,   rot: 270 },
    { tipo: 'branca',    x: 70,  y: 0,   rot: 0 },
    { tipo: 'dividida',  x: 140, y: 0,   rot: 0 },
    { tipo: 'branca',    x: 0,   y: 70,  rot: 0 },
    { tipo: 'vermelha',  x: 70,  y: 70,  rot: 0 },
    { tipo: 'branca',    x: 140, y: 70,  rot: 0 },
    { tipo: 'dividida',  x: 0,   y: 140, rot: 180 },
    { tipo: 'branca',    x: 70,  y: 140, rot: 0 },
    { tipo: 'dividida',  x: 140, y: 140, rot: 90 }
  ], // 10

  [
    { tipo: 'dividida',  x: 0,   y: 0,   rot: 90 },
    { tipo: 'dividida',  x: 70,  y: 0,   rot: 270 },
    { tipo: 'dividida',  x: 140, y: 0,   rot: 90 },
    { tipo: 'dividida',  x: 0,   y: 70,  rot: 270 },
    { tipo: 'dividida',  x: 70,  y: 70,  rot: 90 },
    { tipo: 'dividida',  x: 140, y: 70,  rot: 270 },
    { tipo: 'dividida',  x: 0,   y: 140, rot: 90 },
    { tipo: 'dividida',  x: 70,  y: 140, rot: 270 },
    { tipo: 'dividida',  x: 140, y: 140, rot: 90 }
  ], // 11

  [
    { tipo: 'dividida',  x: 0,   y: 0,   rot: 270 },
    { tipo: 'dividida',  x: 70,  y: 0,   rot: 90 },
    { tipo: 'dividida',  x: 140, y: 0,   rot: 0 },
    { tipo: 'dividida',  x: 0,   y: 70,  rot: 90 },
    { tipo: 'dividida',  x: 70,  y: 70,  rot: 270 },
    { tipo: 'dividida',  x: 140, y: 70,  rot: 180 },
    { tipo: 'dividida',  x: 0,   y: 140, rot: 180 },
    { tipo: 'dividida',  x: 70,  y: 140, rot: 0 },
    { tipo: 'dividida',  x: 140, y: 140, rot: 90 }
  ], // 12

  {
    rotacionarReferencia: true,
    pecas: [
      { tipo: 'dividida', x: 0, y: 0, rot: 0 },
      { tipo: 'branca', x: 70, y: 0, rot: 0 },
      { tipo: 'dividida', x: 140, y: 0, rot: 270 },
      { tipo: 'branca', x: 0, y: 70, rot: 0 },
      { tipo: 'dividida', x: 70, y: 70, rot: 180 },
      { tipo: 'vermelha', x: 140, y: 70, rot: 0 },
      { tipo: 'dividida', x: 0, y: 140, rot: 90 },
      { tipo: 'vermelha', x: 70, y: 140, rot: 0 },
      { tipo: 'dividida', x: 140, y: 140, rot: 0 }
    ]
  }, // 13

  {
    rotacionarReferencia: true,
    pecas: [
      { tipo: 'vermelha',  x: 0,   y: 0,   rot: 0 },
      { tipo: 'dividida',  x: 70,  y: 0,   rot: 180 },
      { tipo: 'dividida',  x: 140, y: 0,   rot: 270 },
      { tipo: 'dividida',  x: 0,   y: 70,  rot: 180 },
      { tipo: 'branca',    x: 70,  y: 70,  rot: 0 },
      { tipo: 'vermelha',  x: 140, y: 70,  rot: 0 },
      { tipo: 'dividida',  x: 0,   y: 140, rot: 90 },
      { tipo: 'vermelha',  x: 70,  y: 140, rot: 0 },
      { tipo: 'vermelha',  x: 140, y: 140, rot: 0 }
    ]
  } // 14
];


// ====================== PEÇAS POR FASE ======================
function getLimitesDaFase(index = faseAtual) {
  const fase = fases[index];
  const posicoes = fase.pecas || fase;
  const total = posicoes.length;

  return {
    min: total,
    max: total
  };
}



// ====================== REFERÊNCIA ======================
function montarReferencia() {
  referencia.innerHTML = '';

  const fase     = fases[faseAtual];
  const posicoes = fase.pecas || fase;

  if (fase.rotacionarReferencia) {
    referencia.classList.add('rotacionado');
  } else {
    referencia.classList.remove('rotacionado');
  }

  const colunas = Math.max(...posicoes.map(p => p.x)) / 70 + 1;
  const linhas  = Math.max(...posicoes.map(p => p.y)) / 70 + 1;
  referencia.style.gridTemplateColumns = `repeat(${colunas}, 70px)`;
  referencia.style.gridTemplateRows    = `repeat(${linhas}, 70px)`;

  if (faseAtual >= 9) {
    referencia.style.border = 'none';
  } else {
    referencia.style.border = '1.5px solid black';
  }

  posicoes.forEach(g => {
    const peca = document.createElement('div');
    peca.className    = 'peca ' + g.tipo;
    peca.style.width  = '71px';
    peca.style.height = '71px';

    if (g.tipo === 'dividida') {
      peca.style.transform = `rotate(${g.rot}deg)`;
      peca.setAttribute('data-rot', g.rot);
    }

    referencia.appendChild(peca);
  });
}

// ====================== ÁREA LIVRE ======================
function montarAreaLivre() {
  areaLivre.innerHTML = '';
  areaLivre.ondragover = e => e.preventDefault();
 areaLivre.ondrop = function (e) {
  e.preventDefault();

  

  const { min, max } = getLimitesDaFase();
const pecasAtuais = areaLivre.querySelectorAll('.peca').length;

if (pecasAtuais >= max) {
  if (resultado) {
    resultado.textContent = `⚠️ Você só pode usar ${max} peça(s) nesta fase. Remova uma para adicionar outra.`;
  }
  return;
}


  const tipoData = e.dataTransfer.getData('text');
  const partes   = tipoData.split('_');
  const tipo     = partes[0];
  const rot      = partes[1] || 0;
  const areaRect = areaLivre.getBoundingClientRect();
  let offsetX    = e.clientX - areaRect.left - dragOffset.x;
  let offsetY    = e.clientY - areaRect.top  - dragOffset.y;
  offsetX        = Math.max(0, Math.min(offsetX, areaLivre.clientWidth  - 70));
  offsetY        = Math.max(0, Math.min(offsetY, areaLivre.clientHeight - 70));

  const novaPeca = document.createElement('div');
  // ... resto do código igual

    novaPeca.className = 'peca ' + tipo;
    novaPeca.style.left = offsetX + 'px';
    novaPeca.style.top  = offsetY + 'px';
    novaPeca.setAttribute('data-tipo', tipo);
    novaPeca.setAttribute('data-rot',  rot);
    novaPeca.style.transform = `rotate(${rot}deg)`;

    // toca: arraste por toque (mobile)
    ativarToqueMobile(novaPeca);
    // mouse: arraste manual (mantém rotação)
    enableMouseDrag(novaPeca);

    if (tipo === 'dividida') {
      const botao = document.createElement('span');
      botao.textContent      = '🔄';
      botao.style.cursor     = 'pointer';
      botao.style.fontSize   = '1.5rem';
      botao.style.pointerEvents = 'auto';
      botao.style.zIndex     = '2';
      // posição vai ser controlada pelo CSS (.peca.dividida span)

      // impede que o mousedown do botão dispare o arraste
      botao.addEventListener('mousedown', e => {
        e.stopPropagation();
        e.preventDefault();
      });
      botao.addEventListener('touchstart', e => {
        e.stopPropagation();
      });

      botao.onclick = function (e) {
        e.stopPropagation();
        let anguloAtual = parseInt(novaPeca.getAttribute('data-rot') || 0);
        let novoAngulo  = (anguloAtual + 45) % 360;
        novaPeca.style.transform = `rotate(${novoAngulo}deg)`;
        novaPeca.setAttribute('data-rot', novoAngulo);
      };

      novaPeca.appendChild(botao);
    }

    // não usamos draggable dentro da área livre
    areaLivre.appendChild(novaPeca);
  };
}

function dragStartHandlerLivre(e) {
  const tipo = this.getAttribute('data-tipo');
  const rot  = this.getAttribute('data-rot') || '0';
  const rect = this.getBoundingClientRect();
  dragOffset.x = e.clientX - rect.left;
  dragOffset.y = e.clientY - rect.top;

  e.dataTransfer.setData('text', tipo + '_' + rot);

  const imagemFantasma = this.cloneNode(true);
  imagemFantasma.style.position  = 'absolute';
  imagemFantasma.style.top       = '-1000px';
  imagemFantasma.style.transform = this.style.transform;
  document.body.appendChild(imagemFantasma);
  e.dataTransfer.setDragImage(imagemFantasma, dragOffset.x, dragOffset.y);

  setTimeout(() => {
    this.remove();
    document.body.removeChild(imagemFantasma);
  }, 1);
}

// ====================== VERIFICAÇÃO ======================
function verificar() {
  const pecas = Array.from(areaLivre.querySelectorAll('.peca'));
  const { min, max } = getLimitesDaFase();

// quantidade insuficiente
if (pecas.length < min) {
  resultado.textContent = `⚠️ Faltam peças! Coloque ${min} peça(s) antes de verificar.`;
  return;
}

// quantidade excessiva (caso o jogador altere no DOM manualmente)
if (pecas.length > max) {
  resultado.textContent = `⚠️ Peças demais! Use exatamente ${max} peça(s).`;
  return;
}

  const fase  = fases[faseAtual];
  const gabaritoOriginal = fase.pecas || fase;

  const tempoGasto = inicioFaseTimestamp
    ? Math.floor((Date.now() - inicioFaseTimestamp) / 1000)
    : 0;

  if (!pecas.length) {
    resultado.textContent = "❌ Coloque as peças antes de verificar.";
    return;
  }

  const minX = Math.min(...pecas.map(p => parseInt(p.style.left)));
  const minY = Math.min(...pecas.map(p => parseInt(p.style.top)));

  const usuario = pecas.map(p => ({
    tipo: p.getAttribute('data-tipo'),
    x: Math.round(parseFloat(p.style.left)) - minX,
    y: Math.round(parseFloat(p.style.top))  - minY,
    rot: parseInt(p.getAttribute('data-rot') || 0)
  }));

  let gab = gabaritoOriginal.map(p => ({ ...p }));
  const gabMinX = Math.min(...gab.map(p => p.x));
  const gabMinY = Math.min(...gab.map(p => p.y));

  gab = gab.map(p => ({
    ...p,
    x: p.x - gabMinX,
    y: p.y - gabMinY
  }));

  const correto = gab.every(g =>
    usuario.some(p =>
      p.tipo === g.tipo &&
      Math.abs(p.x - g.x) <= 65 &&
      Math.abs(p.y - g.y) <= 65 &&
      (p.tipo !== 'dividida' || (p.rot % 360) === (g.rot % 360))
    )
  );

  if (correto) {
    let pontos   = 0;
    const faseIndex = faseAtual;

    // Fases 1 a 6 com tentativas (mantido do jogo original)
    if (faseIndex < 6) {
      pontos = tentativaAtual === 0 ? 2 : 1;
    }
    // Demais fases com regras de tempo (mantido do jogo original)
    else if (regrasTempo.hasOwnProperty(faseIndex)) {
      const regras = regrasTempo[faseIndex];
      for (const [limite, p] of regras) {
        if (tempoGasto <= limite) {
          pontos = p;
          break;
        }
      }
    } else {
      pontos = 1;
    }

    pontuacoes[faseIndex] = pontos;
    resultado.textContent  = "";
    tentativaAtual         = 0;
    proximaFase(tempoGasto);
  } else {
    tentativaAtual++;

    if (faseAtual < 6 && tentativaAtual < tentativasPorFase[faseAtual]) {
      resultado.textContent = "❌ Tente novamente.";
      clearInterval(cronometroIntervalo);
      iniciarContagemRegressiva();
    } else {
      pontuacoes[faseAtual] = 0;
      tentativaAtual        = 0;
      resultado.textContent = "";
      proximaFase(tempoGasto);
    }
  }
}

// ====================== PRÓXIMA FASE / FINAL ======================
function proximaFase(tempoGastoSegundos) {
  clearInterval(cronometroIntervalo);

  // guarda a imagem da fase atual (montagem + tempo)
  registrarFaseSnapshot(faseAtual, tempoGastoSegundos);

  faseAtual++;

  // ✅ ACABOU O TESTE
  if (faseAtual >= fases.length) {
    const btnVerificar = document.getElementById('btnVerificar');
    if (btnVerificar) {
      btnVerificar.removeEventListener('click', verificar);
      btnVerificar.disabled = true;
      btnVerificar.textContent = 'Aguarde...';
    }

    if (resultado) {
      resultado.textContent = 'Aguarde, finalizando o teste...';
    }
    enviarResultados();
    return;
  }

  // segue o jogo normalmente nas fases anteriores
  resultado.textContent = '';
  tentativaAtual = 0;
  iniciarFaseDireta();
  inicioFaseTimestamp = Date.now();
}

// ====================== INFOS DA FASE ======================
function atualizarFaseInfo() {
  if (faseInfoEl) {
    const { min, max } = getLimitesDaFase();
    faseInfoEl.textContent = `Fase ${faseAtual + 1} — você deve usar exatamente ${min} peça(s).`;
  }
}



function atualizarPecasDisponiveis() {
  pecasDisponiveis.innerHTML = '';
  const fase  = fases[faseAtual];
  const tipos = fase.tiposDisponiveis || ['vermelha', 'branca', 'dividida'];

  tipos.forEach(tipo => {
    const peca = document.createElement('div');
    peca.className = 'peca ' + tipo;
    peca.setAttribute('data-tipo', tipo);
    peca.setAttribute('data-rot',  '0');
    peca.setAttribute('draggable', 'true');
    ativarToqueMobile(peca);

    // aqui na prateleira NÃO colocamos botão de giro,
    // o botão 🔄 aparece só nas peças soltas na área preta

    peca.addEventListener('dragstart', function (e) {
      const tipo = this.getAttribute('data-tipo');
      const rot  = this.getAttribute('data-rot') || '0';
      const rect = this.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;

      e.dataTransfer.setData('text', tipo + '_' + rot);

      const imagemFantasma = this.cloneNode(true);
      imagemFantasma.style.position  = 'absolute';
      imagemFantasma.style.top       = '-1000px';
      imagemFantasma.style.transform = this.style.transform;
      document.body.appendChild(imagemFantasma);
      e.dataTransfer.setDragImage(imagemFantasma, dragOffset.x, dragOffset.y);

      setTimeout(() => {
        document.body.removeChild(imagemFantasma);
      }, 1);
    });

    pecasDisponiveis.appendChild(peca);
  });
}

// ====================== INÍCIO DO JOGO ======================
function startGame() {
  // esconde o texto + botão de início (bloco inteiro)
  const orient = document.getElementById('orientacoesInicial');
  if (orient) {
    orient.style.display = 'none';
  }

  const btnIniciar = document.getElementById('btnIniciar');
  if (btnIniciar) {
    btnIniciar.style.display = 'none';
  }

  faseAtual      = 0;
  pontuacoes     = Array(fases.length).fill(0);
  tentativaAtual = 0;
  temposFases    = [];
  if (painelResumo && painelResumo.parentNode) {
    painelResumo.parentNode.removeChild(painelResumo);
  }
  painelResumo = null;

  montarReferencia();

  // deixa a imagem de referência maior depois que o jogo começa
  referencia.classList.add('grande');

  montarAreaLivre();
  atualizarFaseInfo();
  atualizarPecasDisponiveis();
  iniciarContagemRegressiva();
  inicioFaseTimestamp = Date.now();
}

// ====================== PLANILHA (PONTUAÇÃO) ======================
function buildCSVFromScores() {
  return (pontuacoes || []).join(',');
}

async function submitResultsToSheet() {
  if (!currentCPF) return { ok:false, error:'missing_cpf' };
  const csv   = buildCSVFromScores();
  const total = (pontuacoes || []).reduce((a,b)=>a+(+b||0), 0);

  try {
    return await jsonp(WEBAPP, {
      action: 'submit',
      cpf: currentCPF,
      csv,
      total,
      sheet: SHEET_NAME
    });
  } catch (e) {
    return { ok:false, error:String(e) };
  }
}

// ====================== DRIVE (IMAGEM) ======================
function buildDriveFileName() {
  const cpfStr = currentCPF || 'sem_cpf';
  const ts     = new Date().toISOString().replace(/[:.]/g, '-');

  if (currentPatientName && currentPatientName.trim()) {
    const safeName = currentPatientName.trim().replace(/\s+/g, '_');
    return `CuboWAISIII_${safeName}_${cpfStr}_${ts}.png`;
  }

  return `CuboWAISIII_${cpfStr}_${ts}.png`;
}

async function uploadScreenshotToDrive(canvas) {
  if (!DRIVE_UPLOAD_URL) {
    throw new Error('DRIVE_UPLOAD_URL não configurada.');
  }

  const dataUrl = canvas.toDataURL('image/png');

  const body = {
    folderId: DRIVE_FOLDER_ID,
    token: "",
    cpf: currentCPF || "",
    result_id: `MLIVRE_${currentCPF || 'NA'}_${Date.now()}`,
    files: [
      { name: buildDriveFileName(), dataUrl }
    ]
  };

  const res = await fetch(DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Falha Drive: HTTP ${res.status}`);
  }

  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Drive error: ${json.error || "desconhecido"}`);
  }
  return json;
}

// ====================== ENVIO FINAL ======================
async function enviarResultados() {
  if (!currentCPF) {
    alert('CPF não encontrado. Atualize a página e tente novamente.');
    return;
  }

  const btnVerificar = document.getElementById('btnVerificar');
  if (btnVerificar) {
    btnVerificar.disabled = true;
    btnVerificar.textContent = 'Enviando...';
  }
  if (resultado) {
    resultado.textContent = 'Aguarde, finalizando o teste...';
  }

  try {
    const resp = await submitResultsToSheet();
    if (!resp || !resp.ok) {
      throw new Error('Não consegui salvar na planilha.');
    }

    const painel = garantirPainelResumo();
    const canvas = await html2canvas(painel, {
      useCORS: true,
      backgroundColor: '#ffffff',
      scale: 2
    });

    await uploadScreenshotToDrive(canvas);

    window.location.href = 'https://www.integradaneuropsicologia.com.br/jogosdeestimula%C3%A7%C3%A3omental';
  } catch (err) {
    console.error(err);

    if (btnVerificar) {
      btnVerificar.disabled = false;
      btnVerificar.textContent = 'Tentar enviar novamente';
      btnVerificar.onclick = enviarResultados;
    }

    if (resultado) {
      resultado.textContent = '⚠️ Erro ao enviar resultados. Toque em "Tentar enviar novamente".';
    } else {
      alert('⚠️ Erro ao enviar resultados. Tente novamente.');
    }
  }
}

// ====================== CRONÔMETRO ======================
function iniciarContagemRegressiva() {
  const tempoTotal = tempoPorFase[faseAtual];
  tempoRestante = tempoTotal;
  if (cronometroEl) {
    cronometroEl.textContent = `⏳ Tempo: ${tempoRestante}s`;
  }

  cronometroIntervalo = setInterval(() => {
    tempoRestante--;
    if (cronometroEl) {
      cronometroEl.textContent = `⏳ Tempo: ${tempoRestante}s`;
    }

    if (tempoRestante <= 0) {
      clearInterval(cronometroIntervalo);
      resultado.textContent = "⏰ Tempo esgotado!";
      verificar();
    }
  }, 1000);
}

function iniciarFaseDireta() {
  montarReferencia();
  montarAreaLivre();
  atualizarFaseInfo();
  atualizarPecasDisponiveis();
  iniciarContagemRegressiva();
  inicioFaseTimestamp = Date.now();
}

// ====================== TOQUE (MOBILE) ======================
// ====================== TOQUE (MOBILE) ======================
function ativarToqueMobile(peca) {
  let offsetX, offsetY;

  peca.addEventListener('touchstart', function(e) {
    const touch = e.touches[0];
    const rect  = peca.getBoundingClientRect();
    offsetX = touch.clientX - rect.left;
    offsetY = touch.clientY - rect.top;
    peca.style.zIndex = 1000;
  });

  peca.addEventListener('touchmove', function(e) {
    e.preventDefault();
    const touch    = e.touches[0];
    const areaRect = areaLivre.getBoundingClientRect();
    const x        = touch.clientX - areaRect.left - offsetX;
    const y        = touch.clientY - areaRect.top  - offsetY;

    peca.style.position = 'absolute';
    peca.style.left     = x + 'px';
    peca.style.top      = y + 'px';

    // se saiu da área preta, remove (só se estiver dentro da áreaLivre)
    if (removeIfOutsideArea(peca)) {
      peca.style.zIndex = 1;
    }
  });

  peca.addEventListener('touchend', function() {
    // se a peça ainda existir, volta z-index
    if (document.body.contains(peca)) {
      peca.style.zIndex = 1;
    }
  });
}


// ====================== BOTÕES PRINCIPAIS ======================
const btnVerificar = document.getElementById('btnVerificar');
if (btnVerificar) {
  btnVerificar.addEventListener('click', verificar);
}

const btnIniciar = document.getElementById('btnIniciar');
if (btnIniciar) {
  btnIniciar.addEventListener('click', () => {
    startGame();
  });
}
