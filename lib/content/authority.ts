export const missionPrinciples = [
  {
    title: "Access first",
    text: "A capable learning companion should not depend on geography, family income, or whether a learner already knows the right person to ask.",
  },
  {
    title: "Understanding over answers",
    text: "inspir is designed around reasoning, practice, recall, and explanation instead of handing learners finished work.",
  },
  {
    title: "Mode-specific learning",
    text: "Different learning jobs need different shapes: Socratic questions, homework hints, flashcards, debate, history roleplay, writing critique, and study planning.",
  },
  {
    title: "Public first, school-ready",
    text: "Public guest modes give anyone a useful place to start, while school and partner deployments can adapt the experience for local needs.",
  },
] as const;

export const missionFaqs = [
  {
    question: "What is inspir's mission?",
    answer:
      "inspir exists to make learning accessible, engaging, enjoyable, and useful for anyone with curiosity through free public AI learning tools and school-ready learning spaces.",
  },
  {
    question: "How is inspir different from a generic AI chatbot?",
    answer:
      "inspir organizes AI around learning modes with specific teaching behavior: explanations, Socratic questions, homework hints, quizzes, flashcards, debate, roleplay, writing feedback, and study planning.",
  },
  {
    question: "Can people use inspir without signing in?",
    answer:
      "Yes. Public guest modes such as Learn Anything, Socratic Instruction, Homework Coach, quizzes, and flashcards open directly from simple /chat/{topicSlug} links.",
  },
  {
    question: "Why does inspir support school and partner deployments?",
    answer:
      "The public product keeps learning easy to try, while schools and CSR partners can support tailored deployments when communities need confidentiality, curriculum alignment, or funded access.",
  },
] as const;

export const authorityReferenceLinks = [
  {
    title: "Public learning modes",
    href: "/topics",
    text: "Every guest learning chat, organized by teaching behavior and learning need.",
  },
  {
    title: "Learning paths",
    href: "/learn",
    text: "Study workflows that connect guest modes, prompts, practice, and related guides.",
  },
  {
    title: "AI learning guide library",
    href: "/blog",
    text: "More than 100 guides, prompt loops, and pillar clusters for AI-assisted learning.",
  },
  {
    title: "Schools and partners",
    href: "/schools",
    text: "How public guest learning can extend into school-specific AI learning spaces.",
  },
  {
    title: "Trust and safety",
    href: "/trust",
    text: "A clear explanation of guest mode, private chats, learner safety, and school trust.",
  },
  {
    title: "Media and citations",
    href: "/media",
    text: "Reference links, public facts, press context, and citation-friendly details.",
  },
  {
    title: "About inspir",
    href: "/about",
    text: "The story from quizzes and student communities to free AI learning tools built in public.",
  },
] as const;

export const trustPrinciples = [
  {
    title: "Public learning pages are intentional",
    text: "Public guest-mode links exist so learners can start directly in useful learning modes from search, social links, schools, or shared recommendations.",
  },
  {
    title: "Private saved chats stay private",
    text: "Saved user conversations use private identifiers and should not be treated as public source material.",
  },
  {
    title: "Learning behavior comes first",
    text: "inspir is organized around hints, questions, quizzes, flashcards, debate, review, and explanation instead of passive answer-copying.",
  },
  {
    title: "Public access has boundaries",
    text: "Public pages can be shared and linked, while admin tools, API routes, reset flows, and private utilities stay closed.",
  },
] as const;

export const trustSafeguards = [
  {
    title: "Guest mode entrypoints",
    text: "/chat/{topicSlug} pages open public learning modes such as Learn Anything, Socratic Instruction, Homework Coach, and flashcards.",
    href: "/topics",
  },
  {
    title: "Private conversation boundary",
    text: "Private saved chat links are not part of public learning references, shared indexes, or citation material.",
    href: "/ai-content-index.json",
  },
  {
    title: "Public access policy",
    text: "Public learning pages are open, while API routes, admin routes, reset flows, and private utility pages remain blocked.",
    href: "/robots.txt",
  },
  {
    title: "School deployment pathway",
    text: "Schools can evaluate public modes first, then discuss tailored workflows, confidentiality planning, content needs, and funded access.",
    href: "/schools",
  },
] as const;

