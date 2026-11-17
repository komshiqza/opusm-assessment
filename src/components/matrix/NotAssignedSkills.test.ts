import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { setRenderedLanguage } from "@/lib/i18n/language";
import { NotAssignedSkills } from "./NotAssignedSkills";

const person = { id: "nina", name: "Nina Huber" };
const skills = [
  { id: "AID", name: "First aid" },
  { id: "CRANE", name: "Crane operation" },
  { id: "WELD", name: "Welding (steel)" },
];
const render = (missing: typeof skills) => renderToStaticMarkup(createElement(NotAssignedSkills, { person, skills: missing, onAssign: () => {} }));

describe("NotAssignedSkills (the phone card's 'Not assigned' line)", () => {
  afterEach(() => setRenderedLanguage("en"));

  it("shows no line when the person has every skill shown", () => {
    expect(render([])).toBe("");
  });

  it("starts collapsed: one line 'Not assigned (n)' in a panel the user expands with a tap or the keyboard", () => {
    const html = render(skills);
    expect(html).toMatch(/<ui5-panel[^>]*\scollapsed(=""|\s|>)/);
    expect(html).toContain('header-text="Not assigned (3)"');
  });

  it("keeps one assign chip per missing skill inside the panel, each a button with its own label", () => {
    const html = render(skills);
    const panel = html.slice(html.indexOf("<ui5-panel"), html.lastIndexOf("</ui5-panel>"));
    expect(panel.match(/<button type="button"/g)).toHaveLength(3);
    expect(panel).toContain('aria-label="Nina Huber, First aid: not assigned. Assign."');
    expect(panel).toContain("Welding (steel)");
  });

  it("speaks German", () => {
    setRenderedLanguage("de");
    expect(render(skills)).toContain('header-text="Nicht zugewiesen (3)"');
  });
});
