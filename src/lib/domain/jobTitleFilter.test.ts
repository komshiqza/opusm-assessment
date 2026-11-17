import { describe, expect, it } from "vitest";
import { DEFAULT_JOB_TITLE, NO_JOB_TITLE, isStartJobTitleSelection, jobTitleOptions, knownJobTitles, matchesJobTitles, selectedJobTitles } from "./jobTitleFilter";

const persons = [
  { jobTitle: "Service Technician" },
  { jobTitle: "Electrician" },
  { jobTitle: " Service Technician " }, // stored with spaces: the same title
  { jobTitle: null }, // e.g. admin
  { jobTitle: "  " }, // blank counts as none
  { jobTitle: "Dispatcher" },
];

describe("jobTitleOptions (values of the Job title filter, from the loaded persons)", () => {
  it("lists each distinct job title once, sorted, then 'No job title' when someone has none", () => {
    expect(jobTitleOptions(persons)).toEqual(["Dispatcher", "Electrician", "Service Technician", NO_JOB_TITLE]);
  });

  it("has no 'No job title' when everyone has one", () => {
    expect(jobTitleOptions([{ jobTitle: "Electrician" }])).toEqual(["Electrician"]);
  });
});

describe("matchesJobTitles", () => {
  it.each([
    [[], "Electrician", true, "nothing selected: no restriction"],
    [[], null, true, "nothing selected: also people without a job title"],
    [["Electrician"], "Electrician", true, "the selected title"],
    [["Electrician"], " Electrician ", true, "spaces around a stored title do not matter"],
    [["Electrician"], "Service Technician", false, "another title"],
    [["Electrician", "Dispatcher"], "Dispatcher", true, "one of several selected titles"],
    [[NO_JOB_TITLE], null, true, "'No job title' and no title"],
    [[NO_JOB_TITLE], "  ", true, "'No job title' and a blank title"],
    [[NO_JOB_TITLE], "Electrician", false, "'No job title' and a title"],
    [["Electrician", NO_JOB_TITLE], null, true, "a title and 'No job title' together"],
  ] as const)("%j vs %j → %s (%s)", (selected, jobTitle, expected, _why) => {
    expect(matchesJobTitles({ jobTitle }, [...selected])).toBe(expected);
  });
});

describe("knownJobTitles (a stored selection after a refresh)", () => {
  const options = ["Electrician", NO_JOB_TITLE];

  it("drops a title that no loaded person has any more, like a deleted skill in the Skills filter", () => {
    expect(knownJobTitles(["Mechanic", "Electrician"], options)).toEqual(["Electrician"]);
    expect(knownJobTitles(["Mechanic"], options)).toEqual([]);
  });

  it("returns the same array when nothing was dropped (so the caller knows not to update its state)", () => {
    const selected = ["Electrician", NO_JOB_TITLE];
    expect(knownJobTitles(selected, options)).toBe(selected);
  });
});

describe("selectedJobTitles (what the matrix filters by)", () => {
  const withDefault = [DEFAULT_JOB_TITLE, "Electrician", NO_JOB_TITLE];
  const withoutDefault = ["Electrician", NO_JOB_TITLE];
  it.each([
    [null, withDefault, [DEFAULT_JOB_TITLE], "no stored choice: the default trade"],
    [null, withoutDefault, [], "no stored choice, nobody has the default trade: everyone"],
    [[], withDefault, [], "explicitly nothing: everyone"],
    [["Electrician"], withDefault, ["Electrician"], "a stored choice"],
    [["Mechanic"], withDefault, [], "only unknown titles: everyone, not the default"],
  ] as const)("%j with %j → %j (%s)", (stored, options, expected, _why) => {
    expect(selectedJobTitles(stored === null ? null : [...stored], [...options])).toEqual(expected);
  });
});

describe("isStartJobTitleSelection (Reset filters is shown when the selection differs from the start)", () => {
  it.each([
    [[DEFAULT_JOB_TITLE], [DEFAULT_JOB_TITLE, NO_JOB_TITLE], true],
    [[], [DEFAULT_JOB_TITLE, NO_JOB_TITLE], false],
    [[DEFAULT_JOB_TITLE, NO_JOB_TITLE], [DEFAULT_JOB_TITLE, NO_JOB_TITLE], false],
    [[], ["Electrician"], true],
    [["Electrician"], ["Electrician"], false],
  ] as const)("%j with %j → %s", (selected, options, expected) => {
    expect(isStartJobTitleSelection([...selected], [...options])).toBe(expected);
  });
});