export const trustPublicAccessPolicies = [
  {
    name: "Search and directory access",
    status: "Allowed on public pages",
    text: "Public pages, topic chats, learning paths, blog guides, and help pages are designed to be easy to find and share.",
  },
  {
    name: "Assistant and reference access",
    status: "Allowed on public pages",
    text: "Assistant and reference tools can use public learning pages to point people toward the right guides and guest modes.",
  },
  {
    name: "Public reference files",
    status: "Allowed on public pages",
    text: "Public reference files summarize learning pages, routes, modes, guides, and citation boundaries for tools that need a concise map.",
  },
  {
    name: "Private and utility routes",
    status: "Disallowed",
    text: "API, admin, reset, private utility, and private saved-chat surfaces are not public source content.",
  },
] as const;

export const trustReferenceLinks = [
  {
    title: "Privacy policy",
    href: "/privacy",
    text: "The formal privacy page for data use, rights, and public service conditions.",
  },
  {
    title: "Terms",
    href: "/terms",
    text: "The formal terms covering acceptable use, account responsibilities, and service conditions.",
  },
  {
    title: "Public access rules",
    href: "/robots.txt",
    text: "The live access rules for public and private routes.",
  },
  {
    title: "AI content index",
    href: "/ai-content-index.json",
    text: "Structured catalog of public pages, modes, learning paths, blog clusters, and privacy boundaries.",
  },
  {
    title: "Full public reference index",
    href: "/llms-full.txt",
    text: "Text-first reference file for assistants, educators, partners, and citation tools.",
  },
] as const;

export const trustFaqs = [
  {
    question: "Are public guest chats open?",
    answer:
      "Yes. Public topic entrypoints such as /chat/learn-anything and /chat/socratic-instruction are open learning pages that anyone can try.",
  },
  {
    question: "Are private saved user conversations exposed to search?",
    answer:
      "No. Private saved chats use private identifiers and are not part of public pages, public reference files, or shared learning catalogs.",
  },
  {
    question: "Why are public learning pages easy to share?",
    answer:
      "The goal is to help people find the right public learning page quickly. Public routes, guides, and learning hubs are open; API, admin, reset, and private utility routes stay closed.",
  },
  {
    question: "How does inspir reduce answer-copying?",
    answer:
      "The public modes are designed around learning behavior: hints, Socratic questions, step checks, quizzes, flashcards, writing feedback, review loops, and active explanation.",
  },
  {
    question: "Where should schools start?",
    answer:
      "Schools can test public guest modes first, then use the schools page to explore tailored workflows, confidentiality planning, NCERT-aligned options, and funded access.",
  },
] as const;

export const schoolFeatures = [
  {
    title: "White-labelled AI chat",
    text: "A school-specific learning experience can be shaped around your student community, tone, and learning priorities.",
    href: "/chat/learn-anything",
  },
  {
    title: "Confidential deployment design",
    text: "School rollouts can be planned around student privacy, staff oversight, and the practical boundaries a learning community needs.",
    href: "/schools#school-deployment",
  },
  {
    title: "NCERT-aligned options",
    text: "Custom content, prompts, and workflows can be adapted around NCERT needs and school-specific classroom priorities.",
    href: "/schools#school-use-cases",
  },
  {
    title: "Funded access paths",
    text: "AI learning access can be funded by partner schools or supported through CSR sponsorship for communities that need subsidised access.",
    href: "/schools#school-contact",
  },
] as const;

export const schoolDeploymentSteps = [
  {
    slug: "try-public-modes",
    step: "01",
    title: "Try public guest modes",
    text: "Teachers and leaders can start with Learn Anything, Socratic Instruction, Homework Coach, quizzes, and flashcards before a formal rollout.",
    href: "/topics",
  },
  {
    slug: "map-school-needs",
    step: "02",
    title: "Map learning needs",
    text: "Identify the school goals that matter most: conceptual support, homework hints, exam prep, active recall, writing feedback, or enrichment.",
    href: "/schools#school-use-cases",
  },
  {
    slug: "configure-school-workflows",
    step: "03",
    title: "Configure workflows",
    text: "Adapt the student experience around school context, curriculum priorities, content guardrails, and the level of staff visibility needed.",
    href: "/schools#school-features",
  },
  {
    slug: "launch-and-fund-access",
    step: "04",
    title: "Launch and fund access",
    text: "Move from pilot to wider access through school funding, partner support, or CSR pathways for learners who need subsidised access.",
    href: "/schools#school-contact",
  },
] as const;

