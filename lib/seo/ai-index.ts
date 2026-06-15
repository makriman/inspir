import {
  estimateBlogReadingMinutes,
  extractBlogHeadings,
  getBlogCategories,
  getBlogPostTopic,
  getBlogPosts,
  type BlogCategory,
  type BlogPost,
} from "@/lib/content/blog";
import {
  estimateBlogIndexedReadingMinutes,
  estimateBlogIndexedWordCount,
  getBlogPostDepth,
} from "@/lib/content/blog-depth";
import {
  audienceHubFaqs,
  audienceHubSearchIntents,
  audiencePath,
  getAudiencePageResources,
  getAudiencePages,
} from "@/lib/content/audiences";
import {
  aboutFaqs,
  aboutProofPoints,
  aboutStoryLinks,
  aboutTimeline,
  authorityReferenceLinks,
  mediaAttributionFacts,
  mediaCitationSnippets,
  mediaCoverageLinks,
  mediaFaqs,
  mediaHighlights,
  mediaLinkingTargets,
  mediaOfficialLinks,
  mediaStoryAngles,
  missionFaqs,
  missionPrinciples,
  schoolDeploymentSteps,
  schoolFaqs,
  schoolFeatures,
  schoolSearchIntents,
  schoolUseCases,
  trustFaqs,
  trustPrinciples,
  trustPublicAccessPolicies,
  trustReferenceLinks,
  trustSafeguards,
} from "@/lib/content/authority";
import {
  blogHubFaqs,
  getBlogCategoryFaqs,
  getBlogCategoryFeaturedPosts,
  getBlogCategoryProfile,
  getBlogCategoryRelatedModes,
  getBlogPillarClusters,
} from "@/lib/content/blog-directory";
import { getBlogPostLearningGraph } from "@/lib/content/blog-link-graph";
import { getBlogPostPracticePlan } from "@/lib/content/blog-practice";
import {
  comparisonHubFaqs,
  comparisonHubSearchIntents,
  comparisonPath,
  getComparisonPageResources,
  getComparisonPages,
} from "@/lib/content/comparisons";
import { homepageFilm, homepageLearningPaths, learningPathHref, type HomepageLearningPath } from "@/lib/content/landing";
import {
  getLearningMapWorkflows,
  learningMapFaqs,
  learningMapSearchIntents,
} from "@/lib/content/learning-map";
import {
  getPromptCategoryHubs,
  getPromptEntries,
  getPromptSpotlightEntries,
  promptLibraryFaqs,
  promptLibrarySearchIntents,
} from "@/lib/content/prompt-library";
import {
  getSubjectPageResources,
  getSubjectPages,
  subjectHubFaqs,
  subjectHubSearchIntents,
  subjectPath,
} from "@/lib/content/subjects";
import { getTopicCategoryHubs, topicDirectoryFaqs } from "@/lib/content/topic-directory";
import { getTopicSeo } from "@/lib/content/topic-seo";
import { topicSeeds, type TopicSeed } from "@/lib/content/topics";
import { topicPath } from "@/lib/content/topic-routing";
import { absoluteUrl, siteDescription, siteName, siteUrl } from "@/lib/seo/config";

const contentLastUpdated = "2026-05-29";

