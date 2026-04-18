const rateLimit = new Map();
const MAX_PER_IP_PER_DAY = 10;
const MAX_GLOBAL_PER_DAY = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

let globalCount = 0;
let globalResetAt = Date.now() + DAY_MS;

function cleanupOldEntries() {
  const now = Date.now();
  for (const [ip, data] of rateLimit.entries()) {
    if (now > data.resetAt) rateLimit.delete(ip);
  }
  if (now > globalResetAt) {
    globalCount = 0;
    globalResetAt = now + DAY_MS;
  }
}

function checkLimits(ip) {
  cleanupOldEntries();
  if (globalCount >= MAX_GLOBAL_PER_DAY) {
    return { ok: false, reason: 'global', message: 'Tageslimit erreicht — bitte morgen erneut versuchen.' };
  }
  const entry = rateLimit.get(ip);
  if (entry && entry.count >= MAX_PER_IP_PER_DAY) {
    return { ok: false, reason: 'ip', message: 'Du hast das Tageslimit für KI-Anfragen erreicht. Bitte morgen erneut versuchen.' };
  }
  return { ok: true };
}

function incrementLimits(ip) {
  globalCount++;
  const entry = rateLimit.get(ip);
  if (entry) { entry.count++; }
  else { rateLimit.set(ip, { count: 1, resetAt: Date.now() + DAY_MS }); }
}

const PROMPTS = {
  cv_score: (d) => `Du bist ein erfahrener deutscher Personalberater. Analysiere diesen Lebenslauf und gib detailliertes Feedback auf Deutsch.

LEBENSLAUF:
Name: ${d.name || ''}
Berufsbezeichnung: ${d.jobTitle || ''}
Berufserfahrung: ${d.experience || ''}
Ausbildung: ${d.education || ''}
Expertise: ${d.expertise || ''}
Sprachen: ${d.languages || ''}
Qualifikationen: ${d.qualifications || ''}

Antworte NUR mit einem JSON-Objekt (kein anderer Text):
{"score":85,"titel":"Starker Lebenslauf mit Potenzial","zusammenfassung":"Ein Satz","staerken":["Stärke 1","Stärke 2","Stärke 3"],"verbesserungen":["Verbesserung 1","Verbesserung 2","Verbesserung 3"],"kritisch":null}`,

  job_match: (d) => `Bewerte kurz die Eignung zwischen Stelle und Kandidat. Antworte NUR mit JSON:

Stelle: ${d.title || ''} bei ${d.company || ''}
Beschreibung: ${d.desc || ''}

Kandidat: ${d.profile || ''}

{"match":87,"grund":"Ein Satz auf Deutsch","fehlt":"Fehlende Qualifikation oder null"}`,

  anschreiben: (d) => `Schreibe ein professionelles deutsches Bewerbungsanschreiben.

STELLE:
Position: ${d.jobTitle || ''}
Unternehmen: ${d.company || ''}
${d.jobDesc ? 'Stellenbeschreibung:\n' + d.jobDesc + '\n' : ''}

BEWERBER:
Name: ${d.name || ''}
Hintergrund: ${d.background || ''}
${d.strengths ? 'Qualifikationen: ' + d.strengths + '\n' : ''}

PERSÖNLICHE ANTWORTEN:
${d.q1 ? 'Was gefällt: ' + d.q1 + '\n' : ''}${d.q2 ? 'Stärke: ' + d.q2 + '\n' : ''}${d.q3 ? 'Eintrittstermin: ' + d.q3 + '\n' : ''}

ANWEISUNGEN:
- Nur den Brieftext ab "Sehr geehrte..." bis zur Grußformel
- Kein Absender, kein Datum, keine Betreffzeile
- 3-4 Absätze, 250-350 Wörter
- Schließe mit "Mit freundlichen Grüßen"
- Keine Platzhalter verwenden`,

  paket: (d) => `Erstelle ein komplettes Bewerbungspaket auf Deutsch. Antworte NUR mit JSON:

Stelle: ${d.jobTitle || ''} bei ${d.company || ''}
${d.jobDesc ? 'Stellenbeschreibung: ' + d.jobDesc + '\n' : ''}
Bewerber: ${d.name || ''}, ${d.background || ''}
${d.strengths ? 'Qualifikationen: ' + d.strengths : ''}
${d.q1 ? 'Was gefällt: ' + d.q1 + '\n' : ''}${d.q2 ? 'Stärke: ' + d.q2 + '\n' : ''}${d.q3 ? 'Eintrittstermin: ' + d.q3 + '\n' : ''}

{"anschreiben":"Vollständiger Brieftext ab Sehr geehrte...","nachfass_betreff":"E-Mail Betreff","nachfass_body":"E-Mail Text 2 Wochen nach Bewerbung","interview":[{"frage":"Frage 1","tipp":"Antworttipp 1"},{"frage":"Frage 2","tipp":"Antworttipp 2"},{"frage":"Frage 3","tipp":"Antworttipp 3"}]}`
};

const MAX_TOKENS = {
  cv_score: 800,
  job_match: 200,
  anschreiben: 1500,
  paket: 2500
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) { return res.status(500).json({ error: 'Server misconfiguration' }); }

  const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();

  const limitCheck = checkLimits(ip);
  if (!limitCheck.ok) {
    return res.status(429).json({ error: limitCheck.message });
  }

  const { task, data } = req.body || {};
  if (!task || !PROMPTS[task]) { return res.status(400).json({ error: 'Invalid task' }); }

  const prompt = PROMPTS[task](data || {});
  const maxTokens = MAX_TOKENS[task] || 1000;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'API error' });
    }

    const json = await response.json();
    incrementLimits(ip);
    const text = json.content?.[0]?.text || '';
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}