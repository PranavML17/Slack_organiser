const axios = require('axios');

const MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    task: { type: 'STRING' },
    priority: {
      type: 'STRING',
      enum: ['High', 'Medium', 'Low', 'None']
    }
  },
  required: ['task', 'priority']
};

// Analyzes a raw Slack message that mentioned the user: rewrites it as a
// short task, and classifies priority based on tone/urgency. Best-effort —
// if there's no API key, or the call fails for any reason, callers should
// fall back to the raw text rather than let this block the core pipeline.
async function analyzeMention(rawText) {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!rawText || !rawText.trim()) return null;

  const prompt =
    'Analyze this Slack message that mentioned/tagged someone. Two things:\n' +
    '1. task — rewrite it as a short, clear task description (max 12 words). ' +
    'If it is not actually a request, tighten it into a short neutral summary instead.\n' +
    '2. priority — based on the TONE and urgency of the message (not just the words), classify as:\n' +
    '   High: urgent ask, explicit deadline/urgency language ("ASAP", "urgent", "by EOD", ' +
    'blocking someone, repeated follow-up), or clearly expects a fast response.\n' +
    '   Medium: a real request or something expected of the person, but no urgency signal.\n' +
    '   Low: a minor or optional ask, something that can clearly wait.\n' +
    '   None: not actually a request or expectation at all — praise, FYI, casual chat, no action needed.\n\n' +
    `Message: ${rawText}`;

  try {
    const res = await axios.post(
      `${ENDPOINT}?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          thinkingConfig: { thinkingLevel: 'minimal' },
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA
        }
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );
    const candidate = res.data.candidates && res.data.candidates[0];
    const text = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text;
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (!parsed.task) return null;
    return { task: parsed.task.trim(), priority: parsed.priority || 'Unknown' };
  } catch (e) {
    console.error('Gemini analysis failed (non-fatal, falling back to raw text):', e.message);
    return null;
  }
}

module.exports = { analyzeMention };
