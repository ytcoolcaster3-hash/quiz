const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error("The hosting provider must set a valid PORT environment variable.");
}
const DEFAULT_DURATION_SECONDS = 30;
const MIN_DURATION_SECONDS = 5;
const MAX_DURATION_SECONDS = 300;
const MAX_PLAYERS = 40;
const MAX_QUESTIONS = 50;
const MAX_QUIZZES = 50;
// Leerzeichen und Zeilenumbrüche am Rand (z. B. beim Einfügen in ein Secret-Feld) werden ignoriert.
const ENV_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").trim();
const ENV_ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_EMAIL = ENV_ADMIN_EMAIL || "leon.batzel";
const ADMIN_PASSWORD = ENV_ADMIN_PASSWORD || "1121";

// Ablauf einer Frage: Countdown -> Frage -> Auflösung -> Zwischenstand -> nächste Frage
const COUNTDOWN_MS = 3_000;
const REVEAL_MS = 6_000;
const SCOREBOARD_MS = 5_000;
const BASE_POINTS = 1000;
const STREAK_BONUS = 100;
const MAX_STREAK_BONUS = 500;
const POINT_MODES = ["standard", "double", "none"];

// Sponsor und Anlass – lassen sich beim Hosting über Umgebungsvariablen ändern.
const SPONSOR_NAME = process.env.SPONSOR_NAME || "ITB Projekt";
const SPONSOR_URL = /^https?:\/\//i.test(process.env.SPONSOR_URL || "") ? process.env.SPONSOR_URL : "";
const EVENT_BADGE = process.env.EVENT_BADGE ?? "70. Geburtstag";

const AVATARS = [
  "🦊", "🐼", "🐸", "🦁", "🐯", "🐨", "🐵", "🦄", "🐙", "🐳", "🦖", "🐝",
  "🦉", "🐧", "🐰", "🐱", "🐶", "🐻", "🐲", "👾", "🤖", "👻", "🚀", "🌈",
];

const PUBLIC_DIR = path.join(__dirname, "public");
// Hier werden die Quizze und die hochgeladenen Bilder gespeichert.
// Mit DATA_DIR kann ein dauerhafter Speicherort des Hostings angegeben werden.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const QUIZZES_FILE = path.join(DATA_DIR, "quizzes.json");
const OLD_QUESTIONS_FILE = path.join(DATA_DIR, "questions.json");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_URL_PATTERN = /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/;
const DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/;
const CODE_PATTERN = /^[A-Z0-9]{3,10}$/;
// Ohne leicht verwechselbare Zeichen (0/O, 1/I)
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/* ---------- Fragen und Quizze: prüfen, laden, speichern ---------- */

function validateQuestions(list) {
  const fail = (error) => ({ ok: false, error });
  if (!Array.isArray(list)) return fail("Ungültige Fragenliste.");
  if (list.length > MAX_QUESTIONS) return fail("Es sind maximal " + MAX_QUESTIONS + " Fragen pro Quiz möglich.");

  const questions = [];
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] && typeof list[i] === "object" ? list[i] : {};
    const label = "Frage " + (i + 1) + ": ";

    const text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) return fail(label + "Der Fragetext fehlt.");
    if (text.length > 400) return fail(label + "Der Fragetext ist zu lang (maximal 400 Zeichen).");

    const options = Array.isArray(item.options)
      ? item.options.map((option) => (typeof option === "string" ? option.trim() : ""))
      : [];
    if (options.length < 1 || options.length > 4) return fail(label + "Es braucht 1 bis 4 Antworten.");
    if (options.some((option) => !option)) return fail(label + "Eine Antwort ist noch leer.");
    if (options.some((option) => option.length > 200)) return fail(label + "Eine Antwort ist zu lang (maximal 200 Zeichen).");

    // Neues Format: correctIndices (mehrere richtige Antworten). Altes Format: correctIndex.
    let correctIndices = item.correctIndices;
    if (correctIndices === undefined && Number.isInteger(item.correctIndex)) correctIndices = [item.correctIndex];
    if (!Array.isArray(correctIndices) || !correctIndices.length
      || correctIndices.some((index) => !Number.isInteger(index) || index < 0 || index >= options.length)) {
      return fail(label + "Markiere mindestens eine richtige Antwort.");
    }
    correctIndices = [...new Set(correctIndices)].sort((a, b) => a - b);

    const duration = item.duration === undefined ? DEFAULT_DURATION_SECONDS : item.duration;
    if (!Number.isInteger(duration) || duration < MIN_DURATION_SECONDS || duration > MAX_DURATION_SECONDS) {
      return fail(label + "Die Zeit muss zwischen " + MIN_DURATION_SECONDS + " und " + MAX_DURATION_SECONDS + " Sekunden liegen.");
    }

    const image = typeof item.image === "string" ? item.image : "";
    if (image && !IMAGE_URL_PATTERN.test(image)) return fail(label + "Das Bild ist ungültig. Lade es bitte neu hoch.");

    const points = item.points === undefined ? "standard" : item.points;
    if (!POINT_MODES.includes(points)) return fail(label + "Die Punkte-Einstellung ist ungültig.");

    questions.push({ text, options, correctIndices, duration, image, points });
  }
  return { ok: true, questions };
}