export const schoolUseCases = [
  {
    title: "Teachers",
    text: "Create a safer route for practice, explanations, feedback, and revision prompts without sending students into a generic chatbot.",
    href: "/chat/socratic-instruction",
  },
  {
    title: "Students",
    text: "Start directly in the right learning mode for homework hints, maths steps, writing critique, quizzes, flashcards, or exam planning.",
    href: "/topics",
  },
  {
    title: "School leaders",
    text: "Evaluate a public AI learning layer first, then explore custom workflows, confidentiality needs, content alignment, and usage funding.",
    href: "/media",
  },
  {
    title: "CSR and education partners",
    text: "Support funded AI learning access for communities that need high-quality support without adding cost to families.",
    href: "/mission",
  },
] as const;

export const schoolSearchIntents = [
  "AI tutor for schools",
  "AI homework coach for students",
  "white label AI learning platform",
  "AI study tools for schools",
  "NCERT aligned AI learning",
  "CSR education technology partnership",
] as const;

export const schoolFaqs = [
  {
    question: "Can a school use inspir as a guest learning tool first?",
    answer:
      "Yes. The public guest modes let school leaders and teachers try the learning experience before discussing a tailored school deployment.",
  },
  {
    question: "Can inspir support school-specific content or curriculum needs?",
    answer:
      "School deployments can be adapted around custom content, workflows, prompts, and NCERT-aligned learning needs where appropriate.",
  },
  {
    question: "How is this different from giving students a generic AI chatbot?",
    answer:
      "inspir is organized around learning modes such as Socratic tutoring, homework hints, quizzes, flashcards, maths steps, writing critique, and exam planning, so students land in a more focused learning behavior.",
  },
  {
    question: "How can access be funded for learners?",
    answer:
      "Access can be funded by partner schools or supported through CSR sponsorship paths for communities that need subsidised AI learning.",
  },
  {
    question: "Can a rollout start small?",
    answer:
      "Yes. A school can begin by testing public modes, then move toward a pilot or tailored deployment when the use case, content needs, and funding path are clear.",
  },
] as const;

export const aboutTimeline = [
  {
    slug: "learning-community",
    year: "2013",
    title: "A learning community begins",
    text: "inspir started as a Facebook page publishing quizzes and building a habit of extracurricular learning.",
  },
  {
    slug: "offline-networks",
    year: "2014-2021",
    title: "Offline networks and student events",
    text: "The community expanded through schools, universities, competitions, extracurricular programmes, and learner communities.",
  },
  {
    slug: "ai-learning-infrastructure",
    year: "2022",
    title: "AI learning infrastructure",
    text: "The platform worked on curriculum ingestion, retrieval, structured learning flows, and early AI tutoring experiences.",
  },
  {
    slug: "consumer-ai-launch",
    year: "Late 2022",
    title: "Consumer AI launch",
    text: "inspir went live as a consumer-facing AI learning product within weeks of ChatGPT's public release.",
  },
  {
    slug: "inspirlearning",
    year: "2023-2025",
    title: "From inspir.app to inspirlearning.com",
    text: "After the inspir.app domain was sold to fund continued free access, the live product moved to inspirlearning.com.",
  },
  {
    slug: "built-in-public",
    year: "Now",
    title: "Built in public",
    text: "The next phase is open-source, contributor-friendly, and connected to the wider international buildout at inspir.uk.",
  },
] as const;

