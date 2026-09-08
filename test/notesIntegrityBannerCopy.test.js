/* THE NOTES INTEGRITY BANNER IS WRITTEN IN PROPER ENGLISH, AND STAYS THAT WAY (NEW-1).
 *
 * ⛔ WHAT WENT WRONG. Owner report, verbatim, with two screenshots: "the wording and
 * formatting of the warning need improvement, its not even proper english." Seven concrete
 * defects, transcribed from the screenshots: the no-project bucket's own label ("Not in a
 * project") dropped into an "in <X>" template produced "in Not in a project" — a phrase inside
 * a phrase — in both prose and a button; a parenthetical ("(2 copies)") restated the sentence
 * it followed; small counts read as bare digits ("2") instead of words ("two"); a long title
 * truncated mid-word with an ugly cut; "Keep both, stop telling me" was flippant and duplicated
 * Dismiss; "Show me" and "Dismiss" sat in two different corners of the bar instead of one
 * control row; and the bar ran flush to the viewport edge instead of the page's content gutter.
 * A second banner in the same component (the recovered-note summary) carried the same
 * no-project defect plus three clauses of implementation detail nobody asked for.
 *
 * This file pins the new strings so none of the above can silently return. The rendering itself
 * (control grouping, wrapping, edge alignment) is a LIVE-VERIFY class — see VERIFICATION.md —
 * because CSS layout is not something a jsdom-free unit test can honestly judge; what IS
 * unit-testable is the STRING ASSEMBLY every rendered case depends on, which is what these
 * cases cover.
 */
import { describe, expect, it } from "vitest";

import {
  duplicateNotice, findCrossProjectDuplicates, joinMentions, keepCopyLabel, numberWord,
  pageMention, truncateMention,
} from "../src/workspaces/notes/lib/notesDuplicates.js";
import { NO_PROJECT_LABEL } from "../src/workspaces/notes/lib/notesModel.js";

const nameOf = (id) => ({ gp: "Grand Port", co: "Colorado" }[id] || "a project that no longer exists");

describe("numberWord — small counts read as words, never bare digits", () => {
  it("zero through ten spell out", () => {
    expect(numberWord(0)).toBe("zero");
    expect(numberWord(1)).toBe("one");
    expect(numberWord(2)).toBe("two");
    expect(numberWord(10)).toBe("ten");
  });
  it("past the spelled-out range, a numeral is the honest choice", () => {
    expect(numberWord(11)).toBe("11");
    expect(numberWord(23)).toBe("23");
  });
});

describe("truncateMention — word boundary, ONE ellipsis, never mid-word", () => {
  it("a short title passes through untouched", () => {
    expect(truncateMention("Coordination")).toBe("Coordination");
  });
  it("⛔ RED-PROOF: a long title cuts at a WORD boundary, not mid-word", () => {
    const long = "Recovered — Civil Plat Resubmitted to Baytown 7/13 CP Grant Submittal Package Two";
    const out = truncateMention(long);
    expect(out.endsWith("…")).toBe(true);        // one real ellipsis character
    expect(out).not.toContain(" ...");            // never three literal periods
    expect(out).not.toContain(" …");              // never a space directly before the ellipsis
    expect(out).not.toContain("  ");
    // every word in the truncated output is a whole word from the source — never a fragment
    const words = out.replace("…", "").trim().split(" ");
    const sourceWords = long.split(" ");
    for (const w of words) expect(sourceWords).toContain(w);
  });
  it("a single word longer than the budget still gets exactly one ellipsis", () => {
    const oneWord = "Supercalifragilisticexpialidocious".repeat(3);
    expect(truncateMention(oneWord)).toMatch(/^\S+…$/);
  });
});

describe("pageMention — the no-project case never goes through \"in <place>\"", () => {
  it("⛔ RED-PROOF (the headline defect): a named project reads naturally", () => {
    expect(pageMention({ title: "Coordination", projectId: "gp" }, nameOf))
      .toBe("“Coordination” in Grand Port");
  });
  it("⛔ RED-PROOF: a NULL project never produces \"in Not in a project\"", () => {
    const mention = pageMention({ title: "Recovered — Civil Plat Resubmitted", projectId: null }, nameOf);
    expect(mention).not.toContain(`in ${NO_PROJECT_LABEL}`);
    expect(mention).not.toContain("in Not in a project");
    expect(mention).toBe("“Recovered — Civil Plat Resubmitted” with no project");
  });
  it("a binned copy still says so, after the place", () => {
    expect(pageMention({ title: "Page 1", projectId: "gp", where: "bin" }, nameOf))
      .toBe("“Page 1” in Grand Port (in the bin)");
  });
  it("a long title is truncated inside the mention", () => {
    const long = "Recovered — Civil Plat Resubmitted to Baytown 7/13 CP Grant Submittal Package Two";
    const mention = pageMention({ title: long, projectId: null }, nameOf);
    expect(mention).toContain("…");
    expect(mention.endsWith("with no project")).toBe(true);
  });
});

