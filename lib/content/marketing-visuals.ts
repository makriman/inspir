export type MarketingHeroVisual =
  | "about"
  | "modes"
  | "subjects"
  | "subject-math"
  | "subject-writing"
  | "subject-coding"
  | "subject-history"
  | "subject-exam-prep"
  | "subject-homework"
  | "prompts"
  | "map"
  | "media"
  | "schools"
  | "trust"
  | "compare"
  | "compare-khan-academy-alternative"
  | "audience"
  | "audience-students"
  | "audience-parents"
  | "audience-teachers"
  | "audience-self-taught-learners"
  | "paths"
  | "path-understand-a-hard-topic"
  | "path-get-unstuck-on-homework"
  | "path-prepare-for-an-exam"
  | "path-explore-history-and-ideas"
  | "blog"
  | "blog-ai-tutor"
  | "blog-study-skills"
  | "blog-ai-prompts"
  | "blog-planning"
  | "blog-practice"
  | "blog-humanities"
  | "blog-communication"
  | "blog-thinking"
  | "blog-creativity"
  | "blog-foundations"
  | "blog-immersion"
  | "blog-stem"
  | "blog-argument";

type MarketingHeroVisualAsset = `/media/${string}.jpg`;

export const marketingHeroVisualAssetById = {
  about: "/media/inspir-community-learning.jpg",
  modes: "/media/inspir-visual-modes.jpg",
  subjects: "/media/inspir-visual-subjects.jpg",
  "subject-math": "/media/inspir-visual-subject-math.jpg",
  "subject-writing": "/media/inspir-visual-subject-writing.jpg",
  "subject-coding": "/media/inspir-visual-subject-coding.jpg",
  "subject-history": "/media/inspir-visual-subject-history.jpg",
  "subject-exam-prep": "/media/inspir-visual-subject-exam-prep.jpg",
  "subject-homework": "/media/inspir-visual-subject-homework.jpg",
  prompts: "/media/inspir-visual-prompts.jpg",
  map: "/media/inspir-visual-learning-map.jpg",
  media: "/media/inspir-visual-media.jpg",
  schools: "/media/inspir-school-workshop.jpg",
  trust: "/media/inspir-visual-trust.jpg",
  compare: "/media/inspir-visual-compare.jpg",
  "compare-khan-academy-alternative": "/media/inspir-visual-compare-khan-academy-alternative.jpg",
  audience: "/media/inspir-visual-audience.jpg",
  "audience-students": "/media/inspir-visual-audience-students.jpg",
  "audience-parents": "/media/inspir-visual-audience-parents.jpg",
  "audience-teachers": "/media/inspir-visual-audience-teachers.jpg",
  "audience-self-taught-learners": "/media/inspir-visual-audience-self-taught-learners.jpg",
  paths: "/media/inspir-visual-paths.jpg",
  "path-understand-a-hard-topic": "/media/inspir-visual-path-understand-a-hard-topic.jpg",
  "path-get-unstuck-on-homework": "/media/inspir-visual-path-get-unstuck-on-homework.jpg",
  "path-prepare-for-an-exam": "/media/inspir-visual-path-prepare-for-an-exam.jpg",
  "path-explore-history-and-ideas": "/media/inspir-visual-path-explore-history-and-ideas.jpg",
  blog: "/media/inspir-visual-blog.jpg",
  "blog-ai-tutor": "/media/inspir-visual-blog-ai-tutor.jpg",
  "blog-study-skills": "/media/inspir-visual-blog-study-skills.jpg",
  "blog-ai-prompts": "/media/inspir-visual-blog-ai-prompts.jpg",
  "blog-planning": "/media/inspir-visual-blog-planning.jpg",
  "blog-practice": "/media/inspir-visual-blog-practice.jpg",
  "blog-humanities": "/media/inspir-visual-blog-humanities.jpg",
  "blog-communication": "/media/inspir-visual-blog-communication.jpg",
  "blog-thinking": "/media/inspir-visual-blog-thinking.jpg",
  "blog-creativity": "/media/inspir-visual-blog-creativity.jpg",
  "blog-foundations": "/media/inspir-visual-blog-foundations.jpg",
  "blog-immersion": "/media/inspir-visual-blog-immersion.jpg",
  "blog-stem": "/media/inspir-visual-blog-stem.jpg",
  "blog-argument": "/media/inspir-visual-blog-argument.jpg",
} as const satisfies Record<MarketingHeroVisual, MarketingHeroVisualAsset>;

