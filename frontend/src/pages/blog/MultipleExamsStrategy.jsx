import BlogLayout from '../../components/BlogLayout';
import { Link } from 'react-router-dom';

export default function MultipleExamsStrategy() {
  return (
    <BlogLayout
      title="How to Study for Multiple Exams at Once (Without Burning Out)"
      category="Study Tips"
      readTime="9 min read"
      lastModified="2025-12-14"
      icon="📚"
    >
      <div className="bg-gradient-to-r from-purple-100 to-blue-100 rounded-2xl p-12 mb-8 text-center border-l-4 border-purple-dark">
        <div className="text-7xl mb-4">📚</div>
        <p className="text-2xl font-bold text-deep-blue">
          Finals week doesn't have to mean all-nighters. Smart strategies beat brute force every time.
        </p>
      </div>

      <p className="text-xl text-gray-700 mb-6">
        You've got three exams in five days. Your instinct? Panic, pull all-nighters, and pray the Red Bull holds out. But there's a better way. With the right system, you can prepare for multiple exams simultaneously without sacrificing your sleep, sanity, or performance.
      </p>

      <h2>The Multi-Exam Challenge</h2>
      <p>
        Studying for multiple exams creates unique problems that single-subject preparation doesn't face:
      </p>
      <ul>
        <li><strong>Information Interference:</strong> Studying Biology after History can cause details to blur together</li>
        <li><strong>Time Scarcity:</strong> You can't give each subject the attention it deserves</li>
        <li><strong>Mental Fatigue:</strong> Context-switching between subjects drains cognitive energy</li>
        <li><strong>Prioritization Paralysis:</strong> Which subject deserves your limited study time?</li>
      </ul>

      <div className="bg-yellow-50 border-l-4 border-vibrant-yellow p-6 rounded-r-lg my-8">
        <h3 className="font-bold text-lg mb-2">Quick Win:</h3>
        <p>
          Create a master calendar with all exam dates. Work backward from each exam to map your available study days. This simple visual shows you exactly how much time you have for each subject.
        </p>
      </div>

      <h2>Strategy 1: The Interleaved Study Schedule</h2>
      <p>
        Instead of blocking out full days for single subjects (Monday = Math, Tuesday = Chemistry), use <strong>interleaving</strong> — mixing subjects within the same study session.
      </p>

      <h3>Why This Works</h3>
      <p>
        Research shows interleaving improves long-term retention because your brain has to work harder to recall each subject's context. The difficulty is the point — it strengthens memory formation.
      </p>

      <h3>How to Implement</h3>
      <p>
        Structure each study session in 90-minute blocks with three 25-minute segments:
      </p>
      <ul>
        <li>25 min: Subject A (e.g., Biology quiz)</li>
        <li>25 min: Subject B (e.g., History essay outline)</li>
        <li>25 min: Subject C (e.g., Math problem sets)</li>
        <li>15 min: Break</li>
      </ul>

      <div className="bg-gradient-to-r from-coral-red to-red-600 text-white rounded-xl p-8 my-12 text-center">
        <h3 className="text-2xl font-bold mb-4">Try This in inspir</h3>
        <p className="mb-6">
          Generate quizzes for each subject, then rotate through them in 25-minute sprints. Use the Study Timer for Pomodoro sessions and track your daily streak.
        </p>
        <div className="flex justify-center gap-4 flex-wrap">
          <Link to="/quiz" className="bg-white text-red-600 px-8 py-3 rounded-lg font-bold hover:bg-opacity-90 transition-all">
            Create Quiz
          </Link>
          <Link to="/study-timer" className="bg-transparent border-2 border-white text-white px-8 py-3 rounded-lg font-bold hover:bg-white hover:text-red-600 transition-all">
            Start Timer
          </Link>
        </div>
      </div>

      <h2>Strategy 2: Priority-Based Time Allocation</h2>
      <p>
        Not all exams are created equal. Use a simple formula to allocate study time:
      </p>

      <div className="bg-gray-100 p-6 rounded-lg my-6">
        <p className="font-mono text-lg mb-2">
          <strong>Priority Score = (Exam Weight × Difficulty × Gap in Knowledge) / Days Until Exam</strong>
        </p>
        <p className="text-sm text-gray-600">
          Higher scores get more study time. Recalculate daily as exams approach.
        </p>
      </div>

      <h3>Example Calculation</h3>
      <p>If you have:</p>
      <ul>
        <li><strong>Biology:</strong> 30% of grade, very difficult, low confidence, 4 days away = (0.30 × 10 × 8) / 4 = <strong>6.0 priority</strong></li>
        <li><strong>History:</strong> 25% of grade, moderate difficulty, medium confidence, 6 days away = (0.25 × 6 × 5) / 6 = <strong>1.25 priority</strong></li>
        <li><strong>Math:</strong> 35% of grade, hard, medium confidence, 3 days away = (0.35 × 8 × 5) / 3 = <strong>4.67 priority</strong></li>
      </ul>
      <p>
        <strong>Result:</strong> Spend most time on Biology, followed by Math, then History.
      </p>

      <h2>Strategy 3: Active Recall Across All Subjects</h2>
      <p>
        For each subject, focus on <Link to="/blog/active-recall-learning" className="text-purple-dark font-semibold hover:underline">active recall</Link> instead of passive review. Generate practice questions and test yourself repeatedly.
      </p>

      <h3>Subject-Specific Active Recall Tactics</h3>
      <ul>
        <li><strong>STEM (Math, Physics, Chemistry):</strong> Work problems without looking at solutions. Use the{' '}
          <Link to="/doubt" className="text-purple-dark font-semibold hover:underline">Doubt Solver</Link> only after you've attempted the problem.
        </li>
        <li><strong>Humanities (History, Literature):</strong> Write essay outlines from memory. Quiz yourself on key dates, themes, and arguments.</li>
        <li><strong>Languages:</strong> Practice writing and speaking without reference materials. Self-test on vocabulary and grammar rules.</li>
        <li><strong>Social Sciences:</strong> Explain theories and concepts out loud. Create comparison charts from memory.</li>
      </ul>

      <h2>Strategy 4: Spaced Repetition for Long-Term Retention</h2>
      <p>
        When juggling multiple exams, you need information to stick for weeks, not just days. Use <Link to="/blog/spaced-repetition-schedule" className="text-purple-dark font-semibold hover:underline">spaced repetition</Link>:
      </p>

      <ul>
        <li><strong>Day 1:</strong> Learn new material + quiz yourself</li>
        <li><strong>Day 2:</strong> Review + quiz again</li>
        <li><strong>Day 4:</strong> Review + quiz again</li>
        <li><strong>Day 7:</strong> Review + quiz again</li>
        <li><strong>Day 14:</strong> Review + quiz again</li>
      </ul>

      <p>
        For subjects with exams further out, front-load your spaced repetition. For imminent exams, compress the schedule but maintain the review cycles.
      </p>

      <h2>Strategy 5: Energy Management Over Time Management</h2>
      <p>
        Your brain's capacity isn't constant. Study your hardest subject when you're freshest (usually morning), moderate subjects mid-day, and lighter review in the evening.
      </p>

      <h3>Sample Energy-Optimized Day</h3>
      <ul>
        <li><strong>8-10 AM:</strong> Hardest subject (new concepts, problem-solving)</li>
        <li><strong>10-12 PM:</strong> Medium difficulty (practice problems, essay outlines)</li>
        <li><strong>1-3 PM:</strong> Lightest subject (vocabulary review, flashcards)</li>
        <li><strong>4-6 PM:</strong> Active recall quizzes across all subjects</li>
        <li><strong>7-8 PM:</strong> Light review, organize notes for tomorrow</li>
      </ul>

      <h2>Common Pitfalls to Avoid</h2>
      <ul>
        <li><strong>Don't:</strong> Study the same subject for 8 hours straight. Diminishing returns kick in after 2 hours.</li>
        <li><strong>Don't:</strong> Ignore sleep to study more. Sleep consolidates memory — pulling all-nighters sabotages retention.</li>
        <li><strong>Don't:</strong> Just re-read notes. Passive review creates the "illusion of knowledge" without real understanding.</li>
        <li><strong>Don't:</strong> Wait until the last minute to start. Even 10 minutes/day beats cramming.</li>
      </ul>

      <div className="bg-yellow-50 border-l-4 border-vibrant-yellow p-6 rounded-r-lg my-8">
        <h3 className="font-bold text-lg mb-2">Pro Tip:</h3>
        <p>
          Use the <Link to="/streaks" className="text-purple-dark font-semibold hover:underline">Study Streaks</Link> feature to track daily study sessions across all subjects. A 7-day streak is more powerful than a 12-hour cram session.
        </p>
      </div>

      <h2>Your Action Plan</h2>
      <p>
        <strong>This week:</strong>
      </p>
      <ol>
        <li>List all exams with dates and weights</li>
        <li>Calculate priority scores for each subject</li>
        <li>Create interleaved study schedules (use the Study Timer)</li>
        <li>Generate practice quizzes for each subject</li>
        <li>Start spaced repetition cycles for topics furthest out</li>
        <li>Track your daily study sessions</li>
      </ol>

      <p>
        <strong>Next week:</strong>
      </p>
      <ol>
        <li>Recalculate priorities as exams approach</li>
        <li>Increase quiz frequency for imminent exams</li>
        <li>Reduce study session length but increase frequency</li>
        <li>Review mistake logs from previous quizzes</li>
      </ol>

      <h2>Final Thoughts</h2>
      <p>
        Studying for multiple exams isn't about working harder — it's about working smarter. Interleaving, prioritization, active recall, spaced repetition, and energy management create a system that scales across subjects without scaling your stress.
      </p>

      <p>
        The students who ace multiple exams aren't superhuman. They just have better systems. Build yours today.
      </p>

      <div className="border-l-4 border-purple-dark bg-purple-50 p-6 rounded-r-lg my-8">
        <h3 className="font-bold mb-2">Related Reading:</h3>
        <ul className="space-y-2">
          <li>
            <Link to="/blog/finals-study-plan" className="text-purple-dark hover:underline">
              Finals Study Plan: Complete 30-Day Strategy
            </Link>
          </li>
          <li>
            <Link to="/blog/active-recall-learning" className="text-purple-dark hover:underline">
              Active Recall Learning: The Science Behind It
            </Link>
          </li>
          <li>
            <Link to="/blog/spaced-repetition-schedule" className="text-purple-dark hover:underline">
              Spaced Repetition Schedule That Actually Works
            </Link>
          </li>
        </ul>
      </div>
    </BlogLayout>
  );
}
