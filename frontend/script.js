'use strict';

const SERVER_URL     = 'http://localhost:5000';
const FRAME_INTERVAL = 90;
const CANVAS_W       = 480;
const CANVAS_H       = 800;
const ROAD_LEFT      = 80;
const ROAD_RIGHT     = 400;
const ROAD_W         = ROAD_RIGHT - ROAD_LEFT;
const LANES          = [130, 230, 330];
const MAX_SPEED      = 600;
const BASE_SPEED     = 160;
const CAR_W          = 44;
const CAR_H          = 76;
const OBS_W          = 44;
const OBS_H          = 76;

const ScreenManager = (() => {
  const screens = {
    welcome:     document.getElementById('screen-welcome'),
    instructions:document.getElementById('screen-instructions'),
    game:        document.getElementById('screen-game'),
    pause:       document.getElementById('screen-pause'),
    gameover:    document.getElementById('screen-gameover'),
    leaderboard: document.getElementById('screen-leaderboard'),
  };
  let current = 'welcome';

  function show(name) {

    const overlays = ['pause', 'gameover'];
    if (!overlays.includes(name)) {
      Object.values(screens).forEach(s => s.classList.remove('active'));
    } else {

      overlays.forEach(o => { if (o !== name) screens[o].classList.remove('active'); });
    }
    screens[name].classList.add('active');
    current = name;
  }
  function hide(name) { screens[name]?.classList.remove('active'); }
  function get()      { return current; }

  return { show, hide, get };
})();

const AudioEngine = (() => {
  let ctx = null;
  let engineNode = null;
  let engineGain = null;
  let bgMusicNodes = [];
  let muted = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  
  function playClick() {
    if (muted) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.connect(g); g.connect(c.destination);
    osc.frequency.value = 880;
    g.gain.setValueAtTime(0.15, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);
    osc.start(); osc.stop(c.currentTime + 0.09);
  }

  
  function playCrash() {
    if (muted) return;
    const c = getCtx();
    const bufLen = c.sampleRate * 0.6;
    const buf    = c.createBuffer(1, bufLen, c.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1);

    const src  = c.createBufferSource();
    const g    = c.createGain();
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 800;

    src.buffer = buf;
    src.connect(filt); filt.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(0.6, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.6);
    src.start();

    const osc = c.createOscillator();
    const og  = c.createGain();
    osc.connect(og); og.connect(c.destination);
    osc.frequency.setValueAtTime(80, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, c.currentTime + 0.4);
    og.gain.setValueAtTime(0.5, c.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
    osc.start(); osc.stop(c.currentTime + 0.45);
  }

  
  function startEngine() {
    if (muted || engineNode) return;
    const c = getCtx();
    engineNode = c.createOscillator();
    engineGain = c.createGain();
    const distortion = c.createWaveShaper();

    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 256 - 1;
      curve[i] = (Math.PI + 300) * x / (Math.PI + 300 * Math.abs(x));
    }
    distortion.curve = curve;

    engineNode.type = 'sawtooth';
    engineNode.frequency.value = 55;
    engineNode.connect(distortion);
    distortion.connect(engineGain);
    engineGain.connect(c.destination);
    engineGain.gain.value = 0.04;
    engineNode.start();
  }

  function setEngineSpeed(speedNorm) {
    if (!engineNode) return;
    const c = getCtx();
    const freq = 55 + speedNorm * 180;
    engineNode.frequency.setTargetAtTime(freq, c.currentTime, 0.1);
    engineGain.gain.setTargetAtTime(muted ? 0 : 0.04 + speedNorm * 0.04, c.currentTime, 0.1);
  }

  function stopEngine() {
    if (engineNode) { try { engineNode.stop(); } catch(e) {} engineNode = null; }
  }

  
  function startMusic() {
    if (muted) return;
    const c    = getCtx();
    const notes = [110, 138.6, 164.8, 220, 246.9, 220, 164.8, 138.6];
    const dur   = 0.18;
    let t = c.currentTime + 0.1;

    function scheduleLoop() {
      notes.forEach((freq, i) => {
        const osc = c.createOscillator();
        const g   = c.createGain();
        osc.connect(g); g.connect(c.destination);
        osc.type = 'triangle';
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0, t + i * dur);
        g.gain.linearRampToValueAtTime(0.05, t + i * dur + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * dur + dur * 0.9);
        osc.start(t + i * dur);
        osc.stop(t + i * dur + dur);
        bgMusicNodes.push(osc);
      });
      t += notes.length * dur;

      bgTimer = setTimeout(scheduleLoop, (notes.length * dur - 0.5) * 1000);
    }
    scheduleLoop();
  }

  let bgTimer = null;
  function stopMusic() {
    clearTimeout(bgTimer);
    bgMusicNodes.forEach(n => { try { n.stop(); } catch(e) {} });
    bgMusicNodes = [];
  }

  function toggleMute() {
    muted = !muted;
    if (engineGain) engineGain.gain.value = muted ? 0 : 0.04;
    return muted;
  }

  return { playClick, playCrash, startEngine, stopEngine, setEngineSpeed, startMusic, stopMusic, toggleMute };
})();