type SubjectVisualSlug = "math" | "writing" | "coding" | "history" | "exam-prep" | "homework";

export const subjectHeroVisualBySlug = {
  math: "subject-math",
  writing: "subject-writing",
  coding: "subject-coding",
  history: "subject-history",
  "exam-prep": "subject-exam-prep",
  homework: "subject-homework",
} as const satisfies Record<SubjectVisualSlug, MarketingHeroVisual>;

type ComparisonVisualSlug = "khan-academy-alternative";

export const comparisonHeroVisualBySlug = {
  "khan-academy-alternative": "compare-khan-academy-alternative",
} as const satisfies Record<ComparisonVisualSlug, MarketingHeroVisual>;

type AudienceVisualSlug = "students" | "parents" | "teachers" | "self-taught-learners";

export const audienceHeroVisualBySlug = {
  students: "audience-students",
  parents: "audience-parents",
  teachers: "audience-teachers",
  "self-taught-learners": "audience-self-taught-learners",
} as const satisfies Record<AudienceVisualSlug, MarketingHeroVisual>;

type LearningPathVisualSlug =
  | "understand-a-hard-topic"
  | "get-unstuck-on-homework"
  | "prepare-for-an-exam"
  | "explore-history-and-ideas";

export const learningPathHeroVisualBySlug = {
  "understand-a-hard-topic": "path-understand-a-hard-topic",
  "get-unstuck-on-homework": "path-get-unstuck-on-homework",
  "prepare-for-an-exam": "path-prepare-for-an-exam",
  "explore-history-and-ideas": "path-explore-history-and-ideas",
} as const satisfies Record<LearningPathVisualSlug, MarketingHeroVisual>;

type BlogCategoryVisualSlug =
  | "ai-tutor"
  | "study-skills"
  | "ai-prompts"
  | "planning"
  | "practice"
  | "humanities"
  | "communication"
  | "thinking"
  | "creativity"
  | "foundations"
  | "immersion"
  | "stem"
  | "argument";

export const blogCategoryHeroVisualBySlug = {
  "ai-tutor": "blog-ai-tutor",
  "study-skills": "blog-study-skills",
  "ai-prompts": "blog-ai-prompts",
  planning: "blog-planning",
  practice: "blog-practice",
  humanities: "blog-humanities",
  communication: "blog-communication",
  thinking: "blog-thinking",
  creativity: "blog-creativity",
  foundations: "blog-foundations",
  immersion: "blog-immersion",
  stem: "blog-stem",
  argument: "blog-argument",
} as const satisfies Record<BlogCategoryVisualSlug, MarketingHeroVisual>;

function hasOwnKey<T extends object>(record: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function visualForSlug<TMap extends Record<string, MarketingHeroVisual>>(
  slug: string,
  map: TMap,
  fallback: MarketingHeroVisual,
): MarketingHeroVisual {
  return hasOwnKey(map, slug) ? map[slug] : fallback;
}

export function getSubjectHeroVisual(slug: string): MarketingHeroVisual {
  return visualForSlug(slug, subjectHeroVisualBySlug, "subjects");
}

export function getComparisonHeroVisual(slug: string): MarketingHeroVisual {
  return visualForSlug(slug, comparisonHeroVisualBySlug, "compare");
}

export function getAudienceHeroVisual(slug: string): MarketingHeroVisual {
  return visualForSlug(slug, audienceHeroVisualBySlug, "audience");
}

export function getLearningPathHeroVisual(slug: string): MarketingHeroVisual {
  return visualForSlug(slug, learningPathHeroVisualBySlug, "paths");
}

export function getBlogCategoryHeroVisual(slug: string): MarketingHeroVisual {
  return visualForSlug(slug, blogCategoryHeroVisualBySlug, "blog");
}
