import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../utils/supabaseClient.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function solveMathProblem(req, res) {
  try {
    const { problemText, showSteps = true } = req.body;
    const userId = req.user?.id || null;

    if (!problemText || problemText.trim().length === 0) {
      return res.status(400).json({ error: 'Problem text is required' });
    }

    const prompt = `Solve this math problem step by step:

Problem: ${problemText}

Provide a detailed solution with:
1. Step-by-step explanation (each step should be clear and justified)
2. Final answer
3. Problem type classification (algebra, calculus, geometry, etc.)
4. Difficulty level (easy, medium, hard)

Return as JSON:
{
  "problemType": "algebra|calculus|geometry|trigonometry|statistics|other",
  "difficultyLevel": "easy|medium|hard",
  "steps": [
    {"stepNumber": 1, "explanation": "...", "equation": "..."},
    {"stepNumber": 2, "explanation": "...", "equation": "..."}
  ],
  "finalAnswer": "...",
  "verification": "Brief verification that the answer is correct"
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    let solutionData;
    try {
      const responseText = message.content[0].text;
      const jsonMatch = responseText.match(/\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\`/) ||
                       responseText.match(/\`\`\`\\s*([\\s\\S]*?)\\s*\`\`\`/) ||
                       [null, responseText];
      solutionData = JSON.parse(jsonMatch[1]);
    } catch (parseError) {
      return res.status(500).json({ error: 'Failed to parse AI response' });
    }

    let savedSolution = null;
    if (userId) {
      const { data } = await supabase.from('math_solutions').insert({
        user_id: userId,
        problem_text: problemText,
        solution_steps: solutionData.steps,
        final_answer: solutionData.finalAnswer,
        problem_type: solutionData.problemType,
        difficulty_level: solutionData.difficultyLevel
      }).select().single();
      savedSolution = data;
    }

    res.json({
      success: true,
      solution: {
        id: savedSolution?.id || null,
        problemText,
        ...solutionData
      }
    });
  } catch (error) {
    console.error('Error solving math problem:', error);
    res.status(500).json({ error: 'Failed to solve problem', details: error.message });
  }
}

export async function getSolutionHistory(req, res) {
  try {
    const userId = req.user.id;
    const { data, error } = await supabase.from('math_solutions')
      .select('id, problem_text, final_answer, problem_type, difficulty_level, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ success: true, solutions: data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
}

export async function generatePracticeProblems(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { count = 3 } = req.body;

    const { data: original } = await supabase.from('math_solutions')
      .select('*').eq('id', id).eq('user_id', userId).single();
    if (!original) return res.status(404).json({ error: 'Solution not found' });

    const prompt = `Generate ${count} similar practice problems based on this solved problem:
Problem: ${original.problem_text}
Type: ${original.problem_type}
Difficulty: ${original.difficulty_level}

Create similar problems with solutions. Return as JSON array:
[{"problem": "...", "steps": [...], "answer": "..."}]`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const responseText = message.content[0].text;
    const jsonMatch = responseText.match(/\`\`\`json\\s*([\\s\\S]*?)\\s*\`\`\`/) || [null, responseText];
    const problems = JSON.parse(jsonMatch[1]);

    for (const prob of problems) {
      await supabase.from('math_practice_problems').insert({
        original_solution_id: id,
        user_id: userId,
        problem_text: prob.problem,
        solution_steps: prob.steps,
        final_answer: prob.answer
      });
    }

    res.json({ success: true, problems });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate practice problems' });
  }
}