export const aboutProofPoints = [
  {
    title: "Public learning surface",
    text: "Every core learning mode has a public guest entrypoint so people can start from search, social, or a shared link.",
  },
  {
    title: "Mode-specific product design",
    text: "The app is organized around teaching behaviors such as Socratic questioning, homework hints, quizzes, flashcards, roleplay, and planning.",
  },
  {
    title: "Long-form learning library",
    text: "The public blog contains more than 100 guides, prompt loops, and pillar clusters connected to live learning modes.",
  },
  {
    title: "School and partner pathway",
    text: "The public product is easy to try first, while schools and partners can explore tailored deployments for community needs.",
  },
] as const;

export const aboutFaqs = [
  {
    question: "What is inspir?",
    answer:
      "inspir is a free AI learning platform with public guest modes for explanations, Socratic tutoring, homework coaching, quizzes, flashcards, debate, roleplay, writing feedback, and study planning.",
  },
  {
    question: "How did inspir start?",
    answer:
      "inspir began in 2013 as a public quiz and learning community, grew through schools and student networks, and later developed AI learning infrastructure and public AI tutoring experiences.",
  },
  {
    question: "Why is inspir built around modes instead of one chat box?",
    answer:
      "Different learning jobs need different interaction shapes, so inspir uses active, mode-specific teaching. A homework hint, Socratic question, historical simulation, flashcard review, and writing critique should not behave like the same generic chat.",
  },
  {
    question: "What can someone try first?",
    answer:
      "A learner can open Learn Anything, Socratic Instruction, Homework Coach, Math Step Coach, quizzes, or flashcards directly in guest mode from the public learning modes directory.",
  },
] as const;

export const aboutStoryLinks = [
  {
    title: "Mission",
    href: "/mission",
    text: "The public explanation of why inspir exists and why learning access matters.",
  },
  {
    title: "Public learning modes",
    href: "/topics",
    text: "The live learning experience that turns the mission into practical help.",
  },
  {
    title: "AI learning guide library",
    href: "/blog",
    text: "The written learning library that supports prompts, study loops, and deeper practice.",
  },
  {
    title: "Schools and partners",
    href: "/schools",
    text: "The school pathway for tailored AI learning spaces and funded access.",
  },
] as const;

export const mediaHighlights = [
  {
    title: "1M+ learners",
    text: "Reached across the free public platform and partner school deployments.",
  },
  {
    title: "100+ countries",
    text: "A learner base that already extends beyond India into a wider international audience.",
  },
  {
    title: "DeepHack recognition",
    text: "Jury's Choice recognition from Amod Malviya at DeepHack for AI learning work.",
  },
  {
    title: "Built since 2013",
    text: "From Facebook quizzes and offline events to applied AI learning infrastructure.",
  },
] as const;

export const mediaCoverageLinks = [
  {
    href: "https://deccanbusiness.com/where-learning-becomes-universal-inspirs-vision-to-make-education-free-fun-and-accessible-for-everyone/",
    label: "Deccan Business coverage",
    text: "Coverage of inspir's vision for free, accessible education.",
  },
  {
    href: "https://dhunt.in/12OTez",
    label: "Dailyhunt coverage",
    text: "Syndicated coverage for wider consumer reach.",
  },
  {
    href: "https://nirantk.com/community/deephackdemos/",
    label: "DeepHack community page",
    text: "Community page connected to DeepHack recognition.",
  },
  {
    href: "https://inspir.uk",
    label: "inspir.uk next-generation buildout",
    text: "The wider international buildout connected to the inspir project.",
  },
] as const;

export const mediaOfficialLinks = [
  {
    href: "/mission",
    title: "Mission",
    text: "The public statement of why inspir exists and what learning access means.",
  },
  {
    href: "/topics",
    title: "Public AI learning modes",
    text: "A clear directory of every guest learning chat entrypoint.",
  },
  {
    href: "/blog",
    title: "AI learning blog",
    text: "More than 100 guides on tutoring, prompts, study loops, active recall, and modes.",
  },
  {
    href: "https://github.com/greatindiancompany/ai-study-platform",
    title: "Current GitHub repo",
    text: "The open-source rebuild for developers, educators, and contributors.",
  },
] as const;