const publicPages = [
  {
    name: "Home",
    url: absoluteUrl("/"),
    purpose: "Primary entry point for free AI learning, guest mode, and the most useful learning paths.",
  },
  {
    name: "Mission",
    url: absoluteUrl("/mission"),
    purpose: "Explains the mission, access model, and why inspir exists.",
  },
  {
    name: "Learning modes",
    url: absoluteUrl("/topics"),
    purpose: "Server-rendered directory of all public guest learning modes.",
  },
  {
    name: "Subject learning hubs",
    url: absoluteUrl("/subjects"),
    purpose: "Subject-specific AI tutor hubs for math, writing, coding, history, homework, and exam prep.",
  },
  {
    name: "AI prompt library",
    url: absoluteUrl("/prompts"),
    purpose: "Crawlable starter prompt library that routes learners into the right public guest mode.",
  },
  {
    name: "AI learning map",
    url: absoluteUrl("/ai-learning-map"),
    purpose: "Intent-based map connecting public modes, prompts, learning paths, and guides.",
  },
  {
    name: "AI tutor comparisons",
    url: absoluteUrl("/compare"),
    purpose: "Fair comparison hub for learners choosing between known learning tools and live AI learning modes.",
  },
  {
    name: "Audience learning paths",
    url: absoluteUrl("/for"),
    purpose: "Audience-specific AI learning routes for students, parents, teachers, and self-taught learners.",
  },
  {
    name: "Learning paths",
    url: absoluteUrl("/learn"),
    purpose: "Search-friendly study workflows that connect public modes, prompts, and related guides.",
  },
  {
    name: "Schools",
    url: absoluteUrl("/schools"),
    purpose: "Information for schools, teachers, and education partners.",
  },
  {
    name: "Blog",
    url: absoluteUrl("/blog"),
    purpose: "Long-form learning guides, study methods, AI tutor examples, and mode-specific SEO clusters.",
  },
  {
    name: "Media",
    url: absoluteUrl("/media"),
    purpose: "Press, official assets, story, and public media references.",
  },
  {
    name: "Trust",
    url: absoluteUrl("/trust"),
    purpose: "Public explanation of guest mode, private chats, crawler policy, learner safety, and school trust.",
  },
  {
    name: "About",
    url: absoluteUrl("/about"),
    purpose: "Company and product background.",
  },
];

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function markdownList(items: readonly string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function learningFilmIndex() {
  return {
    title: homepageFilm.title,
    pageUrl: absoluteUrl("/"),
    url: absoluteUrl("/#learning-film"),
    contentUrl: absoluteUrl(homepageFilm.contentUrl),
    captionUrl: absoluteUrl(homepageFilm.captionUrl),
    chaptersUrl: absoluteUrl(homepageFilm.chaptersUrl),
    thumbnailUrl: absoluteUrl(homepageFilm.thumbnailUrl),
    description: homepageFilm.description,
    duration: homepageFilm.duration,
    uploadDate: homepageFilm.uploadDate,
    transcript: homepageFilm.transcript,
    chapters: homepageFilm.chapters.map((chapter, index) => ({
      title: chapter.title,
      start: chapter.start,
      end: chapter.end,
      text: chapter.text,
      url: absoluteUrl(`/#learning-film-chapter-${index + 1}`),
    })),
  };
}

function topicDirectoryIndex() {
  const categoryHubs = getTopicCategoryHubs();

  return {
    url: absoluteUrl("/topics"),
    canonicalUrl: absoluteUrl("/topics"),
    modeCount: topicSeeds.length,
    categoryCount: categoryHubs.length,
    faq: topicDirectoryFaqs,
    categories: categoryHubs.map((hub) => ({
      slug: hub.slug,
      name: hub.name,
      url: absoluteUrl(hub.href),
      description: hub.description,
      bestFor: hub.bestFor,
      searchIntents: hub.searchIntents,
      modeCount: hub.modeCount,
      featuredModes: hub.featuredModes.map((mode) => ({
        name: mode.name,
        url: absoluteUrl(mode.href),
        description: mode.description,
        starterPrompts: mode.starterPrompts,
      })),
    })),
  };
}

function promptLibraryIndex() {
  const entries = getPromptEntries();
  const categoryHubs = getPromptCategoryHubs();
  const spotlightEntries = getPromptSpotlightEntries();

  return {
    url: absoluteUrl("/prompts"),
    canonicalUrl: absoluteUrl("/prompts"),
    promptCount: entries.length,
    modeCount: topicSeeds.length,
    categoryCount: categoryHubs.length,
    searchIntents: promptLibrarySearchIntents,
    faq: promptLibraryFaqs,
    featuredPrompts: spotlightEntries.map((entry) => ({
      id: entry.id,
      prompt: entry.prompt,
      topicName: entry.topicName,
      topicSlug: entry.topicSlug,
      category: entry.category,
      uiMode: entry.uiMode,
      url: absoluteUrl(entry.href),
      description: entry.description,
    })),
    categories: categoryHubs.map((hub) => ({
      slug: hub.slug,
      name: hub.name,
      url: absoluteUrl(hub.href),
      description: hub.description,
      bestFor: hub.bestFor,
      searchIntents: hub.searchIntents,
      promptCount: hub.promptCount,
      modeCount: hub.modeCount,
      prompts: hub.prompts.map((entry) => ({
        id: entry.id,
        prompt: entry.prompt,
        topicName: entry.topicName,
        topicSlug: entry.topicSlug,
        category: entry.category,
        uiMode: entry.uiMode,
        url: absoluteUrl(entry.href),
        description: entry.description,
      })),
    })),
  };
}

function learningMapIndex() {
  const workflows = getLearningMapWorkflows();

  return {
    url: absoluteUrl("/ai-learning-map"),
    canonicalUrl: absoluteUrl("/ai-learning-map"),
    workflowCount: workflows.length,
    searchIntents: learningMapSearchIntents,
    faq: learningMapFaqs,
    workflows: workflows.map((workflow) => ({
      slug: workflow.slug,
      title: workflow.title,
      url: absoluteUrl(`/ai-learning-map#${workflow.slug}`),
      description: workflow.description,
      audience: workflow.audience,
      outcome: workflow.outcome,
      searchIntents: workflow.searchIntents,
      path: workflow.path
        ? {
            title: workflow.path.title,
            url: absoluteUrl(workflow.path.href),
            description: workflow.path.description,
          }
        : null,
      modes: workflow.modes.map((mode) => ({
        slug: mode.slug,
        name: mode.name,
        url: absoluteUrl(mode.href),
        description: mode.description,
        starterPrompts: mode.starterPrompts,
      })),
      prompts: workflow.prompts.map((prompt) => ({
        id: prompt.id,
        prompt: prompt.prompt,
        topicName: prompt.topicName,
        url: absoluteUrl(prompt.href),
        description: prompt.description,
      })),
      guides: workflow.guides.map((guide) => ({
        title: guide.title,
        url: absoluteUrl(guide.href),
        description: guide.description,
      })),
      reviewLoop: workflow.reviewLoop,
    })),
  };
}

function comparisonIndex() {
  const pages = getComparisonPages();

  return {
    url: absoluteUrl("/compare"),
    canonicalUrl: absoluteUrl("/compare"),
    pageCount: pages.length,
    searchIntents: comparisonHubSearchIntents,
    faq: comparisonHubFaqs,
    pages: pages.map((page) => {
      const resources = getComparisonPageResources(page);

      return {
        slug: page.slug,
        title: page.seoTitle,
        url: absoluteUrl(comparisonPath(page.slug)),
        description: page.description,
        competitorName: page.competitorName,
        shortAnswer: page.shortAnswer,
        balancedPosition: page.balancedPosition,
        searchIntents: page.searchIntents,
        bestFor: page.bestFor,
        comparisonRows: page.comparisonRows,
        useCases: page.useCases.map((useCase) => ({
          title: useCase.title,
          description: useCase.text,
          url: absoluteUrl(useCase.href),
        })),
        modes: resources.modes.map((mode) => ({
          slug: mode.slug,
          name: mode.name,
          url: absoluteUrl(mode.href),
          description: mode.description,
          starters: mode.starters,
        })),
        guides: resources.guides.map((guide) => ({
          title: guide.title,
          url: absoluteUrl(guide.href),
          description: guide.description,
        })),
        workflows: resources.workflows.map((workflow) => ({
          title: workflow.title,
          url: absoluteUrl(workflow.href),
          description: workflow.description,
        })),
        officialReferences: page.officialReferences.map((reference) => ({
          title: reference.title,
          url: absoluteUrl(reference.href),
          description: reference.text,
        })),
        faq: page.faqs,
      };
    }),
  };
}

function audienceIndex() {
  const pages = getAudiencePages();

  return {
    url: absoluteUrl("/for"),
    canonicalUrl: absoluteUrl("/for"),
    pageCount: pages.length,
    searchIntents: audienceHubSearchIntents,
    faq: audienceHubFaqs,
    pages: pages.map((page) => {
      const resources = getAudiencePageResources(page);

      return {
        slug: page.slug,
        role: page.role,
        title: page.seoTitle,
        url: absoluteUrl(audiencePath(page.slug)),
        description: page.description,
        summary: page.summary,
        why: page.why,
        searchIntents: page.searchIntents,
        jobs: page.jobs.map((job) => ({
          title: job.title,
          description: job.text,
          url: absoluteUrl(job.href),
        })),
        modes: resources.modes.map((mode) => ({
          slug: mode.slug,
          name: mode.name,
          url: absoluteUrl(mode.href),
          description: mode.description,
          starters: mode.starters,
        })),
        paths: resources.paths.map((path) => ({
          title: path.title,
          url: absoluteUrl(path.href),
          description: path.description,
        })),
        workflows: resources.workflows.map((workflow) => ({
          title: workflow.title,
          url: absoluteUrl(workflow.href),
          description: workflow.description,
        })),
        guides: resources.guides.map((guide) => ({
          title: guide.title,
          url: absoluteUrl(guide.href),
          description: guide.description,
        })),
        safeguards: page.safeguards,
        faq: page.faqs,
      };
    }),
  };
}

function subjectIndex() {
  const pages = getSubjectPages();

  return {
    url: absoluteUrl("/subjects"),
    canonicalUrl: absoluteUrl("/subjects"),
    pageCount: pages.length,
    searchIntents: subjectHubSearchIntents,
    faq: subjectHubFaqs,
    pages: pages.map((page) => {
      const resources = getSubjectPageResources(page);

      return {
        slug: page.slug,
        subjectArea: page.subjectArea,
        title: page.seoTitle,
        url: absoluteUrl(subjectPath(page.slug)),
        description: page.description,
        summary: page.summary,
        why: page.why,
        searchIntents: page.searchIntents,
        jobs: page.jobs.map((job) => ({
          title: job.title,
          description: job.text,
          url: absoluteUrl(job.href),
        })),
        modes: resources.modes.map((mode) => ({
          slug: mode.slug,
          name: mode.name,
          url: absoluteUrl(mode.href),
          description: mode.description,
          starters: mode.starters,
        })),
        prompts: resources.prompts.map((prompt) => ({
          id: prompt.id,
          prompt: prompt.prompt,
          topicName: prompt.topicName,
          url: absoluteUrl(prompt.href),
          description: prompt.description,
        })),
        paths: resources.paths.map((path) => ({
          title: path.title,
          url: absoluteUrl(path.href),
          description: path.description,
        })),
        workflows: resources.workflows.map((workflow) => ({
          title: workflow.title,
          url: absoluteUrl(workflow.href),
          description: workflow.description,
        })),
        guides: resources.guides.map((guide) => ({
          title: guide.title,
          url: absoluteUrl(guide.href),
          description: guide.description,
        })),
        reviewLoop: page.reviewLoop,
        faq: page.faqs,
      };
    }),
  };
}

function authorityIndex() {
  return {
    about: {
      url: absoluteUrl("/about"),
      canonicalUrl: absoluteUrl("/about"),
      summary:
        "The story of inspir, from a public quiz community to a free AI learning platform with guest learning modes and school pathways.",
      timeline: aboutTimeline.map((item) => ({
        year: item.year,
        title: item.title,
        url: absoluteUrl(`/about#${item.slug}`),
        description: item.text,
      })),
      proofPoints: aboutProofPoints,
      faq: aboutFaqs,
      referenceLinks: aboutStoryLinks.map((link) => ({
        title: link.title,
        url: absoluteUrl(link.href),
        description: link.text,
      })),
    },
    media: {
      url: absoluteUrl("/media"),
      canonicalUrl: absoluteUrl("/media"),
      summary:
        "A citation-friendly media and press page with facts, official reference links, external coverage, story angles, and short descriptions for journalists, directories, partners, and AI summaries.",
      highlights: mediaHighlights,
      attributionFacts: mediaAttributionFacts.map(([label, value]) => ({ label, value })),
      officialLinks: mediaOfficialLinks.map((link) => ({
        title: link.title,
        url: absoluteUrl(link.href),
        description: link.text,
      })),
      coverageLinks: mediaCoverageLinks.map((link) => ({
        title: link.label,
        url: absoluteUrl(link.href),
        description: link.text,
      })),
      storyAngles: mediaStoryAngles.map((angle) => ({
        title: angle.title,
        url: absoluteUrl(angle.href),
        description: angle.text,
      })),
      linkingTargets: mediaLinkingTargets.map((target) => ({
        title: target.title,
        anchorText: target.anchorText,
        url: absoluteUrl(target.href),
        description: target.text,
      })),
      citationSnippets: mediaCitationSnippets.map((snippet) => ({
        title: snippet.title,
        url: absoluteUrl(snippet.href),
        text: snippet.text,
      })),
      faq: mediaFaqs,
    },
    schools: {
      url: absoluteUrl("/schools"),
      canonicalUrl: absoluteUrl("/schools"),
      summary:
        "A school and partner pathway for white-labelled AI tutoring, public guest-mode evaluation, custom workflows, confidentiality planning, NCERT-aligned options, and funded access.",
      features: schoolFeatures.map((feature) => ({
        title: feature.title,
        url: absoluteUrl(feature.href),
        description: feature.text,
      })),
      deploymentSteps: schoolDeploymentSteps.map((step) => ({
        step: step.step,
        slug: step.slug,
        title: step.title,
        url: absoluteUrl(step.href),
        description: step.text,
      })),
      useCases: schoolUseCases.map((useCase) => ({
        title: useCase.title,
        url: absoluteUrl(useCase.href),
        description: useCase.text,
      })),
      searchIntents: schoolSearchIntents,
      faq: schoolFaqs,
    },
    trust: {
      url: absoluteUrl("/trust"),
      canonicalUrl: absoluteUrl("/trust"),
      summary:
        "A public trust center explaining guest mode, private saved chats, public access, learner safety, school trust, and the boundaries between public pages and private user content.",
      principles: trustPrinciples,
      safeguards: trustSafeguards.map((item) => ({
        title: item.title,
        url: absoluteUrl(item.href),
        description: item.text,
      })),
      publicAccessPolicies: trustPublicAccessPolicies,
      referenceLinks: trustReferenceLinks.map((link) => ({
        title: link.title,
        url: absoluteUrl(link.href),
        description: link.text,
      })),
      faq: trustFaqs,
    },
    mission: {
      url: absoluteUrl("/mission"),
      canonicalUrl: absoluteUrl("/mission"),
      summary:
        "inspir's mission is to make learning accessible, engaging, enjoyable, and useful through free public AI learning tools and school-ready learning spaces.",
      principles: missionPrinciples,
      faq: missionFaqs,
      referenceLinks: authorityReferenceLinks.map((link) => ({
        title: link.title,
        url: absoluteUrl(link.href),
        description: link.text,
      })),
    },
    publicAuthorityPages: authorityReferenceLinks.map((link) => ({
      title: link.title,
      url: absoluteUrl(link.href),
      description: link.text,
    })),
  };
}

function relatedPostsForTopic(topic: TopicSeed, posts: BlogPost[]) {
  return posts
    .filter((post) => getBlogPostTopic(post)?.slug === topic.slug)
    .slice(0, 6)
    .map((post) => ({
      title: post.title,
      url: absoluteUrl(`/blog/${post.slug}`),
      description: post.description,
    }));
}

function modeIndex(topic: TopicSeed, posts: BlogPost[]) {
  const seo = getTopicSeo(topic);

  return {
    slug: topic.slug,
    name: topic.name,
    url: absoluteUrl(topicPath(topic.slug)),
    canonicalUrl: absoluteUrl(topicPath(topic.slug)),
    category: topic.metadata.category,
    uiMode: topic.metadata.uiMode,
    summary: topic.subText,
    description: cleanText(seo.description),
    helps: cleanText(seo.who),
    whyItIsDifferent: cleanText(seo.whyDifferent),
    outcomes: seo.outcomes,
    searchIntents: seo.searchIntents,
    starterPrompts: topic.metadata.starters,
    relatedGuides: relatedPostsForTopic(topic, posts),
  };
}

function blogPostIndex(post: BlogPost) {
  const topic = getBlogPostTopic(post);
  const headings = extractBlogHeadings(post);
  const learningGraph = getBlogPostLearningGraph(post);
  const practicePlan = getBlogPostPracticePlan(post);
  const editorialDepth = getBlogPostDepth(post);

  return {
    slug: post.slug,
    title: post.title,
    url: absoluteUrl(`/blog/${post.slug}`),
    canonicalUrl: absoluteUrl(`/blog/${post.slug}`),
    description: cleanText(post.description),
    datePublished: post.date,
    dateModified: post.updated ?? post.date,
    sourceWordCount: wordCount(post.body),
    wordCount: estimateBlogIndexedWordCount(post),
    indexedWordCount: estimateBlogIndexedWordCount(post),
    sourceReadingMinutes: estimateBlogReadingMinutes(post),
    readingMinutes: estimateBlogIndexedReadingMinutes(post),
    headings: headings.slice(0, 12).map((heading) => ({
      id: heading.id,
      level: heading.level,
      title: heading.title,
      url: absoluteUrl(`/blog/${post.slug}#${heading.id}`),
    })),
    tags: post.tags,
    relatedMode: topic
      ? {
          slug: topic.slug,
          name: topic.name,
          url: absoluteUrl(topicPath(topic.slug)),
        }
      : null,
    learningActions: learningGraph.primaryLinks.map((link) => ({
      kind: link.kind,
      title: link.title,
      url: absoluteUrl(link.href),
      description: cleanText(link.description),
    })),
    learningGraph: learningGraph.secondaryLinks.map((link) => ({
      kind: link.kind,
      title: link.title,
      url: absoluteUrl(link.href),
      description: cleanText(link.description),
    })),
    editorialDepth: {
      title: editorialDepth.title,
      summary: cleanText(editorialDepth.intro),
      sections: editorialDepth.sections.map((section) => ({
        title: section.title,
        summary: cleanText(section.paragraphs.join(" ")),
        checks: section.bullets,
        routes: section.links.map((link) => ({
          title: link.title,
          url: absoluteUrl(link.href),
          description: cleanText(link.description),
        })),
      })),
    },
    practicePlan: {
      title: practicePlan.title,
      summary: cleanText(practicePlan.intro),
      totalTime: "PT12M",
      steps: practicePlan.steps.map((step) => ({
        title: step.title,
        text: cleanText(step.text),
      })),
      checks: practicePlan.checks,
      routes: practicePlan.routes.map((route) => ({
        kind: route.kind,
        title: route.title,
        url: absoluteUrl(route.href),
      })),
    },
  };
}

function categoryIndex(category: BlogCategory) {
  const profile = getBlogCategoryProfile(category);
  const relatedModes = getBlogCategoryRelatedModes(category);
  const featuredPosts = getBlogCategoryFeaturedPosts(category);

  return {
    slug: category.slug,
    name: category.name,
    url: absoluteUrl(`/blog/category/${category.slug}`),
    postCount: category.count,
    title: profile.title,
    description: profile.description,
    audience: profile.audience,
    outcome: profile.outcome,
    searchIntents: profile.searchIntents,
    workflows: profile.workflows.map((workflow, index) => ({
      title: workflow.title,
      url: absoluteUrl(workflow.href),
      anchorUrl: absoluteUrl(`/blog/category/${category.slug}#workflow-${index + 1}`),
      description: workflow.text,
    })),
    relatedModes: relatedModes.map((mode) => ({
      slug: mode.slug,
      name: mode.name,
      url: absoluteUrl(mode.href),
      description: mode.description,
      relatedGuideCount: mode.count,
    })),
    featuredPosts: featuredPosts.map((post) => ({
      title: post.title,
      url: absoluteUrl(`/blog/${post.slug}`),
      description: cleanText(post.description),
    })),
    faq: getBlogCategoryFaqs(category),
    articleSample: category.posts.slice(0, 12).map((post) => ({
      title: post.title,
      url: absoluteUrl(`/blog/${post.slug}`),
      description: cleanText(post.description),
    })),
  };
}

function blogDirectoryIndex(posts: BlogPost[], categories: BlogCategory[]) {
  const categoryLookup = new Map(categories.map((category) => [category.slug, category]));
  const pillarClusters = getBlogPillarClusters(posts);

  return {
    url: absoluteUrl("/blog"),
    canonicalUrl: absoluteUrl("/blog"),
    description:
      "The inspir AI learning guide library connects article clusters, public learning modes, prompt loops, and practical study workflows.",
    faq: blogHubFaqs,
    pillarClusters: pillarClusters.map((cluster) => ({
      slug: cluster.slug,
      title: cluster.title,
      url: absoluteUrl(`/blog#${cluster.slug}`),
      description: cluster.description,
      audience: cluster.audience,
      category: {
        name: cluster.categoryLabel,
        url: absoluteUrl(cluster.categoryHref),
        postCount: categoryLookup.get(cluster.categoryHref.replace(/^\/blog\/category\//, ""))?.count ?? null,
      },
      liveMode: {
        name: cluster.modeLabel,
        url: absoluteUrl(cluster.modeHref),
      },
      guides: cluster.guides.map((guide) => ({
        title: guide.title,
        url: absoluteUrl(guide.href),
        description: guide.description,
        relatedMode: guide.relatedMode
          ? {
              name: guide.relatedMode.name,
              url: absoluteUrl(guide.relatedMode.href),
            }
          : null,
      })),
    })),
  };
}

function learningPathIndex(path: HomepageLearningPath) {
  return {
    slug: path.slug,
    name: path.title,
    url: absoluteUrl(learningPathHref(path.slug)),
    description: cleanText(path.seoDescription),
    audience: cleanText(path.audience),
    outcome: cleanText(path.outcome),
    proofPoints: path.proofPoints,
    searchIntents: path.searchIntents,
    steps: path.steps.map((step) => ({
      title: step.title,
      description: cleanText(step.text),
      url: absoluteUrl(step.href),
    })),
    examplePrompts: path.examplePrompts.map((prompt) => ({
      title: prompt.title,
      prompt: prompt.text,
      url: absoluteUrl(prompt.href),
    })),
    mistakesToAvoid: path.avoid,
    reviewLoop: path.reviewLoop.map((step) => ({
      title: step.title,
      description: cleanText(step.text),
      url: absoluteUrl(step.href),
    })),
    publicModes: path.links.map((link) => ({
      label: link.label,
      url: absoluteUrl(link.href),
    })),
    relatedGuides: path.relatedBlogSlugs.map((slug) => absoluteUrl(`/blog/${slug}`)),
  };
}

export function buildAiContentIndex() {
  const posts = getBlogPosts();
  const categories = getBlogCategories();

  return {
    "@context": "https://schema.org",
    "@type": "DataCatalog",
    name: `${siteName} AI learning content index`,
    url: absoluteUrl("/ai-content-index.json"),
    description: siteDescription,
    inLanguage: "en",
    dateModified: contentLastUpdated,
    publisher: {
      "@type": "Organization",
      name: siteName,
      url: siteUrl,
    },
    discovery: {
      sitemap: absoluteUrl("/sitemap.xml"),
      robots: absoluteUrl("/robots.txt"),
      llms: absoluteUrl("/llms.txt"),
      llmsFull: absoluteUrl("/llms-full.txt"),
      rss: absoluteUrl("/rss.xml"),
      publicModesHub: absoluteUrl("/topics"),
      subjectHubs: absoluteUrl("/subjects"),
      promptLibrary: absoluteUrl("/prompts"),
      learningMap: absoluteUrl("/ai-learning-map"),
      comparisons: absoluteUrl("/compare"),
      audiencePaths: absoluteUrl("/for"),
      defaultGuestMode: absoluteUrl(topicPath("learn-anything")),
    },
    authority: authorityIndex(),
    indexingPolicy: {
      publicGuestModes: "Public learning entrypoints are canonical at /chat/{topicSlug}.",
      privateSavedChats: "Saved user conversations use non-public identifiers, require the right session, and are excluded from discovery surfaces.",
      userContent: "User transcripts, account data, admin tools, password reset flows, and service endpoints are not public source content.",
      historicalPersonaCaution:
        "Historical and persona modes are learning simulations. Generated dialogue should not be cited as authenticated quotation.",
    },
    publicPages,
    featuredLearningFilm: learningFilmIndex(),
    topicDirectory: topicDirectoryIndex(),
    promptLibrary: promptLibraryIndex(),
    learningMap: learningMapIndex(),
    comparisons: comparisonIndex(),
    audiencePaths: audienceIndex(),
    subjectHubs: subjectIndex(),
    learningPaths: homepageLearningPaths.map(learningPathIndex),
    publicLearningModes: topicSeeds.map((topic) => modeIndex(topic, posts)),
    blog: {
      postCount: posts.length,
      categoryCount: categories.length,
      directory: blogDirectoryIndex(posts, categories),
      posts: posts.map(blogPostIndex),
      categories: categories.map(categoryIndex),
    },
  };
}

export function buildLlmsTxt() {
  const index = buildAiContentIndex();

  return [
    `# ${siteName}`,
    "",
    siteDescription,
    "",
    "## Canonical discovery files",
    `- Sitemap: ${index.discovery.sitemap}`,
    `- Robots: ${index.discovery.robots}`,
    `- RSS feed: ${index.discovery.rss}`,
    `- Full AI-readable index: ${index.discovery.llmsFull}`,
    `- JSON content catalog: ${index.url}`,
    `- AI prompt library: ${index.discovery.promptLibrary}`,
    `- AI learning map: ${index.discovery.learningMap}`,
    `- AI tutor comparisons: ${index.discovery.comparisons}`,
    `- Audience learning paths: ${index.discovery.audiencePaths}`,
    `- Subject learning hubs: ${index.discovery.subjectHubs}`,
    "",
    "## Indexing policy",
    `- ${index.indexingPolicy.publicGuestModes}`,
    `- ${index.indexingPolicy.privateSavedChats}`,
    `- ${index.indexingPolicy.userContent}`,
    `- ${index.indexingPolicy.historicalPersonaCaution}`,
    "",
    "## Best entrypoints",
    ...publicPages.map((page) => `- ${page.name}: ${page.url} - ${page.purpose}`),
    "",
    "## Public authority pages",
    ...index.authority.publicAuthorityPages.map((page) => `- ${page.title}: ${page.url} - ${page.description}`),
    "",
    "## Schools and partner deployment",
    `- ${index.authority.schools.summary}`,
    ...index.authority.schools.deploymentSteps.map(
      (step) => `- ${step.step}. ${step.title}: ${step.url} - ${step.description}`,
    ),
    `- Search intents: ${index.authority.schools.searchIntents.join(", ")}`,
    "",
    "## Trust and safety",
    `- ${index.authority.trust.summary}`,
    ...index.authority.trust.safeguards.map(
      (safeguard) => `- ${safeguard.title}: ${safeguard.url} - ${safeguard.description}`,
    ),
    "",
    "## Featured learning film",
    `- ${index.featuredLearningFilm.title}: ${index.featuredLearningFilm.url} - ${index.featuredLearningFilm.description}`,
    "",
    "## AI learning paths",
    ...index.learningPaths.map((path) => `- ${path.name}: ${path.url} - ${path.description}`),
    "",
    "## AI learning map",
    `- ${index.learningMap.workflowCount} intent-based workflows: ${index.learningMap.url}`,
    `- Search intents: ${index.learningMap.searchIntents.join(", ")}`,
    ...index.learningMap.workflows.map(
      (workflow) =>
        `- ${workflow.title}: ${workflow.url} - ${workflow.description} Modes: ${workflow.modes
          .map((mode) => mode.url)
          .join(", ")}`,
    ),
    "",
    "## AI tutor comparisons",
    `- ${index.comparisons.pageCount} comparison pages: ${index.comparisons.url}`,
    `- Search intents: ${index.comparisons.searchIntents.join(", ")}`,
    ...index.comparisons.pages.map(
      (page) =>
        `- ${page.title}: ${page.url} - ${page.shortAnswer} Related modes: ${page.modes
          .map((mode) => mode.url)
          .join(", ")}`,
    ),
    "",
    "## Audience learning paths",
    `- ${index.audiencePaths.pageCount} audience pages: ${index.audiencePaths.url}`,
    `- Search intents: ${index.audiencePaths.searchIntents.join(", ")}`,
    ...index.audiencePaths.pages.map(
      (page) =>
        `- ${page.title}: ${page.url} - ${page.summary} Related modes: ${page.modes
          .map((mode) => mode.url)
          .join(", ")}`,
    ),
    "",
    "## Subject learning hubs",
    `- ${index.subjectHubs.pageCount} subject pages: ${index.subjectHubs.url}`,
    `- Search intents: ${index.subjectHubs.searchIntents.join(", ")}`,
    ...index.subjectHubs.pages.map(
      (page) =>
        `- ${page.title}: ${page.url} - ${page.summary} Related modes: ${page.modes
          .map((mode) => mode.url)
          .join(", ")}`,
    ),
    "",
    "## AI prompt library",
    `- ${index.promptLibrary.promptCount} starter prompts across ${index.promptLibrary.modeCount} public learning modes: ${index.promptLibrary.url}`,
    `- Search intents: ${index.promptLibrary.searchIntents.join(", ")}`,
    ...index.promptLibrary.categories.map(
      (category) => `- ${category.name}: ${category.url} (${category.promptCount} prompts) - ${category.description}`,
    ),
    "",
    "## Mode category clusters",
    ...index.topicDirectory.categories.map(
      (category) => `- ${category.name}: ${category.url} - ${category.description}`,
    ),
    "",
    "## Public AI learning modes",
    ...index.publicLearningModes.map((mode) => `- ${mode.name}: ${mode.url} - ${mode.description}`),
    "",
    "## Blog posts",
    ...index.blog.posts.map(
      (post) =>
        `- ${post.title}: ${post.url} (${post.readingMinutes} min) - ${post.description}${
          post.learningActions.length > 0
            ? ` Practice: ${post.learningActions.map((link) => `${link.title} (${link.url})`).join(", ")}`
            : ""
        }`,
    ),
    "",
    "## Blog pillar clusters",
    ...index.blog.directory.pillarClusters.map(
      (cluster) => `- ${cluster.title}: ${cluster.url} - ${cluster.description} Live mode: ${cluster.liveMode.url}`,
    ),
    "",
    "## Blog categories",
    ...index.blog.categories.map(
      (category) => `- ${category.title}: ${category.url} (${category.postCount} guides) - ${category.description}`,
    ),
    "",
  ].join("\n");
}

export function buildLlmsFullTxt() {
  const index = buildAiContentIndex();
  const publicPageLines = publicPages.map((page) => `- ${page.name}: ${page.url}\n  Purpose: ${page.purpose}`);
  const authoritySection = [
    `### About`,
    `URL: ${index.authority.about.url}`,
    `Canonical: ${index.authority.about.canonicalUrl}`,
    `Summary: ${index.authority.about.summary}`,
    "Timeline:",
    ...index.authority.about.timeline.map((item) => `- ${item.year}: ${item.title} (${item.url}) - ${item.description}`),
    "Proof points:",
    ...index.authority.about.proofPoints.map((point) => `- ${point.title}: ${point.text}`),
    "FAQ:",
    ...index.authority.about.faq.map((item) => `- ${item.question} ${item.answer}`),
    "Reference links:",
    ...index.authority.about.referenceLinks.map((link) => `- ${link.title}: ${link.url} - ${link.description}`),
    "",
    `### Schools and partners`,
    `URL: ${index.authority.schools.url}`,
    `Canonical: ${index.authority.schools.canonicalUrl}`,
    `Summary: ${index.authority.schools.summary}`,
    "Features:",
    ...index.authority.schools.features.map((feature) => `- ${feature.title}: ${feature.url} - ${feature.description}`),
    "Deployment path:",
    ...index.authority.schools.deploymentSteps.map(
      (step) => `- ${step.step}. ${step.title}: ${step.url} - ${step.description}`,
    ),
    "Use cases:",
    ...index.authority.schools.useCases.map((useCase) => `- ${useCase.title}: ${useCase.url} - ${useCase.description}`),
    "Search intents:",
    markdownList([...index.authority.schools.searchIntents]),
    "FAQ:",
    ...index.authority.schools.faq.map((item) => `- ${item.question} ${item.answer}`),
    "",
    `### Trust and safety`,
    `URL: ${index.authority.trust.url}`,
    `Canonical: ${index.authority.trust.canonicalUrl}`,
    `Summary: ${index.authority.trust.summary}`,
    "Principles:",
    ...index.authority.trust.principles.map((principle) => `- ${principle.title}: ${principle.text}`),
    "Safeguards:",
    ...index.authority.trust.safeguards.map(
      (safeguard) => `- ${safeguard.title}: ${safeguard.url} - ${safeguard.description}`,
    ),
    "Public access policy:",
    ...index.authority.trust.publicAccessPolicies.map((policy) => `- ${policy.name}: ${policy.status} - ${policy.text}`),
    "Reference links:",
    ...index.authority.trust.referenceLinks.map((link) => `- ${link.title}: ${link.url} - ${link.description}`),
    "FAQ:",
    ...index.authority.trust.faq.map((item) => `- ${item.question} ${item.answer}`),
    "",
    `### Media and press`,
    `URL: ${index.authority.media.url}`,
    `Canonical: ${index.authority.media.canonicalUrl}`,
    `Summary: ${index.authority.media.summary}`,
    "Highlights:",
    ...index.authority.media.highlights.map((item) => `- ${item.title}: ${item.text}`),
    "Attribution facts:",
    ...index.authority.media.attributionFacts.map((fact) => `- ${fact.label}: ${fact.value}`),
    "Official links:",
    ...index.authority.media.officialLinks.map((link) => `- ${link.title}: ${link.url} - ${link.description}`),
    "Coverage links:",
    ...index.authority.media.coverageLinks.map((link) => `- ${link.title}: ${link.url} - ${link.description}`),
    "Story angles:",
    ...index.authority.media.storyAngles.map((angle) => `- ${angle.title}: ${angle.url} - ${angle.description}`),
    "Recommended citation targets:",
    ...index.authority.media.linkingTargets.map(
      (target) => `- ${target.title}: ${target.url} - Suggested anchor: ${target.anchorText}. ${target.description}`,
    ),
    "Suggested citation snippets:",
    ...index.authority.media.citationSnippets.map((snippet) => `- ${snippet.title}: ${snippet.text} Source: ${snippet.url}`),
    "FAQ:",
    ...index.authority.media.faq.map((item) => `- ${item.question} ${item.answer}`),
    "",
    `### Mission`,
    `URL: ${index.authority.mission.url}`,
    `Canonical: ${index.authority.mission.canonicalUrl}`,
    `Summary: ${index.authority.mission.summary}`,
    "Principles:",
    ...index.authority.mission.principles.map((principle) => `- ${principle.title}: ${principle.text}`),
    "FAQ:",
    ...index.authority.mission.faq.map((item) => `- ${item.question} ${item.answer}`),
    "Reference links:",
    ...index.authority.mission.referenceLinks.map((link) => `- ${link.title}: ${link.url} - ${link.description}`),
  ].join("\n");
  const filmSection = [
    `### ${index.featuredLearningFilm.title}`,
    `URL: ${index.featuredLearningFilm.url}`,
    `Content URL: ${index.featuredLearningFilm.contentUrl}`,
    `Thumbnail: ${index.featuredLearningFilm.thumbnailUrl}`,
    `Duration: ${index.featuredLearningFilm.duration}`,
    `Upload date: ${index.featuredLearningFilm.uploadDate}`,
    `Description: ${index.featuredLearningFilm.description}`,
    `Transcript summary: ${index.featuredLearningFilm.transcript}`,
    "Chapters:",
    ...index.featuredLearningFilm.chapters.map(
      (chapter) => `- ${chapter.title} (${chapter.start}-${chapter.end}s): ${chapter.text}`,
    ),
  ].join("\n");
  const modeCategorySections = index.topicDirectory.categories.map((category) =>
    [
      `### ${category.name}`,
      `URL: ${category.url}`,
      `Description: ${category.description}`,
      `Best for: ${category.bestFor}`,
      "Search intents:",
      markdownList(category.searchIntents),
      "Featured modes:",
      ...category.featuredModes.map((mode) => `- ${mode.name}: ${mode.url} - ${mode.description}`),
    ].join("\n"),
  );
  const modeSections = index.publicLearningModes.map((mode) =>
    [
      `### ${mode.name}`,
      `URL: ${mode.url}`,
      `Canonical: ${mode.canonicalUrl}`,
      `Category: ${mode.category}`,
      `Interface: ${mode.uiMode}`,
      `Summary: ${mode.summary}`,
      `Description: ${mode.description}`,
      `Who it helps: ${mode.helps}`,
      `Why it is different: ${mode.whyItIsDifferent}`,
      "Outcomes:",
      markdownList(mode.outcomes),
      "Search intents:",
      markdownList(mode.searchIntents),
      "Starter prompts:",
      markdownList(mode.starterPrompts),
      mode.relatedGuides.length > 0
        ? ["Related guides:", ...mode.relatedGuides.map((post) => `- ${post.title}: ${post.url}`)].join("\n")
        : "Related guides: See the blog and category clusters.",
    ].join("\n"),
  );
  const pathSections = index.learningPaths.map((path) =>
    [
      `### ${path.name}`,
      `URL: ${path.url}`,
      `Description: ${path.description}`,
      `Audience: ${path.audience}`,
      `Outcome: ${path.outcome}`,
      "Search intents:",
      markdownList(path.searchIntents),
      "Steps:",
      ...path.steps.map((step, index) => `${index + 1}. ${step.title}: ${step.description} (${step.url})`),
      "Example prompts:",
      ...path.examplePrompts.map((prompt) => `- ${prompt.title}: ${prompt.prompt} (${prompt.url})`),
      "Mistakes to avoid:",
      markdownList(path.mistakesToAvoid),
      "Review loop:",
      ...path.reviewLoop.map((step) => `- ${step.title}: ${step.description} (${step.url})`),
      "Public modes:",
      ...path.publicModes.map((mode) => `- ${mode.label}: ${mode.url}`),
      "Related guides:",
      ...path.relatedGuides.map((url) => `- ${url}`),
    ].join("\n"),
  );
  const learningMapSection = [
    `URL: ${index.learningMap.url}`,
    `Canonical: ${index.learningMap.canonicalUrl}`,
    `Workflow count: ${index.learningMap.workflowCount}`,
    "Search intents:",
    markdownList([...index.learningMap.searchIntents]),
    "Workflows:",
    ...index.learningMap.workflows.map((workflow) =>
      [
        `- ${workflow.title}: ${workflow.url}`,
        `  Description: ${workflow.description}`,
        `  Audience: ${workflow.audience}`,
        `  Outcome: ${workflow.outcome}`,
        workflow.path ? `  Learning path: ${workflow.path.title} (${workflow.path.url})` : "  Learning path: See linked modes and guides.",
        `  Modes: ${workflow.modes.map((mode) => `${mode.name} (${mode.url})`).join("; ")}`,
        `  Prompts: ${workflow.prompts.map((prompt) => `"${prompt.prompt}" (${prompt.url})`).join("; ")}`,
        `  Guides: ${workflow.guides.map((guide) => `${guide.title} (${guide.url})`).join("; ")}`,
        `  Review loop: ${workflow.reviewLoop.join(" ")}`,
      ].join("\n"),
    ),
    "FAQ:",
    ...index.learningMap.faq.map((item) => `- ${item.question} ${item.answer}`),
  ].join("\n");
  const comparisonSection = [
    `URL: ${index.comparisons.url}`,
    `Canonical: ${index.comparisons.canonicalUrl}`,
    `Comparison page count: ${index.comparisons.pageCount}`,
    "Search intents:",
    markdownList([...index.comparisons.searchIntents]),
    "Comparison pages:",
    ...index.comparisons.pages.map((page) =>
      [
        `### ${page.title}`,
        `URL: ${page.url}`,
        `Competitor: ${page.competitorName}`,
        `Summary: ${page.shortAnswer}`,
        `Positioning: ${page.balancedPosition}`,
        "Best for:",
        markdownList(page.bestFor),
        "Search intents:",
        markdownList(page.searchIntents),
        "Use cases:",
        ...page.useCases.map((useCase) => `- ${useCase.title}: ${useCase.url} - ${useCase.description}`),
        "Public modes:",
        ...page.modes.map((mode) => `- ${mode.name}: ${mode.url} - ${mode.description}`),
        "Workflows:",
        ...page.workflows.map((workflow) => `- ${workflow.title}: ${workflow.url} - ${workflow.description}`),
        "Guides:",
        ...page.guides.map((guide) => `- ${guide.title}: ${guide.url} - ${guide.description}`),
        "Official references:",
        ...page.officialReferences.map((reference) => `- ${reference.title}: ${reference.url} - ${reference.description}`),
        "FAQ:",
        ...page.faq.map((item) => `- ${item.question} ${item.answer}`),
      ].join("\n"),
    ),
    "Hub FAQ:",
    ...index.comparisons.faq.map((item) => `- ${item.question} ${item.answer}`),
  ].join("\n");
  const audienceSection = [
    `URL: ${index.audiencePaths.url}`,
    `Canonical: ${index.audiencePaths.canonicalUrl}`,
    `Audience page count: ${index.audiencePaths.pageCount}`,
    "Search intents:",
    markdownList([...index.audiencePaths.searchIntents]),
    "Audience pages:",
    ...index.audiencePaths.pages.map((page) =>
      [
        `### ${page.title}`,
        `URL: ${page.url}`,
        `Role: ${page.role}`,
        `Summary: ${page.summary}`,
        `Why it matters: ${page.why}`,
        "Search intents:",
        markdownList(page.searchIntents),
        "Jobs:",
        ...page.jobs.map((job) => `- ${job.title}: ${job.url} - ${job.description}`),
        "Public modes:",
        ...page.modes.map((mode) => `- ${mode.name}: ${mode.url} - ${mode.description}`),
        "Learning paths:",
        ...page.paths.map((path) => `- ${path.title}: ${path.url} - ${path.description}`),
        "Workflows:",
        ...page.workflows.map((workflow) => `- ${workflow.title}: ${workflow.url} - ${workflow.description}`),
        "Guides:",
        ...page.guides.map((guide) => `- ${guide.title}: ${guide.url} - ${guide.description}`),
        "Boundaries:",
        markdownList(page.safeguards),
        "FAQ:",
        ...page.faq.map((item) => `- ${item.question} ${item.answer}`),
      ].join("\n"),
    ),
    "Hub FAQ:",
    ...index.audiencePaths.faq.map((item) => `- ${item.question} ${item.answer}`),
  ].join("\n");
  const subjectSection = [
    `URL: ${index.subjectHubs.url}`,
    `Canonical: ${index.subjectHubs.canonicalUrl}`,
    `Subject page count: ${index.subjectHubs.pageCount}`,
    "Search intents:",
    markdownList([...index.subjectHubs.searchIntents]),
    "Subject pages:",
    ...index.subjectHubs.pages.map((page) =>
      [
        `### ${page.title}`,
        `URL: ${page.url}`,
        `Subject area: ${page.subjectArea}`,
        `Summary: ${page.summary}`,
        `Why it matters: ${page.why}`,
        "Search intents:",
        markdownList(page.searchIntents),
        "Jobs:",
        ...page.jobs.map((job) => `- ${job.title}: ${job.url} - ${job.description}`),
        "Public modes:",
        ...page.modes.map((mode) => `- ${mode.name}: ${mode.url} - ${mode.description}`),
        "Prompt starters:",
        ...page.prompts.map((prompt) => `- ${prompt.topicName}: "${prompt.prompt}" (${prompt.url})`),
        "Learning paths:",
        ...page.paths.map((path) => `- ${path.title}: ${path.url} - ${path.description}`),
        "Workflows:",
        ...page.workflows.map((workflow) => `- ${workflow.title}: ${workflow.url} - ${workflow.description}`),
        "Guides:",
        ...page.guides.map((guide) => `- ${guide.title}: ${guide.url} - ${guide.description}`),
        "Review loop:",
        markdownList(page.reviewLoop),
        "FAQ:",
        ...page.faq.map((item) => `- ${item.question} ${item.answer}`),
      ].join("\n"),
    ),
    "Hub FAQ:",
    ...index.subjectHubs.faq.map((item) => `- ${item.question} ${item.answer}`),
  ].join("\n");
  const promptCategorySections = index.promptLibrary.categories.map((category) =>
    [
      `### ${category.name} prompts`,
      `URL: ${category.url}`,
      `Description: ${category.description}`,
      `Best for: ${category.bestFor}`,
      `Prompt count: ${category.promptCount}`,
      "Search intents:",
      markdownList(category.searchIntents),
      "Prompt starters:",
      ...category.prompts.map((entry) => `- ${entry.topicName}: "${entry.prompt}" (${entry.url})`),
    ].join("\n"),
  );
  const promptLibrarySection = [
    `URL: ${index.promptLibrary.url}`,
    `Canonical: ${index.promptLibrary.canonicalUrl}`,
    `Prompt count: ${index.promptLibrary.promptCount}`,
    `Mode count: ${index.promptLibrary.modeCount}`,
    `Category count: ${index.promptLibrary.categoryCount}`,
    "Search intents:",
    markdownList([...index.promptLibrary.searchIntents]),
    "Featured prompt entrypoints:",
    ...index.promptLibrary.featuredPrompts.map(
      (entry) => `- ${entry.topicName}: "${entry.prompt}" (${entry.url}) - ${entry.description}`,
    ),
    "FAQ:",
    ...index.promptLibrary.faq.map((item) => `- ${item.question} ${item.answer}`),
  ].join("\n");
  const categoryLines = index.blog.categories.map(
    (category) => `- ${category.title}: ${category.url} (${category.postCount} guides) - ${category.description}`,
  );
  const blogCategorySections = index.blog.categories.map((category) =>
    [
      `### ${category.title}`,
      `URL: ${category.url}`,
      `Post count: ${category.postCount}`,
      `Description: ${category.description}`,
      `Audience: ${category.audience}`,
      `Outcome: ${category.outcome}`,
      "Search intents:",
      markdownList(category.searchIntents),
      "Workflows:",
      ...category.workflows.map((workflow) => `- ${workflow.title}: ${workflow.anchorUrl} - ${workflow.description}`),
      "Related live modes:",
      ...category.relatedModes.map(
        (mode) => `- ${mode.name}: ${mode.url} (${mode.relatedGuideCount} related guides) - ${mode.description}`,
      ),
      "Featured guides:",
      ...category.featuredPosts.map((post) => `- ${post.title}: ${post.url} - ${post.description}`),
      "FAQ:",
      ...category.faq.map((item) => `- ${item.question} ${item.answer}`),
    ].join("\n"),
  );
  const blogPillarSections = index.blog.directory.pillarClusters.map((cluster) =>
    [
      `### ${cluster.title}`,
      `URL: ${cluster.url}`,
      `Description: ${cluster.description}`,
      `Audience: ${cluster.audience}`,
      `Category: ${cluster.category.name} (${cluster.category.url})`,
      `Live mode: ${cluster.liveMode.name} (${cluster.liveMode.url})`,
      "Guides:",
      ...cluster.guides.map((guide) => `- ${guide.title}: ${guide.url} - ${guide.description}`),
    ].join("\n"),
  );
  const blogLines = index.blog.posts.map((post) => {
    const relatedMode = post.relatedMode ? ` Related mode: ${post.relatedMode.name} (${post.relatedMode.url}).` : "";
    const learningActions =
      post.learningActions.length > 0
        ? `\n  Learning actions: ${post.learningActions.map((link) => `${link.title} (${link.url})`).join("; ")}.`
        : "";
    const learningGraph =
      post.learningGraph.length > 0
        ? `\n  Connected resources: ${post.learningGraph.map((link) => `${link.title} (${link.url})`).join("; ")}.`
        : "";
    const headings =
      post.headings.length > 0
        ? `\n  Article anchors: ${post.headings.map((heading) => `${heading.title} (${heading.url})`).join("; ")}.`
        : "";
    return `- ${post.title}: ${post.url}\n  Canonical: ${post.canonicalUrl}\n  Summary: ${post.description}\n  Reading time: ${post.readingMinutes} minutes. Word count: ${post.wordCount}.\n  Tags: ${post.tags.join(", ")}.${relatedMode}${learningActions}${learningGraph}${headings}`;
  });

  return [
    `# ${siteName} Full AI-Readable Learning Index`,
    "",
    `Site: ${siteUrl}`,
    `Last updated: ${index.dateModified}`,
    `Description: ${index.description}`,
    "",
    "## How to cite and index inspir",
    "Use canonical public URLs from this file. Public guest learning modes live at /chat/{topicSlug}. Private saved conversations are intentionally absent from this index and should not be inferred from public pages. Historical and persona simulations are interactive learning experiences, not primary sources or authenticated quotations.",
    "",
    "## Discovery files",
    `- Sitemap: ${index.discovery.sitemap}`,
    `- Robots: ${index.discovery.robots}`,
    `- RSS feed: ${index.discovery.rss}`,
    `- Compact llms.txt: ${index.discovery.llms}`,
    `- JSON content catalog: ${index.url}`,
    `- AI prompt library: ${index.discovery.promptLibrary}`,
    `- AI learning map: ${index.discovery.learningMap}`,
    `- Subject learning hubs: ${index.discovery.subjectHubs}`,
    "",
    "## Public pages",
    ...publicPageLines,
    "",
    "## Public authority and mission",
    authoritySection,
    "",
    "## Featured learning film",
    filmSection,
    "",
    "## AI learning paths",
    ...pathSections,
    "",
    "## AI learning map",
    learningMapSection,
    "",
    "## AI tutor comparisons",
    comparisonSection,
    "",
    "## Audience learning paths",
    audienceSection,
    "",
    "## Subject learning hubs",
    subjectSection,
    "",
    "## AI prompt library",
    promptLibrarySection,
    "",
    ...promptCategorySections,
    "",
    "## Mode category clusters",
    ...modeCategorySections,
    "",
    "## Public learning modes",
    ...modeSections,
    "",
    "## Blog category clusters",
    ...categoryLines,
    "",
    ...blogCategorySections,
    "",
    "## Blog pillar clusters",
    ...blogPillarSections,
    "",
    "## Blog guide library",
    ...blogLines,
    "",
  ].join("\n");
}