describe("keepCopyLabel — the destructive button's own no-project case", () => {
  it("⛔ RED-PROOF (the headline defect, button form): never \"Keep only the one in Not in a project\"", () => {
    const label = keepCopyLabel({ projectId: null }, nameOf);
    expect(label).not.toContain("Not in a project");
    expect(label).toBe("Keep the unfiled copy");
  });
  it("a named project reads as \"Keep the <X> copy\"", () => {
    expect(keepCopyLabel({ projectId: "gp" }, nameOf)).toBe("Keep the Grand Port copy");
  });
});

describe("joinMentions — a sentence, never a bullet-separated list", () => {
  it("one mention needs no joiner", () => {
    expect(joinMentions(["“A” in X"])).toBe("“A” in X");
  });
  it("two mentions join with a comma and \"and\", not \" · \"", () => {
    expect(joinMentions(["“A” in X", "“B” with no project"])).toBe("“A” in X, and “B” with no project");
  });
  it("three or more mentions get an Oxford-comma list", () => {
    expect(joinMentions(["“A” in X", "“B” in Y", "“C” with no project"]))
      .toBe("“A” in X, “B” in Y, and “C” with no project");
  });
});

describe("duplicateNotice — the redesigned summary line", () => {
  const identicalGroup = (n = 2) => [{
    identical: true,
    pages: Array.from({ length: n }, (_, i) => ({ pageId: `p${i}`, title: "Coordination", projectId: i === 0 ? "gp" : "co" })),
  }];
  const nearGroup = () => [{ identical: false, pages: [{ pageId: "p0" }, { pageId: "p1" }] }];

  it("⛔ RED-PROOF: no restated parenthetical (PANEL-BREVITY)", () => {
    expect(duplicateNotice(identicalGroup())).not.toMatch(/\(\d+ copies?\)/);
  });
  it("⛔ RED-PROOF: numerals read as words", () => {
    expect(duplicateNotice(identicalGroup())).not.toMatch(/\d/);
    expect(duplicateNotice(nearGroup())).not.toMatch(/\d/);
  });
  it("pinned: a single identical pair", () => {
    expect(duplicateNotice(identicalGroup(2))).toBe("The same note is filed in two places.");
  });
  it("pinned: an identical group of three copies", () => {
    expect(duplicateNotice(identicalGroup(3))).toBe("The same note is filed in three places.");
  });
  it("pinned: more than one identical-group finding at once", () => {
    expect(duplicateNotice([...identicalGroup(), ...identicalGroup()])).toBe("Two notes are each filed in more than one place.");
  });
  it("pinned: a single near-duplicate", () => {
    expect(duplicateNotice(nearGroup())).toBe("Two notes are nearly identical.");
  });
  it("pinned: more than one near-duplicate finding at once", () => {
    expect(duplicateNotice([...nearGroup(), ...nearGroup()])).toBe("Two pairs of notes are nearly identical.");
  });
  it("nothing to say returns null, same as before", () => {
    expect(duplicateNotice([])).toBeNull();
    expect(duplicateNotice(null)).toBeNull();
  });
});

describe("adjacent cases the fix has to hold across (owner brief's table)", () => {
  it("both notes in named projects", () => {
    const mentions = [
      pageMention({ title: "Coordination", projectId: "gp" }, nameOf),
      pageMention({ title: "Coordination copy", projectId: "co" }, nameOf),
    ];
    expect(joinMentions(mentions)).toBe("“Coordination” in Grand Port, and “Coordination copy” in Colorado");
  });
  it("one note with no project", () => {
    const mentions = [
      pageMention({ title: "Coordination", projectId: "gp" }, nameOf),
      pageMention({ title: "Recovered — Civil Plat Resubmitted", projectId: null }, nameOf),
    ];
    expect(joinMentions(mentions)).toBe("“Coordination” in Grand Port, and “Recovered — Civil Plat Resubmitted” with no project");
  });
  it("⛔ both notes with no project is structurally not a finding at all — same project (null) is never a finding", () => {
    // findCrossProjectDuplicates skips any pair whose projectId matches, and null === null.
    const rows = [
      { pageId: "a", projectId: null, text: "Channel improvements were needed to slow down conveyance and provide sanitary service." },
      { pageId: "b", projectId: null, text: "Channel improvements were needed to slow down conveyance and provide sanitary service." },
    ];
    expect(findCrossProjectDuplicates(rows)).toEqual([]);
  });
  it("a very long project name is not truncated (only titles are)", () => {
    const longNameOf = () => "The Baytown Grant CP Resubmittal and Civil Plat Coordination Group";
    const mention = pageMention({ title: "Coordination", projectId: "gp" }, longNameOf);
    expect(mention).toContain("The Baytown Grant CP Resubmittal and Civil Plat Coordination Group");
  });
  it("a very long note title truncates at a word boundary with one ellipsis", () => {
    const mention = pageMention({ title: "Recovered — Civil Plat Resubmitted to Baytown 7/13 CP Grant Submittal Package Two", projectId: "gp" }, nameOf);
    expect(mention).toMatch(/…” in Grand Port$/);
  });
  it("a note whose title came from its first line still reads naturally, no-project case included", () => {
    // recoveredTitle() (notesModel.js) already prefixes "Recovered — "; pageMention must not
    // double-handle a title that already carries that prefix, or double its own ellipsis.
    const mention = pageMention({ title: "Recovered — Channel improvements", projectId: null }, nameOf);
    expect(mention).toBe("“Recovered — Channel improvements” with no project");
  });
});
