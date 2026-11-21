/**
 * Pure lookups in the course catalogue and in course plans
 * (project → topic → block → level). No HTTP calls here.
 */

import type { Plan, PlanSummary, Topic } from './types.js';

/** How to find a topic and a block within a plan, by index or by title. */
export interface BlockQuery {
  topicIndex?: number;
  topicTitle?: string;
  blockIndex?: number;
  blockTitle?: string;
}

/**
 * Pick an item by its index or by a case-insensitive substring of its title.
 * The index wins when both are given; `missingMessage` is thrown when neither is.
 */
export function pickByIndexOrTitle<T extends { title: string }>(
  items: T[],
  kind: 'Topic' | 'Block',
  index: number | undefined,
  title: string | undefined,
  missingMessage: string,
): T {
  if (index != null) {
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      throw new Error(
        `${kind} index ${String(index)} out of range (0–${String(items.length - 1)})`,
      );
    }
    return items[index];
  }
  if (!title) throw new Error(missingMessage);
  const needle = title.toLowerCase();
  const found = items.find((item) => item.title.toLowerCase().includes(needle));
  if (!found) throw new Error(`No ${kind.toLowerCase()} matching "${title}"`);
  return found;
}

/** The block path `/../{project}/{topicSlug}/{blockSlug}/block`, derived from the puids. */
export function blockPath(project: string, topicPuid: string, blockPuid: string): string {
  return `/../${project}/${topicPuid.split('/')[1]}/${blockPuid.split('/')[1]}/block`;
}

/** Resolve a topic and block of a plan to the puid and path needed for pinning. */
export function resolveBlockRef(
  project: string,
  plan: Plan,
  query: BlockQuery,
): { blockPuid: string; blockPath: string } {
  const topic = pickByIndexOrTitle(
    plan.topics,
    'Topic',
    query.topicIndex,
    query.topicTitle,
    'Provide topicIndex or topicTitle when using project-based lookup',
  );
  const block = pickByIndexOrTitle(
    topic.blocks,
    'Block',
    query.blockIndex,
    query.blockTitle,
    'Provide blockIndex or blockTitle when using project-based lookup',
  );
  return { blockPuid: block.puid, blockPath: blockPath(project, topic.puid, block.puid) };
}

/** The blocks of a topic with their path and levels (with fileId where known). */
export function buildTopicBlocks(project: string, topic: Topic) {
  return topic.blocks.map((b) => ({
    title: b.title,
    puid: b.puid,
    blockPath: blockPath(project, topic.puid, b.puid),
    totalLevels: b.levels.length,
    levels: b.levels.map((lv) => ({
      title: lv.title,
      puid: lv.puid,
      type: lv.type,
      ...(typeof lv.path === 'string' && lv.path
        ? { fileId: `level${lv.path.replace(/^\/\.\./, '')}` }
        : {}),
    })),
  }));
}

function localized(
  value: string | Record<string, string>,
  language: string,
  fallback: string,
): string {
  return typeof value === 'string' ? value : (value[language] ?? fallback);
}

/** Filter the course catalogue by language, subject and grade. */
export function filterPlans(
  plans: PlanSummary[],
  opts: { subject?: string; grade?: number; language?: string } = {},
) {
  const language = opts.language ?? 'de';
  const subject = opts.subject?.toLowerCase();
  const { grade } = opts;

  return plans
    .filter((p) => !p.isDebug && p.guiLanguages.includes(language))
    .map((p) => ({
      project: p.project,
      title: localized(p.title, language, p.project),
      subject: localized(p.subject, language, ''),
      grades: p.grades,
      totalBlocks: p.totalBlocks,
      totalLevels: p.totalLevels,
    }))
    .filter((p) => !subject || p.subject.toLowerCase().includes(subject))
    .filter((p) => grade == null || p.grades.includes(grade));
}
