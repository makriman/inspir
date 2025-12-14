import { useState, useEffect } from 'react';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';

export default function GradeCalculator() {
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [selectedSemester, setSelectedSemester] = useState('current');
  const [whatIfMode, setWhatIfMode] = useState(false);
  const [whatIfScore, setWhatIfScore] = useState('');
  const [whatIfWeight, setWhatIfWeight] = useState('');

  // Load data from localStorage
  useEffect(() => {
    const savedCourses = localStorage.getItem('gradeCalculator_courses');
    const savedSemesters = localStorage.getItem('gradeCalculator_semesters');

    if (savedCourses) {
      setCourses(JSON.parse(savedCourses));
    }
    if (savedSemesters) {
      setSemesters(JSON.parse(savedSemesters));
    }
  }, []);

  // Save courses to localStorage
  useEffect(() => {
    if (courses.length > 0) {
      localStorage.setItem('gradeCalculator_courses', JSON.stringify(courses));
    }
  }, [courses]);

  // Save semesters to localStorage
  useEffect(() => {
    if (semesters.length > 0) {
      localStorage.setItem('gradeCalculator_semesters', JSON.stringify(semesters));
    }
  }, [semesters]);

  const addCourse = (courseName, creditHours) => {
    const newCourse = {
      id: Date.now(),
      name: courseName,
      creditHours: parseFloat(creditHours),
      semester: selectedSemester,
      assignments: []
    };
    setCourses([...courses, newCourse]);
  };

  const addAssignment = (courseId, name, score, maxScore, weight) => {
    setCourses(courses.map(course => {
      if (course.id === courseId) {
        return {
          ...course,
          assignments: [...course.assignments, {
            id: Date.now(),
            name,
            score: parseFloat(score),
            maxScore: parseFloat(maxScore),
            weight: parseFloat(weight)
          }]
        };
      }
      return course;
    }));
  };

  const deleteAssignment = (courseId, assignmentId) => {
    setCourses(courses.map(course => {
      if (course.id === courseId) {
        return {
          ...course,
          assignments: course.assignments.filter(a => a.id !== assignmentId)
        };
      }
      return course;
    }));
  };

  const deleteCourse = (courseId) => {
    setCourses(courses.filter(c => c.id !== courseId));
    if (selectedCourse?.id === courseId) {
      setSelectedCourse(null);
    }
  };

  const calculateCourseGrade = (course, includeWhatIf = false) => {
    if (!course.assignments || course.assignments.length === 0) {
      return includeWhatIf && whatIfScore && whatIfWeight ? 0 : null;
    }

    let totalWeight = 0;
    let weightedScore = 0;

    course.assignments.forEach(assignment => {
      const percentage = (assignment.score / assignment.maxScore) * 100;
      weightedScore += (percentage * assignment.weight);
      totalWeight += assignment.weight;
    });

    if (includeWhatIf && whatIfScore && whatIfWeight) {
      const whatIfPercentage = parseFloat(whatIfScore);
      const whatIfWeightNum = parseFloat(whatIfWeight);
      weightedScore += (whatIfPercentage * whatIfWeightNum);
      totalWeight += whatIfWeightNum;
    }

    if (totalWeight === 0) return null;

    const finalGrade = weightedScore / totalWeight;
    return finalGrade;
  };

  const getLetterGrade = (percentage) => {
    if (percentage === null) return 'N/A';
    if (percentage >= 93) return 'A';
    if (percentage >= 90) return 'A-';
    if (percentage >= 87) return 'B+';
    if (percentage >= 83) return 'B';
    if (percentage >= 80) return 'B-';
    if (percentage >= 77) return 'C+';
    if (percentage >= 73) return 'C';
    if (percentage >= 70) return 'C-';
    if (percentage >= 67) return 'D+';
    if (percentage >= 63) return 'D';
    if (percentage >= 60) return 'D-';
    return 'F';
  };

  const getGradePoints = (letterGrade) => {
    const gradeMap = {
      'A': 4.0, 'A-': 3.7,
      'B+': 3.3, 'B': 3.0, 'B-': 2.7,
      'C+': 2.3, 'C': 2.0, 'C-': 1.7,
      'D+': 1.3, 'D': 1.0, 'D-': 0.7,
      'F': 0.0, 'N/A': 0.0
    };
    return gradeMap[letterGrade] || 0.0;
  };

  const calculateSemesterGPA = (semesterName) => {
    const semesterCourses = courses.filter(c => c.semester === semesterName);
    if (semesterCourses.length === 0) return null;

    let totalPoints = 0;
    let totalCredits = 0;

    semesterCourses.forEach(course => {
      const grade = calculateCourseGrade(course);
      if (grade !== null) {
        const letterGrade = getLetterGrade(grade);
        const gradePoints = getGradePoints(letterGrade);
        totalPoints += gradePoints * course.creditHours;
        totalCredits += course.creditHours;
      }
    });

    return totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : null;
  };

  const calculateCumulativeGPA = () => {
    if (courses.length === 0) return null;

    let totalPoints = 0;
    let totalCredits = 0;

    courses.forEach(course => {
      const grade = calculateCourseGrade(course);
      if (grade !== null) {
        const letterGrade = getLetterGrade(grade);
        const gradePoints = getGradePoints(letterGrade);
        totalPoints += gradePoints * course.creditHours;
        totalCredits += course.creditHours;
      }
    });

    return totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : null;
  };

  const calculateRequiredScore = (course, desiredGrade) => {
    let currentWeightedScore = 0;
    let currentWeight = 0;

    course.assignments.forEach(assignment => {
      const percentage = (assignment.score / assignment.maxScore) * 100;
      currentWeightedScore += (percentage * assignment.weight);
      currentWeight += assignment.weight;
    });

    const remainingWeight = 100 - currentWeight;
    if (remainingWeight <= 0) return null;

    const requiredWeightedScore = (desiredGrade * 100) - currentWeightedScore;
    const requiredPercentage = requiredWeightedScore / remainingWeight;

    return requiredPercentage;
  };

  const addSemester = (semesterName) => {
    if (!semesters.includes(semesterName)) {
      setSemesters([...semesters, semesterName]);
    }
  };

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 py-12">
          <h1 className="text-4xl md:text-5xl font-bold text-deep-blue mb-4">Grade Calculator & GPA Tracker</h1>
          <p className="text-xl text-gray-700 mb-8">
            Track your grades, calculate weighted scores, run what-if scenarios, and monitor your GPA across semesters.
          </p>

          {/* GPA Summary */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-2xl font-bold text-deep-blue mb-4">GPA Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-purple-gradient text-white rounded-lg p-4">
                <p className="text-sm opacity-90">Cumulative GPA</p>
                <p className="text-3xl font-bold">{calculateCumulativeGPA() || 'N/A'}</p>
              </div>
              <div className="bg-blue-500 text-white rounded-lg p-4">
                <p className="text-sm opacity-90">Current Semester GPA</p>
                <p className="text-3xl font-bold">{calculateSemesterGPA('current') || 'N/A'}</p>
              </div>
              <div className="bg-green-500 text-white rounded-lg p-4">
                <p className="text-sm opacity-90">Total Courses</p>
                <p className="text-3xl font-bold">{courses.length}</p>
              </div>
            </div>
          </div>

          {/* Add Course */}
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h2 className="text-2xl font-bold text-deep-blue mb-4">Add New Course</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              const courseName = formData.get('courseName');
              const creditHours = formData.get('creditHours');
              if (courseName && creditHours) {
                addCourse(courseName, creditHours);
                e.target.reset();
              }
            }} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                type="text"
                name="courseName"
                placeholder="Course Name (e.g., Calculus I)"
                className="border border-gray-300 rounded-lg px-4 py-2"
                required
              />
              <input
                type="number"
                name="creditHours"
                placeholder="Credit Hours"
                min="0.5"
                max="6"
                step="0.5"
                className="border border-gray-300 rounded-lg px-4 py-2"
                required
              />
              <button
                type="submit"
                className="bg-coral-red text-white px-6 py-2 rounded-lg font-semibold hover:bg-opacity-90 transition-all"
              >
                Add Course
              </button>
            </form>
          </div>

          {/* Courses List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {courses.map(course => {
              const currentGrade = calculateCourseGrade(course);
              const whatIfGrade = calculateCourseGrade(course, true);
              const letterGrade = getLetterGrade(currentGrade);

              return (
                <div key={course.id} className="bg-white rounded-lg shadow-md p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-deep-blue">{course.name}</h3>
                      <p className="text-gray-600 text-sm">{course.creditHours} credit hours</p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold text-purple-dark">
                        {currentGrade !== null ? currentGrade.toFixed(1) + '%' : 'N/A'}
                      </p>
                      <p className="text-lg font-semibold text-gray-700">{letterGrade}</p>
                    </div>
                  </div>

                  {/* Assignments */}
                  <div className="mb-4">
                    <h4 className="font-semibold text-gray-700 mb-2">Assignments</h4>
                    {course.assignments.length > 0 ? (
                      <div className="space-y-2">
                        {course.assignments.map(assignment => (
                          <div key={assignment.id} className="flex justify-between items-center bg-gray-50 p-2 rounded">
                            <div className="flex-1">
                              <p className="font-medium text-sm">{assignment.name}</p>
                              <p className="text-xs text-gray-600">
                                {assignment.score}/{assignment.maxScore} ({((assignment.score/assignment.maxScore)*100).toFixed(1)}%) - Weight: {assignment.weight}%
                              </p>
                            </div>
                            <button
                              onClick={() => deleteAssignment(course.id, assignment.id)}
                              className="text-red-500 hover:text-red-700 text-sm ml-2"
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 text-sm">No assignments yet</p>
                    )}
                  </div>

                  {/* Add Assignment */}
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.target);
                    addAssignment(
                      course.id,
                      formData.get('assignmentName'),
                      formData.get('score'),
                      formData.get('maxScore'),
                      formData.get('weight')
                    );
                    e.target.reset();
                  }} className="mb-4">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <input
                        type="text"
                        name="assignmentName"
                        placeholder="Assignment Name"
                        className="border border-gray-300 rounded px-3 py-1 text-sm"
                        required
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          name="score"
                          placeholder="Score"
                          min="0"
                          step="0.1"
                          className="border border-gray-300 rounded px-3 py-1 text-sm"
                          required
                        />
                        <input
                          type="number"
                          name="maxScore"
                          placeholder="Max"
                          min="0"
                          step="0.1"
                          className="border border-gray-300 rounded px-3 py-1 text-sm"
                          required
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        name="weight"
                        placeholder="Weight %"
                        min="0"
                        max="100"
                        step="0.1"
                        className="flex-1 border border-gray-300 rounded px-3 py-1 text-sm"
                        required
                      />
                      <button
                        type="submit"
                        className="bg-purple-dark text-white px-4 py-1 rounded text-sm font-semibold hover:bg-opacity-90"
                      >
                        Add
                      </button>
                    </div>
                  </form>

                  {/* What-if Scenario */}
                  <div className="border-t pt-4 mt-4">
                    <h4 className="font-semibold text-gray-700 mb-2">What-If Scenario</h4>
                    <div className="bg-blue-50 p-3 rounded mb-2">
                      <p className="text-sm text-gray-700 mb-2">Calculate what grade you need on remaining work:</p>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          placeholder="Desired Grade %"
                          min="0"
                          max="100"
                          step="0.1"
                          className="border border-gray-300 rounded px-3 py-1 text-sm"
                          onChange={(e) => {
                            const desired = parseFloat(e.target.value);
                            if (!isNaN(desired)) {
                              const required = calculateRequiredScore(course, desired);
                              if (required !== null) {
                                const msg = required > 100
                                  ? `Not possible with current grades`
                                  : required < 0
                                  ? `Already achieved!`
                                  : `Need ${required.toFixed(1)}% on remaining work`;
                                e.target.nextElementSibling.textContent = msg;
                              }
                            }
                          }}
                        />
                        <p className="text-sm font-semibold text-purple-dark self-center"></p>
                      </div>
                    </div>

                    <p className="text-sm text-gray-600 mb-2">Or add a hypothetical assignment:</p>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        placeholder="Score %"
                        min="0"
                        max="100"
                        step="0.1"
                        value={whatIfScore}
                        onChange={(e) => setWhatIfScore(e.target.value)}
                        className="border border-gray-300 rounded px-3 py-1 text-sm"
                      />
                      <input
                        type="number"
                        placeholder="Weight %"
                        min="0"
                        max="100"
                        step="0.1"
                        value={whatIfWeight}
                        onChange={(e) => setWhatIfWeight(e.target.value)}
                        className="border border-gray-300 rounded px-3 py-1 text-sm"
                      />
                      <div className="text-center">
                        <p className="text-xs text-gray-600">Projected:</p>
                        <p className="font-bold text-purple-dark">
                          {whatIfScore && whatIfWeight && whatIfGrade !== null
                            ? whatIfGrade.toFixed(1) + '%'
                            : 'N/A'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => deleteCourse(course.id)}
                    className="mt-4 text-red-500 hover:text-red-700 text-sm font-semibold"
                  >
                    Delete Course
                  </button>
                </div>
              );
            })}
          </div>

          {courses.length === 0 && (
            <div className="bg-white rounded-lg shadow-md p-12 text-center">
              <h3 className="text-2xl font-bold text-gray-700 mb-4">No Courses Yet</h3>
              <p className="text-gray-600 mb-6">
                Add your first course above to start tracking your grades and GPA.
              </p>
            </div>
          )}

          {/* How to Use */}
          <div className="bg-purple-gradient text-white rounded-lg p-8 mt-12">
            <h2 className="text-2xl font-bold mb-4">How to Use the Grade Calculator</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-bold mb-2">1. Add Your Courses</h3>
                <p className="text-sm opacity-90">Enter course names and credit hours to track each class separately.</p>
              </div>
              <div>
                <h3 className="font-bold mb-2">2. Input Assignments</h3>
                <p className="text-sm opacity-90">Add your assignments with scores and weights to see real-time grade calculations.</p>
              </div>
              <div>
                <h3 className="font-bold mb-2">3. Run What-If Scenarios</h3>
                <p className="text-sm opacity-90">Calculate what grade you need on future assignments to reach your goal.</p>
              </div>
              <div>
                <h3 className="font-bold mb-2">4. Track Your GPA</h3>
                <p className="text-sm opacity-90">Monitor your semester and cumulative GPA automatically as you add grades.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
