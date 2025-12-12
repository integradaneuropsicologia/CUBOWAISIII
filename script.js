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

let inicioFaseTimestamp      = null;
let inicioTentativaTimestamp = null;

let faseAtual           = 0;
let dragOffset          = { x: 0, y: 0 };
let tentativaAtual      = 0; // mantém como contador de erros (como já estava)
let tentativaNumeroNaFase = 1; // ✅ número da tentativa (1, 2, ...)
let resultadosFases     = [];
let tempoRestante       = 0;
let cronometroIntervalo = null;
let painelResumo        = null;
let temposFases         = [];

// Registra, por fase, o status (ok/fail/timeout), tentativas e tempo.
function registrarResultadoDaFase(faseIndex, status, tentativasFalhas, tempoGastoSegundos) {
  if (!Array.isArray(resultadosFases)) resultadosFases = [];
  resultadosFases[faseIndex] = {
    status: String(status || ''),
    tentativas: Number(tentativasFalhas || 0),
    tempo: Number(tempoGastoSegundos || 0)
  };
}

function ultimasDuasFases(index = faseAtual) {
  return index >= (fases.length - 2);
}

function adicionarBotaoGiro(pecaEl) {
  // evita duplicar botão
  if (pecaEl.querySelector('span')) return;

  const botao = document.createElement('span');
  botao.textContent = '🔄';

  // estilo inline (pra funcionar em qualquer peça, sem depender do CSS da .dividida)
  botao.style.position = 'absolute';
  botao.style.top = '50%';
  botao.style.left = '50%';
  botao.style.transform = 'translate(-50%, -50%)';
  botao.style.width = '26px';
  botao.style.height = '26px';
  botao.style.borderRadius = '999px';
  botao.style.background = 'rgba(0,0,0,0.10)';
  botao.style.color = 'rgba(255,255,255,0.6)';
  botao.style.display = 'flex';
  botao.style.alignItems = 'center';
  botao.style.justifyContent = 'center';
  botao.style.fontSize = '1rem';
  botao.style.cursor = 'pointer';
  botao.style.pointerEvents = 'auto';
  botao.style.zIndex = '2';

  // impede que o botão dispare arraste
  botao.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); });
  botao.addEventListener('touchstart', e => { e.stopPropagation(); });

  botao.onclick = function (e) {
    e.stopPropagation();
    let anguloAtual = parseInt(pecaEl.getAttribute('data-rot') || 0);
    let novoAngulo = (anguloAtual + 45) % 360;
    pecaEl.style.transform = `rotate(${novoAngulo}deg)`;
    pecaEl.setAttribute('data-rot', novoAngulo);
  };

  pecaEl.appendChild(botao);
}



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
  titulo.textContent = 'Montagem Livre - Resumo (Fases e Tentativas)';
  titulo.style.margin = '0 0 16px 0';
  painelResumo.appendChild(titulo);

  document.body.appendChild(painelResumo);
  return painelResumo;
}

function criarCardSnapshotRotulado(labelTexto) {
  const painel = garantirPainelResumo();

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
  info.style.fontWeight = '700';
  info.textContent      = labelTexto;
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

  return card;
}

// ✅ snapshot final da fase (já existia)
function registrarFaseSnapshot(faseIndex, tempoGastoSegundos, statusFase = '') {
  const faseNumero = faseIndex + 1;
  const tempoFmt   = formatarTempoSegundos(tempoGastoSegundos || 0);
  const statusTxt  = statusFase ? ` — ${String(statusFase).toUpperCase()}` : '';

  criarCardSnapshotRotulado(`Fase ${faseNumero} — Final${statusTxt} — Tempo fase: ${tempoFmt}`);

  temposFases[faseIndex] = tempoGastoSegundos || 0;
}

// ✅ snapshot da tentativa (nova)
function registrarTentativaSnapshot(faseIndex, tentativaNumero, tipo, tempoTentativaSeg, tempoFaseSeg) {
  const faseNumero = faseIndex + 1;
  const tTent = formatarTempoSegundos(tempoTentativaSeg || 0);
  const tFase = formatarTempoSegundos(tempoFaseSeg || 0);

  const tipoTxt = String(tipo || '').toUpperCase(); // ERRO / ACERTO / ERRO_FINAL
  criarCardSnapshotRotulado(`Fase ${faseNumero} — Tentativa ${tentativaNumero} — ${tipoTxt} — Tempo tentativa: ${tTent} (fase: ${tFase})`);
}


