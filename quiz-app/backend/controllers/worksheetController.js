import Anthropic from '@anthropic-ai/sdk';
import processFile from '../utils/fileProcessor.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.ANTHROPIC_WORKSHEET_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

const WORKSHEET_TYPES = new Map([
  [
    'fill-blank-generator',
    {
      name: 'Fill-in-the-Blank Generator',
      schema: `{
  "title": "short title",
  "items": [
    { "prompt": "Sentence with ____ blank", "answer": "missing word/phrase", "hint": "short hint" }
  ]
}`,
      instructions: (count, difficulty) => `Create ${count} fill-in-the-blank prompts. Each prompt should contain exactly one blank written as "____". Difficulty: ${difficulty}.`,
    },
  ],
  [
    'mcq-bank',
    {
      name: 'Multiple Choice Question Bank',
      schema: `{
  "title": "short title",
  "items": [
    {
      "question": "question text",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answerIndex": 0,
      "explanation": "1-2 sentence explanation"
    }
  ]
}`,
      instructions: (count, difficulty) =>
        `Create ${count} multiple-choice questions with 4 plausible options each. Provide answerIndex as 0-3. Difficulty: ${difficulty}.`,
    },
  ],
  [
    'essay-question-generator',
    {
      name: 'Essay Question Generator',
      schema: `{
  "title": "short title",
  "items": [
    { "prompt": "essay prompt", "keyPoints": ["point 1", "point 2"], "outline": ["I. ...", "II. ..."] }
  ]
}`,
      instructions: (count, difficulty) =>
        `Create ${count} essay prompts. For each prompt include 4-6 keyPoints and a short outline (4-7 bullets). Difficulty: ${difficulty}.`,
    },
  ],
  [
    'vocabulary-builder',
    {
      name: 'Vocabulary Builder',
      schema: `{
  "title": "short title",
  "items": [
    { "term": "word/term", "partOfSpeech": "noun|verb|adj|adv|other", "definition": "student-friendly definition", "example": "example sentence", "mnemonic": "optional mnemonic" }
  ]
}`,
      instructions: (count, difficulty) =>
        `Create a ${count}-term vocabulary list. Keep definitions student-friendly and include one example sentence per term. Difficulty: ${difficulty}.`,
    },
  ],
  [
    'true-false-quiz',
    {
      name: 'True/False Quiz Maker',
      schema: `{
  "title": "short title",
  "items": [
    { "statement": "statement text", "answer": true, "explanation": "1-2 sentence explanation" }
  ]
}`,
      instructions: (count, difficulty) =>
        `Create ${count} true/false statements. Mix true and false evenly. Difficulty: ${difficulty}.`,
    },
  ],
  [
    'matching-game',
    {
      name: 'Matching Game Generator',
      schema: `{
  "title": "short title",
  "pairs": [
    { "left": "term", "right": "definition" }
  ]
}`,
      instructions: (count, difficulty) =>
        `Create ${count} matching pairs. Left side should be short terms; right side short definitions. Difficulty: ${difficulty}.`,
    },
  ],
  [
    'diagram-labeling',
    {
      name: 'Diagram Labeling Practice',
      schema: `{
  "title": "short title",
  "items": [
    { "partNumber": 1, "label": "label", "description": "what/where this part is" }
  ]
}`,
      instructions: (count, difficulty) =>
        `Create ${count} labeled parts for diagram labeling practice. Use common diagram parts for the topic. partNumber must start at 1 and increment by 1. Difficulty: ${difficulty}.`,
    },
  ],
]);

function clampInt(value, { min, max, fallback }) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function coerceDifficulty(value) {
  const normalized = String(value || 'medium').toLowerCase();
  if (['easy', 'medium', 'hard'].includes(normalized)) return normalized;
  return 'medium';
}

function extractJson(text) {
  const responseText = String(text || '').trim();
  const fenced =
    responseText.match(/```json\s*([\s\S]*?)\s*```/i) || responseText.match(/```\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) return fenced[1];

  const firstBrace = responseText.indexOf('{');
  const lastBrace = responseText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return responseText.slice(firstBrace, lastBrace + 1);
  }
  return responseText;
}

function validateWorksheetShape(type, data, expectedCount) {
  if (!data || typeof data !== 'object') return 'Response is not an object';
  if (typeof data.title !== 'string' || data.title.trim().length === 0) return 'Missing title';

  if (type === 'matching-game') {
    if (!Array.isArray(data.pairs)) return 'Missing pairs';
    if (expectedCount && data.pairs.length !== expectedCount) return 'Incorrect number of pairs';
    return null;
  }

  if (!Array.isArray(data.items)) return 'Missing items';
  if (expectedCount && data.items.length !== expectedCount) return 'Incorrect number of items';
  return null;
}

export async function generateWorksheet(req, res) {
  try {
    const {
      type,
      topic: rawTopic,
      content: rawContent,
      count: rawCount,
      difficulty: rawDifficulty,
    } = req.body;

    const config = WORKSHEET_TYPES.get(type);
    if (!config) {
      return res.status(400).json({ error: 'Invalid worksheet type' });
    }

    const difficulty = coerceDifficulty(rawDifficulty);
    const count = clampInt(rawCount, { min: 5, max: 30, fallback: 10 });

    let content = rawContent;
    const topic = String(rawTopic || '').trim();

    if (req.file) {
      try {
        content = await processFile(req.file);
      } catch (error) {
        return res.status(400).json({ error: 'Failed to process file', details: error.message });
      }
    }

    const normalizedContent = String(content || '').trim();
    if (!normalizedContent && !topic) {
      return res.status(400).json({ error: 'Provide either topic or content' });
    }

    const prompt = `You are a study assistant creating student-friendly practice materials.

Tool: ${config.name}
${config.instructions(count, difficulty)}

Input:
${topic ? `Topic: ${topic}\n` : ''}${normalizedContent ? `Content:\n${normalizedContent}\n` : ''}

Return ONLY valid JSON matching this schema:
${config.schema}

Rules:
- Do not include any extra keys.
- Do not include markdown.
- Keep language appropriate for students.
- Ensure the array length matches exactly (${count}).`;

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3500,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    let parsed;
    try {
      const json = extractJson(message.content?.[0]?.text);
      parsed = JSON.parse(json);
    } catch (error) {
      return res.status(502).json({
        error: 'Failed to parse AI response',
        details: 'The AI returned an invalid JSON format',
      });
    }

    const validationError = validateWorksheetShape(type, parsed, count);
    if (validationError) {
      return res.status(502).json({
        error: 'Invalid AI response',
        details: validationError,
      });
    }

    return res.json({
      success: true,
      type,
      ...parsed,
    });
  } catch (error) {
    console.error('Error generating worksheet:', error);
    return res.status(500).json({
      error: 'Failed to generate worksheet',
      details: error.message,
    });
  }
}