function validateQuizName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return { ok: false, error: "Gib dem Quiz bitte einen Namen." };
  if (name.length > 60) return { ok: false, error: "Der Name ist zu lang (maximal 60 Zeichen)." };
  return { ok: true, name };
}

function normalizeSettings(value) {
  const settings = value && typeof value === "object" ? value : {};
  return {
    autoAdvance: settings.autoAdvance !== false,
    shuffle: settings.shuffle === true,
  };
}

function normalizeCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function generateCode(existingQuizzes) {
  for (;;) {
    let code = "";
    for (let i = 0; i < 5; i += 1) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!existingQuizzes.some((quiz) => quiz.code === code)) return code;
  }
}

function newId() {
  return crypto.randomBytes(6).toString("hex");
}

function loadQuizzes() {
  const quizzes = [];

  try {
    const parsed = JSON.parse(fs.readFileSync(QUIZZES_FILE, "utf8"));
    for (const item of Array.isArray(parsed.quizzes) ? parsed.quizzes : []) {
      const nameResult = validateQuizName(item && item.name);
      const questionsResult = validateQuestions(item && item.questions);
      if (!nameResult.ok || !questionsResult.ok) {
        console.warn("Ein gespeichertes Quiz ist ungültig und wird übersprungen.");
        continue;
      }
      const code = normalizeCode(item.code);
      quizzes.push({
        id: typeof item.id === "string" && item.id ? item.id : newId(),
        name: nameResult.name,
        code: CODE_PATTERN.test(code) && !quizzes.some((quiz) => quiz.code === code) ? code : generateCode(quizzes),
        questions: questionsResult.questions,
        settings: normalizeSettings(item.settings),
      });
    }
    return quizzes;
  } catch {
    // Noch nichts gespeichert: weiter mit der Übernahme alter Daten oder den Start-Fragen.
  }

  let questions = null;
  try {
    const old = validateQuestions(JSON.parse(fs.readFileSync(OLD_QUESTIONS_FILE, "utf8")));
    if (old.ok) questions = old.questions;
  } catch {
    // Keine alte Datei vorhanden.
  }
  if (!questions) {
    const seed = validateQuestions(require("./questions"));
    questions = seed.ok ? seed.questions : [];
  }
  quizzes.push({ id: newId(), name: "Fremdwörter-Quiz", code: generateCode(quizzes), questions, settings: normalizeSettings() });
  return quizzes;
}

function cleanupUploads() {
  const used = new Set();
  for (const quiz of quizzes) {
    for (const question of quiz.questions) if (question.image) used.add(path.basename(question.image));
  }
  for (const file of fs.readdirSync(UPLOAD_DIR)) {
    if (used.has(file)) continue;
    const fullPath = path.join(UPLOAD_DIR, file);
    try {
      // Frisch hochgeladene Bilder, die noch nicht gespeichert wurden, bleiben eine Stunde erhalten.
      if (Date.now() - fs.statSync(fullPath).mtimeMs > 3_600_000) fs.unlinkSync(fullPath);
    } catch {
      // Ignorieren: die Datei ist schon weg.
    }
  }
}

