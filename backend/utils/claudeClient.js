import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '', 10) || 90_000;
const MAX_RETRIES = Number.parseInt(process.env.ANTHROPIC_MAX_RETRIES || '', 10);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: DEFAULT_TIMEOUT_MS,
  ...(Number.isFinite(MAX_RETRIES) ? { maxRetries: MAX_RETRIES } : {}),
});

export async function generateQuiz(content, topicName = null) {
  // Determine if this is topic-only generation or content-based
  const isTopicOnly = content.startsWith('Topic:');

  const prompt = `You are an expert quiz generator creating thought-provoking, fundamental questions that test deep understanding and inspire curiosity.

${isTopicOnly
  ? `Generate exactly 10 quiz questions about the topic: "${topicName || content.replace('Topic:', '').trim()}"

Use your general knowledge to create intelligent, thought-provoking questions that:
- Go beyond simple facts and dates
- Test conceptual understanding and critical thinking
- Connect ideas and concepts in meaningful ways
- Avoid simple "who, what, when" questions
- Instead ask questions that require analysis, synthesis, and application

EXAMPLE OF GOOD vs BAD QUESTIONS:
❌ BAD: "Who is the Prime Minister of India?"
✅ GOOD: "Who is the person with a history as a chai seller who rose to become the highest political position holder in India?"

❌ BAD: "When did World War 2 end?"
✅ GOOD: "What strategic decision made in 1945 fundamentally changed the nature of warfare and international relations for decades to come?"

❌ BAD: "What is photosynthesis?"
✅ GOOD: "How do plants convert sunlight into chemical energy, and why is this process essential for nearly all life on Earth?"`
  : `Based on the specific content provided below, create exactly 10 quiz questions.

Content-specific guidelines:
- Extract the most important concepts and ideas
- Create questions that test understanding of the material
- Connect concepts within the content
- Test application of learned principles
- Avoid simple recall when possible`}

Create exactly 10 questions ALTERNATING between types:
- Question 1: Multiple choice
- Question 2: Open-ended
- Question 3: Multiple choice
- Question 4: Open-ended
- Question 5: Multiple choice
- Question 6: Open-ended
- Question 7: Multiple choice
- Question 8: Open-ended
- Question 9: Multiple choice
- Question 10: Open-ended

IMPORTANT: Alternate the question types - DO NOT group all MCQs together or all open-ended together.

CRITICAL REQUIREMENTS FOR ALL QUESTIONS:

For Multiple Choice Questions:
- Test FUNDAMENTAL UNDERSTANDING, not just memorization
- Frame questions that require thinking and analysis
- All 4 options must be plausible and well-reasoned
- Avoid obviously wrong answers
- Make questions that tell a story or present a scenario
- Example: Instead of "What is X?", ask "Which principle explains why X happens?"

For Open-Ended Questions:
- Ask "why", "how", "explain", "analyze", or "what would happen if" questions
- Require thoughtful, conceptual understanding
- Connect to real-world applications and implications
- Inspire curiosity and deeper thinking
- Test ability to apply concepts, not just remember facts
- Example: "How does X relate to Y, and what implications does this have?"

Overall Guidelines:
- Make every question intellectually stimulating
- Vary difficulty from accessible to challenging
- Focus on UNDERSTANDING over MEMORIZATION
- Include practical applications and real-world connections
- Inspire curiosity and deeper exploration
- Avoid simple factual recall questions
- Think: "What would make someone think deeply about this?"

Return ONLY a valid JSON object in this exact format:
{
  "questions": [
    {
      "id": 1,
      "type": "multiple_choice",
      "question": "Question text here?",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": "A"
    },
    {
      "id": 6,
      "type": "short_answer",
      "question": "Explain why/how/analyze... question text here?",
      "correct_answer": "Concise expected answer demonstrating understanding"
    }
  ]
}

${isTopicOnly ? '' : `Educational Content:\n${content}`}

Remember: Return ONLY the JSON object, no additional text or explanation.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    }, {
      timeout: Number.parseInt(process.env.ANTHROPIC_QUIZ_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS
    });

    const responseText = message.content[0].text;

    // Extract JSON from response (in case there's any extra text)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid response format from Claude');
    }

    const quizData = JSON.parse(jsonMatch[0]);

    // Validate the response has 10 questions
    if (!quizData.questions || quizData.questions.length !== 10) {
      throw new Error('Quiz must contain exactly 10 questions');
    }

    return quizData;
  } catch (error) {
    console.error('Error generating quiz:', error);
    throw new Error(`Failed to generate quiz: ${error.message}`, { cause: error });
  }
}

export async function scoreQuiz(questions, userAnswers) {
  let score = 0;
  const results = [];

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const userAnswer = userAnswers[i];

    let isCorrect = false;

    if (question.type === 'multiple_choice') {
      isCorrect = userAnswer.toUpperCase() === question.correct_answer.toUpperCase();
    } else if (question.type === 'short_answer') {
      // Use Claude to evaluate short answers
      isCorrect = await evaluateShortAnswer(question.question, question.correct_answer, userAnswer);
    }

    if (isCorrect) {
      score++;
    }

    results.push({
      questionId: question.id,
      question: question.question,
      userAnswer,
      correctAnswer: question.correct_answer,
      isCorrect,
      type: question.type
    });
  }

  return {
    score,
    totalQuestions: questions.length,
    percentage: Math.round((score / questions.length) * 100),
    results
  };
}

async function evaluateShortAnswer(question, correctAnswer, userAnswer) {
  if (!userAnswer || userAnswer.trim() === '') {
    return false;
  }

  const prompt = `Evaluate if the following student answer is correct for the given question.

Question: ${question}
Expected Answer: ${correctAnswer}
Student Answer: ${userAnswer}

Consider the answer correct if it captures the key concepts, even if worded differently.
Respond with ONLY "correct" or "incorrect".`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 10,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const evaluation = message.content[0].text.toLowerCase().trim();
    return evaluation === 'correct';
  } catch (error) {
    console.error('Error evaluating short answer:', error);
    // Default to string comparison if AI evaluation fails
    return userAnswer.toLowerCase().includes(correctAnswer.toLowerCase()) ||
           correctAnswer.toLowerCase().includes(userAnswer.toLowerCase());
  }
}

// Generate Cornell Notes from content
export async function generateCornellNotes(prompt) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    return message.content[0].text;
  } catch (error) {
    console.error('Error generating Cornell notes:', error);
    throw error;
  }
}

// Extract text from image using Claude Vision API
export async function extractTextFromImage(imageBase64) {
  try {
    // Remove data URL prefix if present
    const base64Data = imageBase64.includes(',')
      ? imageBase64.split(',')[1]
      : imageBase64;

    // Detect image format
    let mediaType = 'image/jpeg';
    if (imageBase64.startsWith('data:image/png')) {
      mediaType = 'image/png';
    } else if (imageBase64.startsWith('data:image/webp')) {
      mediaType = 'image/webp';
    } else if (imageBase64.startsWith('data:image/gif')) {
      mediaType = 'image/gif';
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data
              }
            },
            {
              type: 'text',
              text: `Extract all text from this image of a homework question or problem.

Also analyze the content and determine:
1. The subject area (Mathematics, Physics, Chemistry, Biology, English, History, Geography, Computer Science, or Other)
2. Your confidence level (0-100) in the extraction accuracy

Respond in JSON format:
{
  "extracted_text": "the full text from the image",
  "detected_subject": "subject name",
  "confidence": 95
}`
            }
          ]
        }
      ]
    });

    const responseText = message.content[0].text;

    // Parse JSON response
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      return JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      // Fallback if JSON parsing fails
      return {
        extractedText: responseText,
        detectedSubject: 'Other',
        confidence: 50
      };
    }

  } catch (error) {
    console.error('Error extracting text from image:', error);
    throw error;
  }
}

// Generate step-by-step solution for a doubt/question
export async function generateDoubtSolution(questionText, subject = null) {
  try {
    const prompt = `You are an expert tutor helping students solve homework problems.
Provide a clear, step-by-step solution to the following question.

${subject ? `Subject: ${subject}\n` : ''}
Question: ${questionText}

Provide your response in JSON format with the following structure:
{
  "solution": "Full solution text with complete explanation",
  "steps": [
    "Step 1: Clear explanation of first step",
    "Step 2: Clear explanation of second step",
    "Step 3: etc..."
  ],
  "key_concepts": [
    "Concept 1 used in solution",
    "Concept 2 used in solution"
  ],
  "difficulty": "Easy|Medium|Hard"
}

Guidelines:
1. Break down the solution into clear, logical steps
2. Explain WHY each step is taken, not just WHAT to do
3. Use simple language appropriate for students
4. Show all calculations and reasoning
5. Highlight the final answer clearly
6. List 2-5 key concepts used in the solution
7. Estimate the difficulty level

Be thorough but concise. Make learning the priority.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const responseText = message.content[0].text;

    // Parse JSON response
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      const parsed = JSON.parse(jsonMatch[0]);

      // Validate required fields
      return {
        solution: parsed.solution || responseText,
        steps: parsed.steps || [responseText],
        key_concepts: parsed.key_concepts || [],
        difficulty: parsed.difficulty || 'Medium'
      };
    } catch (parseError) {
      // Fallback if JSON parsing fails
      return {
        solution: responseText,
        steps: [responseText],
        key_concepts: [],
        difficulty: 'Medium'
      };
    }

  } catch (error) {
    console.error('Error generating doubt solution:', error);
    throw error;
  }
}