const GestureClient = (() => {
  let socket       = null;
  let videoEl      = null;
  let captureCanvas= null;
  let overlayCanvas= null;
  let frameTimer   = null;
  let connected    = false;
  let camReady     = false;

  const state = {
    steering:     0,
    action:       'none',
    handDetected: false,
    palmX:        0.5,
    palmY:        0.5,
  };

  function init() {
    videoEl       = document.getElementById('webcam-video');
    captureCanvas = document.getElementById('capture-canvas');
    overlayCanvas = document.getElementById('webcam-overlay');

    _connectSocket();
    _startWebcam();
    _updateGestureUI();
  }

  function _connectSocket() {
    socket = io(SERVER_URL, { transports: ['websocket'], reconnectionAttempts: 5 });
    socket.on('connect',      () => { connected = true;  _setCamStatus('Connected ✓'); });
    socket.on('disconnect',   () => { connected = false; _setCamStatus('Disconnected'); });
    socket.on('connect_error',() => { _setCamStatus('Server offline – using keyboard'); });
    socket.on('server_ready', d  => console.log('[Socket] Server ready:', d.message));
    socket.on('gesture_data', _onGestureData);
  }

  function _onGestureData(data) {
    state.steering     = data.steering     ?? 0;
    state.action       = data.action       ?? 'none';
    state.handDetected = data.hand_detected ?? false;
    state.palmX        = data.palm_x       ?? 0.5;
    state.palmY        = data.palm_y       ?? 0.5;
    _updateGestureUI();
    _drawOverlay();
  }

  async function _startWebcam() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: false,
      });
      videoEl.srcObject = stream;
      videoEl.onloadedmetadata = () => {
        camReady = true;
        _setCamStatus('Camera active');
        captureCanvas.width  = 320;
        captureCanvas.height = 240;
        _startFrameLoop();
      };
    } catch (err) {
      console.warn('[Webcam] Error:', err.message);
      _setCamStatus('No camera – keyboard only');
    }
  }

  function _startFrameLoop() {
    clearInterval(frameTimer);
    frameTimer = setInterval(_sendFrame, FRAME_INTERVAL);
  }

  function _sendFrame() {
    if (!camReady || !connected || !videoEl.readyState) return;
    const ctx = captureCanvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, 320, 240);
    const b64 = captureCanvas.toDataURL('image/jpeg', 0.6).split(',')[1];
    socket.emit('process_frame', { image: b64, timestamp: Date.now() });
  }

  function _updateGestureUI() {
    const dot   = document.getElementById('gesture-indicator');
    const label = document.getElementById('gesture-label');
    if (!dot || !label) return;

    if (!state.handDetected) {
      dot.className   = 'gesture-dot';
      label.textContent = 'No hand detected';
      return;
    }
    if (state.action === 'brake') {
      dot.className   = 'gesture-dot braking';
      label.textContent = '✊ BRAKING';
    } else if (state.action === 'accelerate') {
      dot.className   = 'gesture-dot active';
      label.textContent = '🖐 BOOST!';
    } else {
      const dir = state.steering < -0.1 ? '← LEFT'
                : state.steering >  0.1 ? 'RIGHT →' : '↑ CENTER';
      dot.className   = 'gesture-dot active';
      label.textContent = dir;
    }
  }

  function _drawOverlay() {
    const cvs = overlayCanvas;
    if (!cvs) return;
    cvs.width  = cvs.offsetWidth;
    cvs.height = cvs.offsetHeight;
    const ctx  = cvs.getContext('2d');
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    if (!state.handDetected) return;

    const px = state.palmX * cvs.width;
    const py = state.palmY * cvs.height;
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(px - 16, py); ctx.lineTo(px + 16, py);
    ctx.moveTo(px, py - 16); ctx.lineTo(px, py + 16);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function _setCamStatus(msg) {
    const el = document.getElementById('cam-status');
    if (el) el.textContent = msg;
  }

  function stop() {
    clearInterval(frameTimer);
    if (videoEl?.srcObject) videoEl.srcObject.getTracks().forEach(t => t.stop());
  }

  return { init, stop, state };
})();