function persistQuizzes() {
  const data = {
    quizzes: quizzes.map(({ id, name, code, questions, settings }) => ({ id, name, code, questions, settings })),
  };
  const tempFile = QUIZZES_FILE + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, QUIZZES_FILE);
  cleanupUploads();
}

/* ---------- Spielzustand (je Quiz eine eigene Runde) ---------- */

function newGame() {
  return {
    status: "waiting",   // waiting | playing | finished
    phase: "",           // countdown | question | reveal | scoreboard (nur während "playing")
    queue: [],
    players: [],
    order: [],
    questionIndex: -1,
    timer: null,
    phaseEndsAt: null,
    phaseDuration: 0,
    questionStartedAt: 0,
    counts: [],
  };
}

const quizzes = loadQuizzes();
quizzes.forEach((quiz) => { quiz.game = newGame(); });
try {
  persistQuizzes();
} catch (error) {
  console.error("Quizze konnten nicht gespeichert werden:", error.message);
}

function clearGameTimer(game) {
  if (game.timer) clearTimeout(game.timer);
  game.timer = null;
}

function currentQuestion(quiz) {
  const game = quiz.game;
  if (game.status !== "playing" || game.questionIndex < 0) return null;
  return quiz.questions[game.order[game.questionIndex]] || null;
}

function makePlayer({ name, deviceId, avatar }) {
  return { name, deviceId, avatar, score: 0, streak: 0, correct: 0, answered: false, answer: null, pending: null, lastResult: null };
}

function setPhase(quiz, phase, ms) {
  const game = quiz.game;
  clearGameTimer(game);
  game.phase = phase;
  game.phaseDuration = ms || 0;
  game.phaseEndsAt = ms ? Date.now() + ms : null;
  if (ms) game.timer = setTimeout(() => advancePhase(quiz), ms);
}

function startQuestion(quiz, index) {
  const game = quiz.game;
  game.questionIndex = index;
  const question = currentQuestion(quiz);
  game.counts = new Array(question.options.length).fill(0);
  game.players.forEach((player) => {
    player.answered = false;
    player.answer = null;
    player.pending = null;
    player.lastResult = null;
  });
  setPhase(quiz, "countdown", COUNTDOWN_MS);
}

function finishGame(quiz) {
  const game = quiz.game;
  clearGameTimer(game);
  game.status = "finished";
  game.phase = "";
  game.phaseEndsAt = null;
  game.phaseDuration = 0;
}

function revealQuestion(quiz) {
  const question = currentQuestion(quiz);
  const counts = question.points !== "none";
  for (const player of quiz.game.players) {
    const result = player.pending || { correct: false, points: 0 };
    if (counts) player.streak = result.correct ? player.streak + 1 : 0;
    const bonus = result.correct && result.points > 0
      ? Math.min(MAX_STREAK_BONUS, Math.max(0, player.streak - 1) * STREAK_BONUS)
      : 0;
    player.score += result.points + bonus;
    if (result.correct && counts) player.correct += 1;
    player.lastResult = {
      correct: result.correct,
      points: result.points + bonus,
      bonus,
      answered: player.answered,
      streak: player.streak,
    };
    player.pending = null;
  }
  setPhase(quiz, "reveal", quiz.settings.autoAdvance ? REVEAL_MS : 0);
}

// Wird vom Timer aufgerufen oder wenn der Host auf "Weiter" drückt.
function advancePhase(quiz) {
  const game = quiz.game;
  if (game.status !== "playing") return;
  const isLast = game.questionIndex + 1 >= game.order.length;

  if (game.phase === "countdown") {
    game.questionStartedAt = Date.now();
    setPhase(quiz, "question", currentQuestion(quiz).duration * 1000);
  } else if (game.phase === "question") {
    revealQuestion(quiz);
  } else if (game.phase === "reveal") {
    if (isLast) finishGame(quiz);
    else setPhase(quiz, "scoreboard", quiz.settings.autoAdvance ? SCOREBOARD_MS : 0);
  } else if (game.phase === "scoreboard") {
    startQuestion(quiz, game.questionIndex + 1);
  }
}

