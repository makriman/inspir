import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import SeoRouter from './seo/SeoRouter';
import AuthPage from './pages/AuthPage';
import HomePageGuest from './pages/HomePageGuest';
import HomePageUser from './pages/HomePageUser';
import UploadInterface from './components/UploadInterface';
import Quiz from './components/Quiz';
import Results from './components/Results';
import Dashboard from './components/Dashboard';
import QuizAttempts from './components/QuizAttempts';
import QuizReview from './components/QuizReview';
import QuizHistory from './pages/QuizHistory';

// SEO Pages
import About from './pages/About';
import HowItWorks from './pages/HowItWorks';
import UseCases from './pages/UseCases';
import FAQ from './pages/FAQ';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Blog from './pages/Blog';

// Blog Articles
import StudentsExamPrep from './pages/blog/StudentsExamPrep';
import TeachersLessonPlans from './pages/blog/TeachersLessonPlans';
import StudySmarterNotes from './pages/blog/StudySmarterNotes';
import QuizYourselfQuickly from './pages/blog/QuizYourselfQuickly';
import SelfDirectedLearning from './pages/blog/SelfDirectedLearning';
import EffectiveStudyQuizzes from './pages/blog/EffectiveStudyQuizzes';
import ProfessionalTraining from './pages/blog/ProfessionalTraining';
import ActiveRecallLearning from './pages/blog/ActiveRecallLearning';
import TextbookQuizzes from './pages/blog/TextbookQuizzes';
import LanguageLearning from './pages/blog/LanguageLearning';
import MedicalStudentsGuide from './pages/blog/MedicalStudentsGuide';
import LawSchoolStudy from './pages/blog/LawSchoolStudy';
import HomeschoolAssessments from './pages/blog/HomeschoolAssessments';
import CorporateTraining from './pages/blog/CorporateTraining';
import StudyGroupsCollaboration from './pages/blog/StudyGroupsCollaboration';
import CertificationExamPrep from './pages/blog/CertificationExamPrep';
import VsTraditionalFlashcards from './pages/blog/VsTraditionalFlashcards';
import ScienceActiveRecall from './pages/blog/ScienceActiveRecall';
import ResearchPaperQuizzes from './pages/blog/ResearchPaperQuizzes';
import GeneralKnowledgeFun from './pages/blog/GeneralKnowledgeFun';
import CornellNotesMethod from './pages/blog/CornellNotesMethod';
import PomodoroActiveRecall from './pages/blog/PomodoroActiveRecall';
import AIStudyDoubtSolver from './pages/blog/AIStudyDoubtSolver';
import StudyFromNotesAIQuiz from './pages/blog/StudyFromNotesAIQuiz';
import SpacedRepetitionSchedule from './pages/blog/SpacedRepetitionSchedule';
import FinalsStudyPlan from './pages/blog/FinalsStudyPlan';
import TeacherMultipleChoiceQuestions from './pages/blog/TeacherMultipleChoiceQuestions';
import StudyTimer from './pages/StudyTimer';
import NotFound from './pages/NotFound';
import StudentForum from './pages/StudentForum';
import Chat from './pages/Chat';
import GradeCalculator from './pages/GradeCalculator';
import CitationGenerator from './pages/CitationGenerator';
import CornellNotes from './pages/CornellNotes';
import StudyStreaksPage from './pages/StudyStreaksPage';
import DoubtSolver from './pages/DoubtSolver';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-purple-gradient flex items-center justify-center">
        <div className="text-white text-2xl">Loading...</div>
      </div>
    );
  }

  return user ? children : <Navigate to="/auth" />;
}

function HomePage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-white to-off-white flex items-center justify-center">
        <div className="text-primary-blue text-2xl font-bold">Loading...</div>
      </div>
    );
  }

  return user ? <HomePageUser /> : <HomePageGuest />;
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <SeoRouter />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/quiz" element={<UploadInterface />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/results" element={<Results />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <QuizHistory />
              </ProtectedRoute>
            }
          />

          {/* Quiz Sharing Routes */}
          <Route path="/shared/:shareToken" element={<Quiz />} />
          <Route
            path="/quiz/:quizId/attempts"
            element={
              <ProtectedRoute>
                <QuizAttempts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/quiz/:quizId/review"
            element={
              <ProtectedRoute>
                <QuizReview />
              </ProtectedRoute>
            }
          />

          {/* SEO Pages */}
          <Route path="/about" element={<About />} />
          <Route path="/how-it-works" element={<HowItWorks />} />
          <Route path="/use-cases" element={<UseCases />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/study-timer" element={<StudyTimer />} />
          <Route path="/forum" element={<StudentForum />} />
          <Route path="/grade-calculator" element={<GradeCalculator />} />

          {/* New Study Tools */}
          <Route path="/citations" element={<CitationGenerator />} />
          <Route path="/cornell-notes" element={<CornellNotes />} />
          <Route path="/streaks" element={<StudyStreaksPage />} />
          <Route path="/doubt" element={<DoubtSolver />} />
          <Route path="/doubt/shared/:shareToken" element={<DoubtSolver />} />
          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <Chat />
              </ProtectedRoute>
            }
          />

          {/* Blog Articles */}
          <Route path="/blog/students-exam-prep" element={<StudentsExamPrep />} />
          <Route path="/blog/teachers-lesson-plans" element={<TeachersLessonPlans />} />
          <Route path="/blog/study-smarter-notes" element={<StudySmarterNotes />} />
          <Route path="/blog/quiz-yourself-quickly" element={<QuizYourselfQuickly />} />
          <Route path="/blog/self-directed-learning" element={<SelfDirectedLearning />} />
          <Route path="/blog/effective-study-quizzes" element={<EffectiveStudyQuizzes />} />
          <Route path="/blog/professional-training" element={<ProfessionalTraining />} />
          <Route path="/blog/active-recall-learning" element={<ActiveRecallLearning />} />
          <Route path="/blog/textbook-quizzes" element={<TextbookQuizzes />} />
          <Route path="/blog/language-learning" element={<LanguageLearning />} />
          <Route path="/blog/medical-students-guide" element={<MedicalStudentsGuide />} />
          <Route path="/blog/law-school-study" element={<LawSchoolStudy />} />
          <Route path="/blog/homeschool-assessments" element={<HomeschoolAssessments />} />
          <Route path="/blog/corporate-training" element={<CorporateTraining />} />
          <Route path="/blog/study-groups-collaboration" element={<StudyGroupsCollaboration />} />
          <Route path="/blog/certification-exam-prep" element={<CertificationExamPrep />} />
          <Route path="/blog/vs-traditional-flashcards" element={<VsTraditionalFlashcards />} />
          <Route path="/blog/science-active-recall" element={<ScienceActiveRecall />} />
          <Route path="/blog/research-paper-quizzes" element={<ResearchPaperQuizzes />} />
          <Route path="/blog/general-knowledge-fun" element={<GeneralKnowledgeFun />} />
          <Route path="/blog/cornell-notes-method" element={<CornellNotesMethod />} />
          <Route path="/blog/pomodoro-active-recall" element={<PomodoroActiveRecall />} />
          <Route path="/blog/ai-study-doubt-solver" element={<AIStudyDoubtSolver />} />
          <Route path="/blog/study-from-notes-ai-quiz" element={<StudyFromNotesAIQuiz />} />
          <Route path="/blog/spaced-repetition-schedule" element={<SpacedRepetitionSchedule />} />
          <Route path="/blog/finals-study-plan" element={<FinalsStudyPlan />} />
          <Route path="/blog/better-mcq-questions" element={<TeacherMultipleChoiceQuestions />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
