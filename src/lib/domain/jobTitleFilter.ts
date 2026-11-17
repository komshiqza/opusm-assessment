/**
 * The matrix's "Job title" filter: the values come from the loaded persons (no extra FSM request).
 * "Technicians" means "has any job title", so with several trades (electricians, dispatchers, …)
 * this filter tells them apart. Nothing selected means no restriction.
 */

/** The filter value for people without a job title (stands apart from any real title). */
export const NO_JOB_TITLE = "__no_job_title__";

const titleOf = (person: { jobTitle: string | null }) => person.jobTitle?.trim() || null;

/** Each distinct job title once, sorted, then "No job title" when a loaded person has none. */
export function jobTitleOptions(persons: { jobTitle: string | null }[]): string[] {
  const titles = new Set<string>();
  let someoneWithout = false;
  for (const p of persons) {
    const title = titleOf(p);
    if (title) titles.add(title);
    else someoneWithout = true;
  }
  return [...[...titles].sort((a, b) => a.localeCompare(b)), ...(someoneWithout ? [NO_JOB_TITLE] : [])];
}

/** True when the person's job title is one of the selected ones (or nothing is selected). */
export function matchesJobTitles(person: { jobTitle: string | null }, selected: string[]): boolean {
  if (selected.length === 0) return true;
  return selected.includes(titleOf(person) ?? NO_JOB_TITLE);
}

/**
 * The selection without titles no loaded person has any more (e.g. after a refresh), like a deleted
 * skill in the Skills filter. Returns the same array when nothing was dropped.
 */
export function knownJobTitles(selected: string[], options: string[]): string[] {
  const known = selected.filter((title) => options.includes(title));
  return known.length === selected.length ? selected : known;
}

/**
 * This company's default trade: the matrix opens on the people the skills are for. One value for
 * this company's data (exact spelling as stored in FSM), not a button per trade.
 */
export const DEFAULT_JOB_TITLE = "Service Technician";

/** The start selection: the default trade when a loaded person has exactly that title, else nothing (everyone). */
export function defaultJobTitles(options: string[]): string[] {
  return options.includes(DEFAULT_JOB_TITLE) ? [DEFAULT_JOB_TITLE] : [];
}

/**
 * What the filter selects. `stored` null: the user has not chosen yet (or storage is unusable), so
 * the start selection. Otherwise the user's choice without unknown titles; when that leaves nothing,
 * everyone shows (an explicit "all", never the default again).
 */
export function selectedJobTitles(stored: string[] | null, options: string[]): string[] {
  return stored === null ? defaultJobTitles(options) : knownJobTitles(stored, options);
}

/** True when the selection is the start selection (then "Reset filters" has nothing to reset here). */
export function isStartJobTitleSelection(selected: string[], options: string[]): boolean {
  const start = defaultJobTitles(options);
  return selected.length === start.length && selected.every((title) => start.includes(title));
}