function checkAllAnswered(quiz) {
  const game = quiz.game;
  if (game.status === "playing" && game.phase === "question"
    && game.players.length && game.players.every((player) => player.answered)) {
    advancePhase(quiz);
  }
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  });
  response.end(JSON.stringify(data));
}

function standingsOf(game) {
  return [...game.players].sort((a, b) => b.score - a.score);
}

function getPublicState(quiz, deviceId) {
  const game = quiz.game;
  const phase = game.status === "playing" ? game.phase : "";
  const question = currentQuestion(quiz);
  const nextQuestion = game.status === "playing" ? quiz.questions[game.order[game.questionIndex + 1]] : null;
  const standings = standingsOf(game);
  const revealed = phase === "reveal" || phase === "scoreboard";

  let me = null;
  const playerIndex = standings.findIndex((player) => player.deviceId === deviceId);
  if (playerIndex >= 0) {
    const player = standings[playerIndex];
    const above = playerIndex > 0 ? standings[playerIndex - 1] : null;
    me = {
      name: player.name,
      avatar: player.avatar,
      inRound: true,
      score: player.score,
      streak: player.streak,
      correct: player.correct,
      rank: playerIndex + 1,
      answered: player.answered,
      answers: player.answer || [],
      lastResult: revealed ? player.lastResult : null,
      ahead: above && phase !== "question" ? { name: above.name, gap: above.score - player.score } : null,
    };
  } else {
    const queued = game.queue.find((player) => player.deviceId === deviceId);
    if (queued) me = { name: queued.name, avatar: queued.avatar, inRound: false };
  }

  return {
    quizName: quiz.name,
    code: quiz.code,
    status: game.status,
    phase,
    phaseMs: game.phaseEndsAt ? Math.max(0, game.phaseEndsAt - Date.now()) : null,
    phaseDurationMs: game.phaseDuration,
    autoAdvance: quiz.settings.autoAdvance,
    deviceJoined: Boolean(me),
    joinedName: me ? me.name : "",
    me,
    maxPlayers: MAX_PLAYERS,
    queue: game.queue.map(({ name, avatar }) => ({ name, avatar })),
    players: standings.map(({ name, avatar, score, answered, streak, correct }) => ({ name, avatar, score, answered, streak, correct })),
    questionCount: quiz.questions.length,
    question: question
      ? {
          text: question.text,
          image: question.image || "",
          number: game.questionIndex + 1,
          total: game.order.length,
          durationMs: question.duration * 1000,
          points: question.points,
          multiple: question.correctIndices.length > 1,
          optionCount: question.options.length,
          // Die Antworten gibt es erst, wenn die Frage wirklich läuft.
          options: phase === "countdown" ? [] : question.options,
        }
      : null,
    reveal: question && revealed ? { correctIndices: question.correctIndices, counts: game.counts } : null,
    answeredCount: game.players.filter((player) => player.answered).length,
    nextImage: nextQuestion ? nextQuestion.image || "" : "",
    podium: game.status === "finished" ? standings.slice(0, 3).map(({ name, avatar, score }) => ({ name, avatar, score })) : [],
  };
}

function quizForAdmin(quiz) {
  return { id: quiz.id, name: quiz.name, code: quiz.code, questions: quiz.questions, settings: quiz.settings };
}

function summarizeQuiz(quiz) {
  return {
    id: quiz.id,
    name: quiz.name,
    code: quiz.code,
    questionCount: quiz.questions.length,
    status: quiz.game.status,
    queueCount: quiz.game.queue.length,
    playerCount: quiz.game.players.length,
  };
}

function findQuizByCode(body) {
  const code = normalizeCode(body.code);
  return code ? quizzes.find((quiz) => quiz.code === code) || null : null;
}

// Admin-Aktionen dürfen das Quiz über die ID oder (z. B. beim "Ende"-Knopf) über den Code finden.
function findQuizForAdmin(body) {
  if (typeof body.id === "string") return quizzes.find((quiz) => quiz.id === body.id) || null;
  return findQuizByCode(body);
}

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* ---------- Admin ---------- */