const GameState = (() => {
  let score      = 0;
  let highScore  = parseInt(localStorage.getItem('grg_highscore') || '0', 10);
  let speed      = BASE_SPEED;
  let level      = 1;
  let paused     = false;
  let gameOver   = false;
  let startTime  = 0;
  let lastDiffUp = 0;

  function reset() {
    score = 0; speed = BASE_SPEED; level = 1;
    paused = false; gameOver = false;
    startTime = performance.now(); lastDiffUp = startTime;
  }
  function addScore(n) {
    score += n;
    if (score > highScore) { highScore = score; localStorage.setItem('grg_highscore', highScore); }
  }
  function tick(now) {

    if (now - lastDiffUp > 25000) {
      speed = Math.min(MAX_SPEED, speed * 1.18);
      level++;
      lastDiffUp = now;
    }
  }

  return {
    get score()     { return score; },
    get highScore() { return highScore; },
    get speed()     { return speed; },
    get level()     { return level; },
    get paused()    { return paused; },
    set paused(v)   { paused = v; },
    get gameOver()  { return gameOver; },
    set gameOver(v) { gameOver = v; },
    reset, addScore, tick,
    speedNorm: () => (speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED),
  };
})();

const Renderer = (() => {
  let canvas, ctx, scaleX, scaleY;

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    scaleX = canvas.width  / CANVAS_W;
    scaleY = canvas.height / CANVAS_H;
  }

  function clear() {
    ctx.fillStyle = '#060612';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  
  function sx(x) { return x * scaleX; }
  function sy(y) { return y * scaleY; }
  function sw(w) { return w * scaleX; }
  function sh(h) { return h * scaleY; }

  
  function drawRoad(roadOffset) {

    ctx.fillStyle = '#111128';
    ctx.fillRect(sx(ROAD_LEFT), 0, sw(ROAD_W), canvas.height);

    const drawBarrier = (x) => {
      ctx.shadowBlur  = 10;
      ctx.shadowColor = '#00f5ff';
      ctx.fillStyle   = '#00f5ff';
      ctx.fillRect(sx(x) - sw(3), 0, sw(6), canvas.height);
      ctx.shadowBlur = 0;
    };
    drawBarrier(ROAD_LEFT); drawBarrier(ROAD_RIGHT);

    ctx.setLineDash([sh(40), sh(30)]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = sw(2);
    [190, 290].forEach(laneX => {
      ctx.beginPath();

      for (let y = -(sh(80) - (roadOffset % sh(80))); y < canvas.height + sh(80); y += sh(80)) {
        ctx.moveTo(sx(laneX), y);
        ctx.lineTo(sx(laneX), y + sh(40));
      }
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  
  function drawPlayerCar(x, y, shake) {
    const cx  = sx(x) + (shake ? (Math.random() - 0.5) * 8 : 0);
    const cy  = sy(y);
    const cw  = sw(CAR_W);
    const ch  = sh(CAR_H);
    ctx.save();
    ctx.translate(cx + cw / 2, cy + ch / 2);

    ctx.shadowBlur  = 20;
    ctx.shadowColor = '#00f5ff';

    ctx.fillStyle = '#0a2fff';
    _roundRect(ctx, -cw/2, -ch/2, cw, ch, sw(8));
    ctx.fill();

    ctx.fillStyle = '#00f5ff';
    ctx.shadowColor = '#00f5ff';
    ctx.shadowBlur  = 8;
    _roundRect(ctx, -cw*0.25, -ch*0.15, cw*0.5, ch*0.3, sw(4));
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle  = '#222';
    [[-cw*0.55, -ch*0.35], [cw*0.55-sw(8), -ch*0.35],
     [-cw*0.55, ch*0.15],  [cw*0.55-sw(8), ch*0.15]].forEach(([wx,wy]) => {
      ctx.fillRect(wx, wy, sw(8), sh(16));
    });

    ctx.fillStyle   = '#ffffaa';
    ctx.shadowColor = '#ffffaa';
    ctx.shadowBlur  = 10;
    [[-cw*0.3, -ch*0.5+sh(4)], [cw*0.3-sw(8), -ch*0.5+sh(4)]].forEach(([hx,hy]) => {
      ctx.fillRect(hx, hy, sw(8), sh(6));
    });
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  
  function drawObstacleCar(x, y, colorIdx) {
    const colours = ['#ff2244', '#ff8800', '#aa00ff', '#ff00aa'];
    const glows   = ['#ff2244', '#ff8800', '#aa00ff', '#ff00aa'];
    const col  = colours[colorIdx % colours.length];
    const glow = glows[colorIdx % glows.length];

    const cx = sx(x);
    const cy = sy(y);
    const cw = sw(OBS_W);
    const ch = sh(OBS_H);
    ctx.save();
    ctx.translate(cx + cw/2, cy + ch/2);
    ctx.shadowBlur  = 16;
    ctx.shadowColor = glow;

    ctx.fillStyle = col;
    _roundRect(ctx, -cw/2, -ch/2, cw, ch, sw(8));
    ctx.fill();

    ctx.fillStyle   = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur  = 0;
    _roundRect(ctx, -cw*0.25, ch*0.05 - ch*0.25, cw*0.5, ch*0.3, sw(4));
    ctx.fill();

    ctx.fillStyle = '#111';
    [[-cw*0.55, -ch*0.35], [cw*0.55-sw(8), -ch*0.35],
     [-cw*0.55, ch*0.15],  [cw*0.55-sw(8), ch*0.15]].forEach(([wx,wy]) => {
      ctx.fillRect(wx, wy, sw(8), sh(16));
    });

    ctx.fillStyle   = '#ff4444';
    ctx.shadowColor = '#ff4444';
    ctx.shadowBlur  = 8;
    [[-cw*0.3, ch*0.5-sh(10)], [cw*0.3-sw(8), ch*0.5-sh(10)]].forEach(([tx,ty]) => {
      ctx.fillRect(tx, ty, sw(8), sh(6));
    });
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  
  function drawParticles(particles) {
    particles.forEach(p => {
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.shadowBlur  = 12;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), sw(p.r), 0, Math.PI*2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
  }

  
  function updateHUD(score, highScore, level, fps, speedNorm) {
    const kmh = Math.round(80 + speedNorm * 220);

    _setText('hud-score', score);
    _setText('hud-best',  highScore);
    _setText('hud-level', level);
    _setText('hud-fps',   fps);
    _setText('speedo-num', kmh);

    const arc = speedNorm * 220;
    const el  = document.getElementById('speedo-arc');
    if (el) el.setAttribute('stroke-dasharray', `${arc} 251.2`);
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  
  function drawSteeringBar(steering) {
    const barW = sw(120);
    const barH = sh(8);
    const bx   = canvas.width/2 - barW/2;
    const by   = canvas.height - sh(20);

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    _roundRect(ctx, bx, by, barW, barH, sh(4));
    ctx.fill();

    const fillW = barW/2 * Math.abs(steering);
    const fillX = steering < 0 ? canvas.width/2 - fillW : canvas.width/2;
    ctx.fillStyle   = steering < 0 ? '#ff006e' : '#00f5ff';
    ctx.shadowBlur  = 8;
    ctx.shadowColor = ctx.fillStyle;
    _roundRect(ctx, fillX, by, fillW, barH, sh(4));
    ctx.fill();
    ctx.shadowBlur  = 0;

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(canvas.width/2 - sw(1), by - sh(2), sw(2), barH + sh(4));
  }

  
  function drawNoHandWarning(alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = 'rgba(255,200,0,0.15)';
    ctx.fillRect(sx(ROAD_LEFT), 0, sw(ROAD_W), canvas.height);
    ctx.globalAlpha = 1;
  }

  
  function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
  }

  return {
    init, resize, clear, sx, sy, sw, sh,
    drawRoad, drawPlayerCar, drawObstacleCar,
    drawParticles, updateHUD, drawSteeringBar, drawNoHandWarning,
  };
})();

const GameEngine = (() => {
  let rafId        = null;
  let lastTime     = 0;
  let fpsSmooth    = 60;
  let roadOffset   = 0;

  const player = { x: CANVAS_W / 2 - CAR_W / 2, y: CANVAS_H - 130, vx: 0 };

  let obstacles     = [];
  let spawnTimer    = 0;
  let spawnInterval = 1.8;

  let particles = [];

  const keys = { left: false, right: false, up: false, down: false };

  let shakeTimer  = 0;
  let noHandAlpha = 0;

  
  function start() {
    GameState.reset();
    obstacles     = [];
    particles     = [];
    spawnTimer    = 0;
    spawnInterval = 1.8;
    roadOffset    = 0;
    player.x      = CANVAS_W / 2 - CAR_W / 2;
    player.vx     = 0;
    lastTime      = performance.now();
    AudioEngine.startEngine();
    AudioEngine.startMusic();
    _loop(performance.now());
  }

  
  function stop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    AudioEngine.stopEngine();
    AudioEngine.stopMusic();
  }

  
  function _loop(now) {
    rafId = requestAnimationFrame(_loop);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    fpsSmooth = fpsSmooth * 0.9 + (1 / dt) * 0.1;

    if (!GameState.paused && !GameState.gameOver) {
      _update(dt, now);
    }
    _render();
  }

  
  function _update(dt, now) {
    GameState.tick(now);
    const speed = GameState.speed;

    let steering       = GestureClient.state.steering;
    let action         = GestureClient.state.action;
    const handDetected = GestureClient.state.handDetected;

    if (keys.left)  steering = Math.max(steering - 0.06, -1);
    if (keys.right) steering = Math.min(steering + 0.06,  1);
    if (keys.up)    action   = 'accelerate';
    if (keys.down)  action   = 'brake';

    noHandAlpha = handDetected
      ? Math.max(0, noHandAlpha - dt * 3)
      : Math.min(0.4, noHandAlpha + dt * 2);

    let speedMult = 1.0;
    if (action === 'accelerate') speedMult = 1.35;
    if (action === 'brake')      speedMult = 0.45;

    const effectiveSpeed = speed * speedMult;

    player.vx = steering * 320;
    player.x += player.vx * dt;
    player.x  = Math.max(ROAD_LEFT + 4, Math.min(ROAD_RIGHT - CAR_W - 4, player.x));

    roadOffset = (roadOffset + effectiveSpeed * dt) % CANVAS_H;

    spawnTimer    += dt;
    spawnInterval  = Math.max(0.65, 1.8 - GameState.level * 0.08);
    if (spawnTimer >= spawnInterval) {
      spawnTimer = 0;
      _spawnObstacle();
    }

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obs = obstacles[i];
      obs.y += effectiveSpeed * dt;

      const dx = Math.abs((player.x + CAR_W / 2) - (obs.x + OBS_W / 2));
      const dy = Math.abs((player.y + CAR_H / 2) - (obs.y + OBS_H / 2));
      if (dy < CAR_H * 1.5 && dy > CAR_H * 0.65 && dx < CAR_W * 1.6) {
        GameState.addScore(2);
      }

      if (obs.y > CANVAS_H + OBS_H) { obstacles.splice(i, 1); continue; }

      if (_collides(player, obs)) {
        _triggerCrash();
        return;
      }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x   += p.vx * dt;
      p.y   += p.vy * dt;
      p.vy  += 160 * dt;
      p.life -= dt * 1.8;
      p.r    = Math.max(0, p.r - dt * 3);
      if (p.life <= 0) { particles.splice(i, 1); }
    }

    GameState.addScore(1);

    if (shakeTimer > 0) shakeTimer -= dt;

    AudioEngine.setEngineSpeed(GameState.speedNorm() * speedMult);
  }

  
  function _spawnObstacle() {
    const laneIdx = Math.floor(Math.random() * LANES.length);
    obstacles.push({
      x: LANES[laneIdx] - OBS_W / 2,
      y: -OBS_H - 10,
      colorIdx: Math.floor(Math.random() * 4),
    });
  }

  
  function _collides(a, b) {
    const m = 7;
    return (
      a.x + m         < b.x + OBS_W - m &&
      a.x + CAR_W - m > b.x + m &&
      a.y + m         < b.y + OBS_H - m &&
      a.y + CAR_H - m > b.y + m
    );
  }

  
  function _triggerCrash() {
    GameState.gameOver = true;
    AudioEngine.playCrash();
    AudioEngine.stopEngine();
    AudioEngine.stopMusic();
    shakeTimer = 0.7;
    _spawnExplosion(player.x + CAR_W / 2, player.y + CAR_H / 2);

    setTimeout(() => {
      stop();
      document.getElementById('go-score').textContent = GameState.score;
      document.getElementById('go-best').textContent  = GameState.highScore;
      document.getElementById('btn-save-score').textContent = '💾 SAVE SCORE';
      document.getElementById('btn-save-score').disabled    = false;
      document.getElementById('player-name').value         = '';
      ScreenManager.show('gameover');
    }, 950);
  }

  
  function _spawnExplosion(cx, cy) {
    const colors = ['#ff4400', '#ff8800', '#ffdd00', '#ffffff', '#ff006e'];
    for (let i = 0; i < 45; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = 60 + Math.random() * 220;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 90,
        r:   2 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0.7 + Math.random() * 0.7,
      });
    }
  }

  
  function _render() {
    Renderer.clear();
    Renderer.drawRoad(roadOffset);

    if (noHandAlpha > 0) Renderer.drawNoHandWarning(noHandAlpha);

    obstacles.filter(o => o.y < player.y).forEach(o =>
      Renderer.drawObstacleCar(o.x, o.y, o.colorIdx));

    Renderer.drawPlayerCar(player.x, player.y, shakeTimer > 0);

    obstacles.filter(o => o.y >= player.y).forEach(o =>
      Renderer.drawObstacleCar(o.x, o.y, o.colorIdx));

    Renderer.drawParticles(particles);
    Renderer.drawSteeringBar(GestureClient.state.steering);
    Renderer.updateHUD(
      GameState.score, GameState.highScore,
      GameState.level, Math.round(fpsSmooth), GameState.speedNorm()
    );
  }

  
  function _togglePause() {
    GameState.paused = !GameState.paused;
    if (GameState.paused) {
      document.getElementById('pause-score').textContent = GameState.score;
      document.getElementById('pause-speed').textContent =
        Math.round(80 + GameState.speedNorm() * 220) + ' km/h';
      document.getElementById('pause-level').textContent = GameState.level;
      ScreenManager.show('pause');
    } else {
      lastTime = performance.now();
      ScreenManager.hide('pause');
    }
  }

  
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')                         keys.left  = true;
    if (e.key === 'ArrowRight')                        keys.right = true;
    if (e.key === 'ArrowUp')                           keys.up    = true;
    if (e.key === 'ArrowDown')                         keys.down  = true;
    if ((e.key === 'Escape' || e.key === 'p') &&
        ScreenManager.get() === 'game' && !GameState.gameOver) {
      _togglePause();
    }
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft')  keys.left  = false;
    if (e.key === 'ArrowRight') keys.right = false;
    if (e.key === 'ArrowUp')    keys.up    = false;
    if (e.key === 'ArrowDown')  keys.down  = false;
  });

  return { start, stop, togglePause: _togglePause };
})();

async function fetchLeaderboard() {
  const tbody = document.getElementById('lb-body');
  tbody.innerHTML = '<tr><td colspan="4" class="lb-loading">Loading...</td></tr>';
  try {
    const res  = await fetch(`${SERVER_URL}/api/leaderboard`);
    const data = await res.json();
    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="lb-loading">No scores yet — be the first! 🏎️</td></tr>';
      return;
    }
    tbody.innerHTML = data.map((e, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${_esc(e.name)}</td>
        <td>${Number(e.score).toLocaleString()}</td>
        <td>${e.date}</td>
      </tr>`).join('');
  } catch {
    tbody.innerHTML = '<tr><td colspan="4" class="lb-loading">Server offline — scores unavailable</td></tr>';
  }
}

async function saveScore(name, score) {
  try {
    await fetch(`${SERVER_URL}/api/save_score`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, score }),
    });
  } catch {  }
}

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

(function initApp() {

  Renderer.init(document.getElementById('game-canvas'));

  GestureClient.init();

  
  document.getElementById('btn-play').addEventListener('click', () => {
    AudioEngine.playClick();
    ScreenManager.show('game');
    GameEngine.start();
  });
  document.getElementById('btn-instructions').addEventListener('click', () => {
    AudioEngine.playClick();
    ScreenManager.show('instructions');
  });
  document.getElementById('btn-leaderboard').addEventListener('click', () => {
    AudioEngine.playClick();
    fetchLeaderboard();
    ScreenManager.show('leaderboard');
  });

  
  document.getElementById('btn-start-game').addEventListener('click', () => {
    AudioEngine.playClick();
    ScreenManager.show('game');
    GameEngine.start();
  });
  document.getElementById('btn-back-welcome').addEventListener('click', () => {
    AudioEngine.playClick();
    ScreenManager.show('welcome');
  });

  
  document.getElementById('btn-pause').addEventListener('click', () => {
    AudioEngine.playClick();
    if (!GameState.gameOver) GameEngine.togglePause();
  });
  document.getElementById('btn-toggle-cam').addEventListener('click', () => {
    document.getElementById('webcam-panel').classList.toggle('collapsed');
  });

  
  document.getElementById('btn-resume').addEventListener('click', () => {
    AudioEngine.playClick();
    GameEngine.togglePause();
  });
  document.getElementById('btn-quit').addEventListener('click', () => {
    AudioEngine.playClick();
    GameEngine.stop();
    ScreenManager.hide('pause');
    ScreenManager.show('welcome');
  });

  
  document.getElementById('btn-play-again').addEventListener('click', () => {
    AudioEngine.playClick();
    ScreenManager.hide('gameover');
    ScreenManager.show('game');
    GameEngine.start();
  });
  document.getElementById('btn-go-menu').addEventListener('click', () => {
    AudioEngine.playClick();
    ScreenManager.hide('gameover');
    ScreenManager.show('welcome');
  });
  document.getElementById('btn-save-score').addEventListener('click', async () => {
    AudioEngine.playClick();
    const name  = document.getElementById('player-name').value.trim() || 'Anonymous';
    await saveScore(name, GameState.score);
    document.getElementById('btn-save-score').textContent = '✅ Saved!';
    document.getElementById('btn-save-score').disabled    = true;
  });

  
  document.getElementById('btn-lb-back').addEventListener('click', () => {
    AudioEngine.playClick();
    ScreenManager.show('welcome');
  });

  
  ScreenManager.show('welcome');
})();