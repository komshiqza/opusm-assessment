import { describe, expect, it } from "vitest";
import { fillHeight } from "./useFillHeight";

describe("fillHeight (the matrix box reaches the bottom of the screen, whatever sits above it)", () => {
  it("is the screen height minus the box's top and what follows it on the page", () => {
    // 1440×900: box at 304 px, footnote and page padding 58 px below it.
    expect(fillHeight({ viewportHeight: 900, top: 304, below: 58, min: 192 })).toBe(538);
  });

  it("follows the space above: wrapped filters or the Reset button push the box down, so it gets shorter", () => {
    expect(fillHeight({ viewportHeight: 900, top: 352, below: 58, min: 192 })).toBe(490);
  });

  it("rounds down, so the page never gets a 1 px scrollbar", () => {
    expect(fillHeight({ viewportHeight: 900, top: 304.4, below: 58.3, min: 192 })).toBe(537);
  });

  it("keeps a minimum on very short screens (the page may scroll there)", () => {
    expect(fillHeight({ viewportHeight: 420, top: 304, below: 58, min: 192 })).toBe(192);
  });
});