function safeEqual(a, b) {
  const first = Buffer.from(String(a));
  const second = Buffer.from(String(b));
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function checkAdmin(body) {
  return Boolean(ADMIN_EMAIL && ADMIN_PASSWORD
    // Bei der E-Mail spielt Groß-/Kleinschreibung keine Rolle.
    && safeEqual(String(body.email || "").trim().toLowerCase(), ADMIN_EMAIL.toLowerCase())
    && safeEqual(String(body.password || "").trim(), ADMIN_PASSWORD));
}

function authorizeAdmin(body, response) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    sendJson(response, 503, { error: "Der Admin-Zugang ist beim Hosting noch nicht eingerichtet." });
    return false;
  }
  if (!checkAdmin(body)) {
    sendJson(response, 403, { error: "E-Mail oder Passwort stimmt nicht." });
    return false;
  }
  return true;
}

function saveOrFail(response, message) {
  try {
    persistQuizzes();
    return true;
  } catch (error) {
    console.error(message, error.message);
    sendJson(response, 500, { error: "Das konnte nicht gespeichert werden." });
    return false;
  }
}

/* ---------- Anfragen ---------- */

function readBody(request, limit = 100_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > limit) {
        tooLarge = true;
        body = "";
      }
    });
    request.on("end", () => {
      if (tooLarge) return reject(new Error("Die Anfrage ist zu groß."));
      try {
        const parsed = JSON.parse(body || "{}");
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {});
      } catch {
        reject(new Error("Ungültige Anfrage."));
      }
    });
    request.on("error", reject);
  });
}

function bodyLimitFor(pathname) {
  if (pathname === "/api/admin/upload") return 5_000_000;
  if (pathname === "/api/admin/save") return 400_000;
  return 100_000;
}

