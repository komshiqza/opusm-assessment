import { describe, expect, it } from "vitest";
import { closeAfterRefresh, initialLevelId, levelChoices, levelToSend, primaryAction } from "./assignmentDialogState";

describe("primaryAction (the main button of the assignment dialog)", () => {
  it("offers Assign for a person without the skill", () => {
    expect(primaryAction({ listed: false, createdId: null, removed: false })).toBe("assign");
  });

  it("offers Save for an assignment the list shows", () => {
    expect(primaryAction({ listed: true, createdId: null, removed: false })).toBe("save");
  });

  it("never offers Assign again once this dialog created the assignment, even if the list was not refreshed", () => {
    expect(primaryAction({ listed: false, createdId: "NEW", removed: false })).toBe("none");
  });

  it("offers Save once the refreshed list shows the created assignment", () => {
    expect(primaryAction({ listed: true, createdId: "NEW", removed: false })).toBe("save");
  });

  it("offers nothing after the assignment was removed, even if the list still shows it", () => {
    expect(primaryAction({ listed: true, createdId: null, removed: true })).toBe("none");
  });

  it("offers nothing while a saved change waits for the list before closing, so a later edit cannot be lost", () => {
    expect(primaryAction({ listed: true, createdId: null, removed: false, savedWaitingForRefresh: true })).toBe("none");
  });
});

describe("initialLevelId (level selected when the dialog opens)", () => {
  const levels = [
    { id: "BASIC", isDefault: true },
    { id: "EXPERT", isDefault: false },
  ];

  it("keeps the stored level of an assignment", () => {
    expect(initialLevelId({ proficiencyId: "EXPERT" }, levels)).toBe("EXPERT");
  });

  it("selects nothing for an assignment without a level, so saving a date does not set Basic", () => {
    expect(initialLevelId({ proficiencyId: null }, levels)).toBe("");
  });

  it("suggests the default level for a new assignment", () => {
    expect(initialLevelId(undefined, levels)).toBe("BASIC");
    expect(initialLevelId(undefined, [])).toBe("");
  });
});

describe("levelChoices (the level buttons; one of them is always selected)", () => {
  const levels = [
    { id: "BASIC", name: "Basic", isDefault: true },
    { id: "EXPERT", name: "Expert", isDefault: false },
  ];

  it("offers 'No level' only for an assignment stored without one, so the shown and the saved level agree", () => {
    const choices = levelChoices({ proficiencyId: null }, levels);
    expect(choices.map((c) => c.name)).toEqual(["No level", "Basic", "Expert"]);
    // the selected button is the one whose id equals the dialog's level: "" = No level, which is not sent
    expect(choices.find((c) => c.id === initialLevelId({ proficiencyId: null }, levels))?.name).toBe("No level");
  });

  it("offers only the scale's levels otherwise", () => {
    expect(levelChoices({ proficiencyId: "EXPERT" }, levels).map((c) => c.id)).toEqual(["BASIC", "EXPERT"]);
    expect(levelChoices(undefined, levels).map((c) => c.id)).toEqual(["BASIC", "EXPERT"]);
  });
});

describe("levelToSend (what Save sends for the level)", () => {
  it("sends a picked level", () => {
    expect(levelToSend("EXPERT", true)).toBe("EXPERT");
    expect(levelToSend("EXPERT", false)).toBe("EXPERT");
  });

  it("sends nothing for an untouched 'No level', so FSM keeps it", () => {
    expect(levelToSend("", false)).toBeUndefined();
  });

  it("clears the level when the user picked 'No level' (e.g. after saving Expert while the list could not refresh)", () => {
    expect(levelToSend("", true)).toBeNull();
  });
});

describe("closeAfterRefresh (Refresh list after a save whose reload failed)", () => {
  it("closes when the save was the last step", () => {
    expect(closeAfterRefresh({ close: true }, 0)).toBe(true);
  });

  it("stays open while picked files still wait for upload, so they are not dropped", () => {
    expect(closeAfterRefresh({ close: true }, 1)).toBe(false);
  });

  it("stays open when the dialog has more to do", () => {
    expect(closeAfterRefresh({ close: false }, 0)).toBe(false);
    expect(closeAfterRefresh(null, 0)).toBe(false);
  });
});
