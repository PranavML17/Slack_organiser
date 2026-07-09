const axios = require('axios');

const MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Turns a raw Slack message into a short, clean task description.
// Best-effort only — if there's no API key configured, or the call fails
// for any reason, callers should fall back to the raw text rather than
// let this block the core Slack -> Sheets pipeline.
async function summarizeAsTask(rawText) {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!rawText || !rawText.trim()) return null;

  const prompt =
    'Rewrite this Slack message as a short, clear task description (max 12 words). ' +
    'No preamble, no quotes, just the task itself. If it is not actually a request or ' +
    'task, just tighten it into a short neutral summary instead.\n\n' +
    `Message: ${rawText}`;

  try {
    const res = await axios.post(
      `${ENDPOINT}?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } }
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    const candidate = res.data.candidates && res.data.candidates[0];
    const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
    return text ? text.trim() : null;
  } catch (e) {
    console.error('Gemini summarization failed (non-fatal, falling back to raw text):', e.message);
    return null;
  }
}

module.exports = { summarizeAsTask };