async function handleApi(request, response, pathname) {
  if (pathname === "/api/config" && request.method === "GET") {
    return sendJson(response, 200, {
      sponsorName: SPONSOR_NAME,
      sponsorUrl: SPONSOR_URL,
      eventBadge: EVENT_BADGE,
      avatars: AVATARS,
      maxPlayers: MAX_PLAYERS,
    });
  }

  if (request.method !== "POST") {
    return sendJson(response, 405, { error: "Diese Aktion ist nicht verfügbar." });
  }

  let body;
  try {
    body = await readBody(request, bodyLimitFor(pathname));
  } catch (error) {
    return sendJson(response, 400, { error: error.message });
  }

  /* --- Mitspielen --- */

  if (["/api/state", "/api/join", "/api/answer", "/api/leave"].includes(pathname)) {
    const quiz = findQuizByCode(body);
    if (!quiz) return sendJson(response, 404, { error: "Diesen Quiz-Code gibt es nicht. Prüfe den Code bitte noch einmal." });
    const game = quiz.game;

    if (pathname === "/api/state") {
      return sendJson(response, 200, getPublicState(quiz, body.deviceId));
    }

    if (pathname === "/api/join") {
      const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 18) : "";
      if (!name) return sendJson(response, 400, { error: "Gib bitte einen Namen ein." });
      const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
      if (!/^[a-f0-9-]{36}$/i.test(deviceId)) {
        return sendJson(response, 400, { error: "Gerätekennung fehlt. Lade die Seite neu." });
      }
      const everyone = [...game.queue, ...game.players];
      if (everyone.some((player) => player.deviceId === deviceId)) {
        return sendJson(response, 409, { error: "Von diesem Gerät bist du schon dabei." });
      }
      if (everyone.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
        return sendJson(response, 409, { error: "Der Name ist schon vergeben. Nimm bitte einen anderen." });
      }
      if (everyone.length >= MAX_PLAYERS) {
        return sendJson(response, 400, { error: "Die Runde ist voll (maximal " + MAX_PLAYERS + " Leute)." });
      }
      const avatar = AVATARS.includes(body.avatar) ? body.avatar : AVATARS[crypto.randomInt(AVATARS.length)];
      const entry = { name, deviceId, avatar };
      // Läuft schon eine Runde, steigt man direkt mit 0 Punkten ein.
      if (game.status === "playing") game.players.push(makePlayer(entry));
      else game.queue.push(entry);
      return sendJson(response, 200, { ok: true });
    }

    if (pathname === "/api/leave") {
      const before = game.queue.length + game.players.length;
      game.queue = game.queue.filter((player) => player.deviceId !== body.deviceId);
      game.players = game.players.filter((player) => player.deviceId !== body.deviceId);
      if (game.queue.length + game.players.length !== before) checkAllAnswered(quiz);
      return sendJson(response, 200, { ok: true });
    }

    // /api/answer
    if (game.status !== "playing" || game.phase !== "question") {
      return sendJson(response, 400, { error: "Gerade läuft keine Frage." });
    }
    if (body.questionNumber !== game.questionIndex + 1) {
      return sendJson(response, 409, { error: "Diese Frage ist schon vorbei." });
    }
    const player = game.players.find((item) => item.deviceId === body.deviceId);
    if (!player) return sendJson(response, 404, { error: "Du bist nicht in dieser Runde." });
    if (player.answered) return sendJson(response, 400, { error: "Du hast schon geantwortet." });

    const question = currentQuestion(quiz);
    const answers = Array.isArray(body.answers) ? body.answers : Number.isInteger(body.answer) ? [body.answer] : [];
    const unique = [...new Set(answers)];
    if (!unique.length || unique.length !== answers.length
      || unique.some((index) => !Number.isInteger(index) || index < 0 || index >= question.options.length)) {
      return sendJson(response, 400, { error: "Diese Antwort gibt es nicht." });
    }
    // Punkte gibt es nur, wenn genau die richtigen Antworten gewählt wurden – je schneller, desto mehr.
    const correct = unique.length === question.correctIndices.length
      && unique.every((index) => question.correctIndices.includes(index));
    const base = question.points === "none" ? 0 : question.points === "double" ? BASE_POINTS * 2 : BASE_POINTS;
    const elapsed = Math.min(1, (Date.now() - game.questionStartedAt) / (question.duration * 1000));
    const points = correct ? Math.round(base * (1 - elapsed / 2)) : 0;

    player.answered = true;
    player.answer = unique.sort((a, b) => a - b);
    player.pending = { correct, points };
    unique.forEach((index) => { game.counts[index] += 1; });
    checkAllAnswered(quiz);
    return sendJson(response, 200, { ok: true });
  }

  /* --- Runde steuern (Admin) --- */

  if (["/api/start", "/api/reset", "/api/next"].includes(pathname)) {
    if (!authorizeAdmin(body, response)) return;
    const quiz = findQuizForAdmin(body);
    if (!quiz) return sendJson(response, 404, { error: "Dieses Quiz gibt es nicht." });
    const game = quiz.game;

    if (pathname === "/api/start") {
      if (game.status === "playing") return sendJson(response, 400, { error: "Die Runde läuft schon." });
      if (!game.queue.length) return sendJson(response, 400, { error: "Noch ist niemand in der Lobby." });
      if (!quiz.questions.length) return sendJson(response, 400, { error: "Füge zuerst mindestens eine Frage hinzu." });
      const indices = quiz.questions.map((_, index) => index);
      game.order = quiz.settings.shuffle ? shuffled(indices) : indices;
      game.players = game.queue.map(makePlayer);
      game.queue = [];
      game.status = "playing";
      startQuestion(quiz, 0);
      return sendJson(response, 200, { ok: true });
    }

    if (pathname === "/api/next") {
      if (game.status !== "playing") return sendJson(response, 400, { error: "Gerade läuft keine Runde." });
      advancePhase(quiz);
      return sendJson(response, 200, { ok: true });
    }

    // /api/reset – mit keepPlayers landen alle Mitspieler direkt wieder in der Lobby.
    const keep = body.keepPlayers === true
      ? game.players.map(({ name, deviceId, avatar }) => ({ name, deviceId, avatar }))
      : [];
    const queue = [...keep];
    for (const entry of game.queue) if (!queue.some((item) => item.deviceId === entry.deviceId)) queue.push(entry);
    clearGameTimer(game);
    Object.assign(game, newGame(), { queue: queue.slice(0, MAX_PLAYERS) });
    return sendJson(response, 200, { ok: true });
  }

  /* --- Quizze verwalten (Admin) --- */

  if (pathname === "/api/admin/quizzes") {
    if (!authorizeAdmin(body, response)) return;
    return sendJson(response, 200, { quizzes: quizzes.map(summarizeQuiz) });
  }

  if (pathname === "/api/admin/quiz") {
    if (!authorizeAdmin(body, response)) return;
    const quiz = findQuizForAdmin(body);
    if (!quiz) return sendJson(response, 404, { error: "Dieses Quiz gibt es nicht." });
    return sendJson(response, 200, { quiz: quizForAdmin(quiz) });
  }

  if (pathname === "/api/admin/create" || pathname === "/api/admin/duplicate") {
    if (!authorizeAdmin(body, response)) return;
    if (quizzes.length >= MAX_QUIZZES) return sendJson(response, 400, { error: "Es sind maximal " + MAX_QUIZZES + " Quizze möglich." });
    let source = null;
    if (pathname === "/api/admin/duplicate") {
      source = findQuizForAdmin(body);
      if (!source) return sendJson(response, 404, { error: "Dieses Quiz gibt es nicht." });
    }
    const nameResult = validateQuizName(source
      ? (source.name + " (Kopie)").slice(0, 60)
      : body.name === undefined ? "Neues Quiz" : body.name);
    if (!nameResult.ok) return sendJson(response, 400, { error: nameResult.error });
    const quiz = {
      id: newId(),
      name: nameResult.name,
      code: generateCode(quizzes),
      questions: source ? JSON.parse(JSON.stringify(source.questions)) : [],
      settings: normalizeSettings(source && source.settings),
      game: newGame(),
    };
    quizzes.push(quiz);
    if (!saveOrFail(response, "Quiz konnte nicht gespeichert werden:")) {
      quizzes.pop();
      return;
    }
    return sendJson(response, 200, { ok: true, quiz: quizForAdmin(quiz) });
  }

  if (pathname === "/api/admin/save") {
    if (!authorizeAdmin(body, response)) return;
    const quiz = findQuizForAdmin(body);
    if (!quiz) return sendJson(response, 404, { error: "Dieses Quiz gibt es nicht." });
    if (quiz.game.status === "playing") {
      return sendJson(response, 409, { error: "Die Runde läuft gerade. Beende sie zuerst, dann kannst du speichern." });
    }
    const nameResult = validateQuizName(body.name);
    if (!nameResult.ok) return sendJson(response, 400, { error: nameResult.error });
    const questionsResult = validateQuestions(body.questions);
    if (!questionsResult.ok) return sendJson(response, 400, { error: questionsResult.error });

    const previous = { name: quiz.name, questions: quiz.questions, settings: quiz.settings };
    quiz.name = nameResult.name;
    quiz.questions = questionsResult.questions;
    quiz.settings = normalizeSettings(body.settings === undefined ? quiz.settings : body.settings);
    if (!saveOrFail(response, "Quiz konnte nicht gespeichert werden:")) {
      Object.assign(quiz, previous);
      return;
    }
    return sendJson(response, 200, { ok: true, quiz: quizForAdmin(quiz) });
  }

  if (pathname === "/api/admin/newcode") {
    if (!authorizeAdmin(body, response)) return;
    const quiz = findQuizForAdmin(body);
    if (!quiz) return sendJson(response, 404, { error: "Dieses Quiz gibt es nicht." });
    if (quiz.game.status === "playing") return sendJson(response, 409, { error: "Die Runde läuft gerade. Der Code kann danach geändert werden." });
    const previousCode = quiz.code;
    quiz.code = generateCode(quizzes);
    if (!saveOrFail(response, "Code konnte nicht gespeichert werden:")) {
      quiz.code = previousCode;
      return;
    }
    return sendJson(response, 200, { ok: true, code: quiz.code });
  }

  if (pathname === "/api/admin/kick") {
    if (!authorizeAdmin(body, response)) return;
    const quiz = findQuizForAdmin(body);
    if (!quiz) return sendJson(response, 404, { error: "Dieses Quiz gibt es nicht." });
    const name = typeof body.name === "string" ? body.name.toLowerCase() : "";
    const game = quiz.game;
    game.queue = game.queue.filter((player) => player.name.toLowerCase() !== name);
    game.players = game.players.filter((player) => player.name.toLowerCase() !== name);
    checkAllAnswered(quiz);
    return sendJson(response, 200, { ok: true });
  }

  if (pathname === "/api/admin/delete") {
    if (!authorizeAdmin(body, response)) return;
    const quiz = findQuizForAdmin(body);
    if (!quiz) return sendJson(response, 404, { error: "Dieses Quiz gibt es nicht." });
    if (quiz.game.status === "playing") return sendJson(response, 409, { error: "Die Runde läuft gerade. Beende sie zuerst." });
    clearGameTimer(quiz.game);
    quizzes.splice(quizzes.indexOf(quiz), 1);
    if (!saveOrFail(response, "Quiz konnte nicht gelöscht werden:")) {
      quizzes.push(quiz);
      return;
    }
    return sendJson(response, 200, { ok: true });
  }

  if (pathname === "/api/admin/upload") {
    if (!authorizeAdmin(body, response)) return;
    const match = typeof body.dataUrl === "string" ? DATA_URL_PATTERN.exec(body.dataUrl) : null;
    if (!match) {
      return sendJson(response, 400, { error: "Dieses Bild wird nicht unterstützt (erlaubt: PNG, JPG, WebP, GIF)." });
    }
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > 3_000_000) {
      return sendJson(response, 400, { error: "Das Bild ist zu groß (maximal 3 MB)." });
    }
    const extension = match[1] === "jpeg" ? "jpg" : match[1];
    const fileName = crypto.randomBytes(16).toString("hex") + "." + extension;
    try {
      fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
    } catch (error) {
      console.error("Bild konnte nicht gespeichert werden:", error.message);
      return sendJson(response, 500, { error: "Das Bild konnte nicht gespeichert werden." });
    }
    return sendJson(response, 200, { ok: true, url: "/uploads/" + fileName });
  }

  return sendJson(response, 404, { error: "Diese Seite gibt es nicht." });
}