export const mediaLinkingTargets = [
  {
    title: "Primary homepage citation",
    anchorText: "free AI learning platform",
    href: "/",
    text: "Use this when introducing inspir as the main product or linking from a directory, profile, or article.",
  },
  {
    title: "Public learning modes",
    anchorText: "public AI learning modes",
    href: "/topics",
    text: "Use this when describing the full set of guest-mode learning tools people can try immediately.",
  },
  {
    title: "Default guest tutor",
    anchorText: "AI tutor for learning anything",
    href: "/chat/learn-anything",
    text: "Use this when linking readers straight into the live learning experience.",
  },
  {
    title: "AI learning guide library",
    anchorText: "AI learning guides",
    href: "/blog",
    text: "Use this when citing the long-form guide library, study prompts, and mode-specific articles.",
  },
  {
    title: "Schools and CSR partners",
    anchorText: "AI tutor for schools",
    href: "/schools",
    text: "Use this for school, partner, CSR, and education access references.",
  },
  {
    title: "Trust and privacy boundaries",
    anchorText: "public AI learning trust policy",
    href: "/trust",
    text: "Use this when referencing public/private boundaries, learner safety, and school trust.",
  },
] as const;

export const mediaCitationSnippets = [
  {
    title: "Short description",
    text: "inspir is a free AI learning platform with public guest modes for explanations, Socratic tutoring, homework coaching, quizzes, flashcards, debate, writing feedback, coding help, and study planning.",
    href: "/",
  },
  {
    title: "Product angle",
    text: "Unlike a generic chatbot, inspir organizes AI around learning modes so learners can start with the kind of help they need: hints, questions, quizzes, active recall, roleplay, debate, or feedback.",
    href: "/topics",
  },
  {
    title: "Guest-mode angle",
    text: "inspir makes learning modes open at /chat/{topicSlug}, letting learners land directly inside the right AI learning experience without needing a saved private chat.",
    href: "/trust",
  },
  {
    title: "School angle",
    text: "Schools can evaluate inspir through public guest modes first, then explore tailored AI learning spaces with custom workflows, confidentiality planning, curriculum needs, and funded access paths.",
    href: "/schools",
  },
] as const;

export const mediaAttributionFacts = [
  ["Name", "inspir"],
  ["Website", "https://inspirlearning.com"],
  ["Category", "Free AI learning platform"],
  ["Founded", "2013"],
  ["Primary audience", "Learners, parents, teachers, schools, and self-taught builders"],
  ["Public entrypoint", "/chat/learn-anything"],
] as const;

export const mediaStoryAngles = [
  {
    title: "AI learning without passive answer-copying",
    text: "inspir organizes AI around active learning behaviors: hints, questions, quizzes, flashcards, critique, and review.",
    href: "/blog/how-to-study-with-ai-without-cheating-yourself",
  },
  {
    title: "Public guest mode as a better first click",
    text: "Each learning mode has a public link so learners can start directly inside the right learning experience.",
    href: "/topics",
  },
  {
    title: "From student community to AI learning infrastructure",
    text: "The story spans quizzes, offline school networks, curriculum ingestion, and public AI learning modes.",
    href: "/about",
  },
  {
    title: "School and CSR pathways for funded access",
    text: "Schools and partners can build from the public product toward tailored, confidential, and subsidized deployments.",
    href: "/schools",
  },
] as const;

export const mediaFaqs = [
  {
    question: "What is the short description of inspir?",
    answer:
      "inspir is a free AI learning platform with public guest modes for explanations, Socratic tutoring, homework coaching, quizzes, flashcards, debate, roleplay, writing feedback, and study planning.",
  },
  {
    question: "Which URL should articles link to first?",
    answer:
      "Use https://inspirlearning.com for the site, /mission for the mission, /topics for the public learning mode directory, and /chat/learn-anything for the default guest learning experience.",
  },
  {
    question: "What is the most useful product angle for coverage?",
    answer:
      "The strongest angle is free public AI learning that opens directly in guest mode and keeps learners active through mode-specific teaching rather than generic answer generation.",
  },
  {
    question: "Who can use the media page?",
    answer:
      "Journalists, directory editors, partners, schools, and anyone writing about inspir can use it for facts, links, story angles, and citation-friendly references.",
  },
] as const;
