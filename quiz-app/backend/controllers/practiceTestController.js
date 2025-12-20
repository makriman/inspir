import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabaseClient.js';
import processFile from '../utils/fileProcessor.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function createQuestionBank(req, res) {
  try {
    const { bankName, subject, tags } = req.body;
    const userId = req.user.id;

    const { data, error } = await supabase.from('question_banks').insert({
      user_id: userId,
      bank_name: bankName,
      subject,
      tags: tags || []
    }).select().single();

    if (error) throw error;
    res.json({ success: true, bank: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create question bank' });
  }
}

export async function generateQuestions(req, res) {
  try {
    let { content, questionCount = 10, questionTypes = ['mcq', 'short_answer'] } = req.body;
    const userId = req.user?.id || null;

    if (req.file) {
      content = await processFile(req.file);
    }

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const prompt = \`Generate \${questionCount} test questions from this content:

Content:
\${content}

Create questions with these types: \${questionTypes.join(', ')}

Return as JSON:
{
  "questions": [
    {
      "questionText": "...",
      "questionType": "mcq|short_answer|essay",
      "options": ["A", "B", "C", "D"], // only for MCQ
      "correctAnswer": "...",
      "explanation": "...",
      "points": 1
    }
  ]
}\`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 6000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;
    const jsonMatch = responseText.match(/\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\`/) || [null, responseText];
    const questionsData = JSON.parse(jsonMatch[1]);

    res.json({ success: true, questions: questionsData.questions });
  } catch (error) {
    console.error('Error generating questions:', error);
    res.status(500).json({ error: 'Failed to generate questions' });
  }
}

export async function createPracticeTest(req, res) {
  try {
    const { testName, bankId, questions, totalPoints, timeLimitMinutes } = req.body;
    const userId = req.user.id;

    const { data, error } = await supabase.from('practice_tests').insert({
      user_id: userId,
      test_name: testName,
      bank_id: bankId || null,
      questions,
      total_points: totalPoints,
      time_limit_minutes: timeLimitMinutes || null
    }).select().single();

    if (error) throw error;
    res.json({ success: true, test: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create practice test' });
  }
}

export async function submitTestAttempt(req, res) {
  try {
    const { testId, answers, timeTakenSeconds } = req.body;
    const userId = req.user.id;

    const { data: test } = await supabase.from('practice_tests')
      .select('*').eq('id', testId).single();
    if (!test) return res.status(404).json({ error: 'Test not found' });

    let score = 0;
    const maxScore = test.total_points;
    const aiFeedback = [];

    for (let i = 0; i < test.questions.length; i++) {
      const question = test.questions[i];
      const userAnswer = answers[i];

      if (question.questionType === 'mcq') {
        if (userAnswer === question.correctAnswer) {
          score += question.points || 1;
        }
      } else if (question.questionType === 'essay' || question.questionType === 'short_answer') {
        const gradingPrompt = \`Grade this answer:
Question: \${question.questionText}
Correct Answer: \${question.correctAnswer}
Student Answer: \${userAnswer}

Provide score (0-\${question.points}) and brief feedback as JSON:
{"score": 0-\${question.points}, "feedback": "..."}\`;

        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 500,
          messages: [{ role: 'user', content: gradingPrompt }]
        });

        const gradeText = message.content[0].text;
        const gradeMatch = gradeText.match(/\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\`/) || [null, gradeText];
        const grade = JSON.parse(gradeMatch[1]);
        
        score += grade.score;
        aiFeedback.push({ questionIndex: i, ...grade });
      }
    }

    const { data: attempt } = await supabase.from('practice_test_attempts').insert({
      test_id: testId,
      user_id: userId,
      answers,
      score,
      max_score: maxScore,
      time_taken_seconds: timeTakenSeconds,
      ai_feedback: aiFeedback
    }).select().single();

    res.json({
      success: true,
      attempt,
      score,
      maxScore,
      percentage: Math.round((score / maxScore) * 100),
      aiFeedback
    });
  } catch (error) {
    console.error('Error submitting test:', error);
    res.status(500).json({ error: 'Failed to submit test' });
  }
}

export async function getPracticeTests(req, res) {
  try {
    const userId = req.user.id;
    const { data } = await supabase.from('practice_tests')
      .select('id, test_name, total_points, time_limit_minutes, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    res.json({ success: true, tests: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
}

export async function getPracticeTestById(req, res) {
  try {
    const { id } = req.params;
    const { data } = await supabase.from('practice_tests').select('*').eq('id', id).single();
    if (!data) return res.status(404).json({ error: 'Test not found' });
    res.json({ success: true, test: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch test' });
  }
}