function serveFile(response, baseDir, relativePath, extraHeaders) {
  let decoded;
  try {
    decoded = decodeURIComponent(relativePath);
  } catch {
    response.writeHead(400);
    return response.end("Ungültiger Pfad.");
  }
  const filePath = path.resolve(baseDir, decoded);
  if (!filePath.startsWith(baseDir + path.sep)) {
    response.writeHead(403);
    return response.end("Nicht erlaubt.");
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(404);
      return response.end("Datei nicht gefunden.");
    }
    const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "text/plain; charset=utf-8";
    response.writeHead(200, { "Content-Type": contentType, "X-Content-Type-Options": "nosniff", ...extraHeaders });
    response.end(contents);
  });
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    response.writeHead(400);
    return response.end("Ungültige Anfrage.");
  }

  if (pathname.startsWith("/api/")) {
    return handleApi(request, response, pathname).catch((error) => {
      console.error("Fehler in der API:", error);
      if (!response.headersSent) sendJson(response, 500, { error: "Da ist etwas schiefgelaufen." });
    });
  }

  if (pathname.startsWith("/uploads/")) {
    return serveFile(response, UPLOAD_DIR, pathname.slice("/uploads/".length), {
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  }

  return serveFile(response, PUBLIC_DIR, pathname === "/" ? "index.html" : pathname.slice(1), {
    "Cache-Control": "no-cache",
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Quiz-Ecke ist gestartet auf Port " + PORT + ".");
  // Zeigt nur, WOHER die Zugangsdaten kommen – niemals die Werte selbst.
  console.log("Admin-E-Mail: " + (ENV_ADMIN_EMAIL ? "aus ADMIN_EMAIL (" + ENV_ADMIN_EMAIL.length + " Zeichen)" : "Standardwert (ADMIN_EMAIL ist nicht gesetzt!)"));
  console.log("Admin-Passwort: " + (ENV_ADMIN_PASSWORD ? "aus ADMIN_PASSWORD (" + ENV_ADMIN_PASSWORD.length + " Zeichen)" : "Standardwert (ADMIN_PASSWORD ist nicht gesetzt!)"));
});