// ====================== REGRAS DE TEMPO ======================
// (Bloco removido)

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

    if (tipo === 'dividida' || ultimasDuasFases()) {
  adicionarBotaoGiro(novaPeca);
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

  const agora = Date.now();
  const tempoGastoFase = inicioFaseTimestamp
    ? Math.floor((agora - inicioFaseTimestamp) / 1000)
    : 0;

  const tempoGastoTentativa = inicioTentativaTimestamp
    ? Math.floor((agora - inicioTentativaTimestamp) / 1000)
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

  const temTentativasNaFase = (faseAtual < 6);
  const maxTentativas = tentativasPorFase[faseAtual] || 1;
  const podeTentarDeNovo = temTentativasNaFase && (tentativaNumeroNaFase < maxTentativas);

  if (correto) {
    // ✅ Se acertou numa tentativa >1, registra a imagem da tentativa (pra ficar "Fase X - Tentativa Y")
    if (temTentativasNaFase && tentativaNumeroNaFase > 1) {
      registrarTentativaSnapshot(faseAtual, tentativaNumeroNaFase, 'acerto', tempoGastoTentativa, tempoGastoFase);
    }

    const tentativasFalhas = tentativaAtual; // mantém como estava
    resultado.textContent  = "";
    tentativaAtual         = 0;
    proximaFase(tempoGastoFase, 'ok', tentativasFalhas);
  } else {
    tentativaAtual++;

    if (podeTentarDeNovo) {
      // ❌ Errou, mas ainda tem tentativa => registra a imagem da tentativa
      registrarTentativaSnapshot(faseAtual, tentativaNumeroNaFase, 'erro', tempoGastoTentativa, tempoGastoFase);

      resultado.textContent = "❌ Tente novamente.";
      clearInterval(cronometroIntervalo);

      // próxima tentativa
      tentativaNumeroNaFase += 1;

      iniciarContagemRegressiva();
    } else {
      // ❌ Errou e acabou tentativa => registra a imagem dessa última tentativa também
      if (temTentativasNaFase) {
        registrarTentativaSnapshot(faseAtual, tentativaNumeroNaFase, 'erro_final', tempoGastoTentativa, tempoGastoFase);
      }

      const tentativasFalhas = tentativaAtual;
      tentativaAtual        = 0;
      resultado.textContent = "";
      proximaFase(tempoGastoFase, 'fail', tentativasFalhas);
    }
  }
}


// ====================== PRÓXIMA FASE / FINAL ======================
function proximaFase(tempoGastoSegundos = 0, statusFase = 'next', tentativasFalhas = 0) {
  clearInterval(cronometroIntervalo);

  // guarda a imagem da fase atual (montagem + tempo)
  registrarFaseSnapshot(faseAtual, tempoGastoSegundos, statusFase);

  // registra o resultado
  registrarResultadoDaFase(faseAtual, statusFase, tentativasFalhas, tempoGastoSegundos);

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

  // reseta tentativa e inicia fase nova
  resultado.textContent = '';
  tentativaAtual = 0;
  tentativaNumeroNaFase = 1;
  inicioTentativaTimestamp = null;

  iniciarFaseDireta();
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
  resultadosFases = Array(fases.length).fill(null);
  tentativaAtual = 0;
  tentativaNumeroNaFase = 1;
  temposFases    = [];

  inicioFaseTimestamp = Date.now();
  inicioTentativaTimestamp = null;

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
}

// ====================== PLANILHA (RESULTADOS) ======================
// Envia para a planilha um CSV com: STATUS:TENTATIVAS:SEGUNDOS (por fase)
// Ex.: OK:0:28,FAIL:2:60,TIMEOUT:0:120,...
function buildCSVFromResults() {
  return (resultadosFases || []).map(r => {
    if (!r) return '';
    const status = String(r.status || '').toUpperCase();
    const tent   = Number(r.tentativas || 0);
    const tempo  = Number(r.tempo || 0);
    return `${status}:${tent}:${tempo}`;
  }).join(',');
}

function calcularTempoTotal() {
  return (temposFases || []).reduce((a, b) => a + (+b || 0), 0);
}

async function submitResultsToSheet() {
  if (!currentCPF) return { ok:false, error:'missing_cpf' };

  const csv        = buildCSVFromResults();
  const tempoTotal = calcularTempoTotal();

  try {
    return await jsonp(WEBAPP, {
      action: 'submit',
      cpf: currentCPF,
      csv,
      total: tempoTotal,
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
    return `MontagemLivre_${safeName}_${cpfStr}_${ts}.png`;
  }

  return `MontagemLivre_${cpfStr}_${ts}.png`;
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
  // ✅ sempre que começar a contagem, é o início da tentativa atual
  inicioTentativaTimestamp = Date.now();

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

      const tempoFase = inicioFaseTimestamp ? Math.floor((Date.now() - inicioFaseTimestamp) / 1000) : tempoTotal;
      proximaFase(tempoFase, 'timeout', tentativaAtual);
    }
  }, 1000);
}

function iniciarFaseDireta() {
  montarReferencia();
  montarAreaLivre();
  atualizarFaseInfo();
  atualizarPecasDisponiveis();

  tentativaNumeroNaFase = 1;
  tentativaAtual = 0;

  inicioFaseTimestamp = Date.now();
  inicioTentativaTimestamp = null;

  iniciarContagemRegressiva();
}

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
