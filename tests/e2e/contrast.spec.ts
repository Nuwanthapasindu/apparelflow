import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { apiAs, countAndApprove, createOrderViaApi, type ApiOrder, type Role } from "./helpers";

// Zero-tolerance rule: no low-contrast input, dropdown or focus state, and no white-on-white. Every page
// is checked at three widths, once per colour-scheme emulation (the app is light-only, so the dark run proves
// the OS dark mode cannot turn text white on a white field).
//
// NOT AUTOMATED: the open popup of a native <select> (its <option> list) is drawn by the browser and can be
// measured by neither axe nor the DOM. Check it by hand: status filter, recipe select in the
// order modal, in light and dark OS mode.

const WIDTHS = [360, 768, 1280] as const;
const SCHEMES = ["light", "dark"] as const;
const TEXT_MIN = 4.5;
const UI_MIN = 3;

type Fixtures = { pending: ApiOrder; verified: ApiOrder };
let fixtures: Fixtures;
let storage: Record<Role, Awaited<ReturnType<APIRequestContext["storageState"]>>>;

test.beforeAll(async ({ baseURL }) => {
  const supervisor = await apiAs("supervisor", baseURL!);
  const verifier = await apiAs("verifier", baseURL!);
  const sewing = await apiAs("sewing", baseURL!);
  const stamp = `CONTRAST-${Date.now()}`;
  const pending = await createOrderViaApi(supervisor, `${stamp}-PENDING`);
  const verified = await createOrderViaApi(supervisor, `${stamp}-VERIFIED`);
  await countAndApprove(verifier, verified);
  const inSewing = await createOrderViaApi(supervisor, `${stamp}-ACTIVE`);
  await countAndApprove(verifier, inSewing);
  expect((await sewing.post(`/api/sewing/${inSewing.id}/start`, { data: {} })).ok()).toBe(true);
  fixtures = { pending, verified };
  storage = { supervisor: await supervisor.storageState(), verifier: await verifier.storageState(), sewing: await sewing.storageState() };
});

type Scenario = {
  name: string;
  role: Role | null;
  path: () => string;
  prepare?: (page: Page) => Promise<void>;
};

const scenarios: Scenario[] = [
  { name: "login", role: null, path: () => "/login" },
  {
    name: "orders with the new-order dialog open",
    role: "supervisor",
    path: () => "/orders",
    prepare: async (page) => {
      await page.getByRole("button", { name: "New Cutting Order" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { name: "verifier queue", role: "verifier", path: () => "/verify" },
  {
    name: "workspace with a RED row",
    role: "verifier",
    path: () => `/verify/${fixtures.pending.id}`,
    prepare: async (page) => {
      const first = page.locator("input[inputmode=numeric]").first();
      await first.fill(String(fixtures.pending.items[0].expectedQty - 1));
      await page.getByText("SHORTAGE", { exact: true }).waitFor();
    },
  },
  {
    name: "workspace with the reject dialog open",
    role: "verifier",
    path: () => `/verify/${fixtures.pending.id}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Reject Batch" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  { name: "sewing queue", role: "sewing", path: () => "/sewing" },
  {
    name: "sewing in-sewing tab",
    role: "sewing",
    path: () => "/sewing",
    prepare: async (page) => void (await page.getByRole("tab", { name: /In sewing/ }).click()),
  },
  { name: "sewing detail", role: "sewing", path: () => `/sewing/${fixtures.verified.id}` },
  {
    name: "sewing detail with the start dialog open",
    role: "sewing",
    path: () => `/sewing/${fixtures.verified.id}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Start Sewing Assembly" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
];

async function openScenario(browser: Browser, scenario: Scenario, baseURL: string, width: number, scheme: "light" | "dark") {
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height: 900 },
    colorScheme: scheme,
    storageState: scenario.role ? storage[scenario.role] : undefined,
  });
  const page = await context.newPage();
  await page.goto(scenario.path());
  await page.waitForLoadState("networkidle");
  await scenario.prepare?.(page);
  return { page, close: () => context.close() };
}

type FieldIssue = { field: string; state: string; check: string; ratio: number; need: number; colors: string };

/** Contrast of every visible input, select and textarea in the page, in default, focus and disabled state. */
async function checkFields(page: Page): Promise<FieldIssue[]> {
  return page.evaluate(
    ({ TEXT_MIN, UI_MIN }) => {
      type Rgba = [number, number, number, number];
      const parse = (css: string): Rgba => {
        const m = css.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
        return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 1];
      };
      const over = (top: Rgba, bottom: Rgba): Rgba => {
        const a = top[3] + bottom[3] * (1 - top[3]);
        if (a === 0) return [0, 0, 0, 0];
        const mix = (i: number) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
        return [mix(0), mix(1), mix(2), a];
      };
      /** The colour actually painted behind an element: its ancestors' backgrounds composited, over white. */
      const backdrop = (el: Element | null): Rgba => {
        let acc: Rgba = [0, 0, 0, 0];
        for (let node = el; node; node = node.parentElement) {
          acc = over(acc, parse(getComputedStyle(node).backgroundColor));
          if (acc[3] >= 1) return acc;
        }
        return over(acc, [255, 255, 255, 1]);
      };
      const lum = ([r, g, b]: Rgba) => {
        const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a: Rgba, b: Rgba) => {
        const [x, y] = [lum(a), lum(b)];
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const hex = (c: Rgba) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
      const describe = (el: Element) => {
        const f = el as HTMLInputElement;
        const label = f.id && document.querySelector(`label[for="${CSS.escape(f.id)}"]`)?.textContent?.trim();
        return `${el.tagName.toLowerCase()}${label ? ` "${label}"` : f.getAttribute("aria-label") ? ` [${f.getAttribute("aria-label")}]` : f.id ? `#${f.id}` : ""}`;
      };

      const issues: FieldIssue[] = [];
      const fields = [...document.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      });

      const measure = (el: HTMLInputElement, state: string) => {
        const cs = getComputedStyle(el);
        const fieldBg = over(parse(cs.backgroundColor), backdrop(el.parentElement));
        const text = over(parse(cs.color), fieldBg);
        const textRatio = ratio(text, fieldBg);
        if (textRatio < TEXT_MIN) issues.push({ field: describe(el), state, check: "text on field background", ratio: +textRatio.toFixed(2), need: TEXT_MIN, colors: `${hex(text)} on ${hex(fieldBg)}` });
        if (state === "default" && parseFloat(cs.borderTopWidth) > 0) {
          const border = over(parse(cs.borderTopColor), backdrop(el.parentElement));
          const borderRatio = ratio(border, backdrop(el.parentElement));
          if (borderRatio < UI_MIN) issues.push({ field: describe(el), state, check: "border against surroundings", ratio: +borderRatio.toFixed(2), need: UI_MIN, colors: `${hex(border)} on ${hex(backdrop(el.parentElement))}` });
        }
        if (state === "focus") {
          const hasRing = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== "none" && cs.boxShadow !== "");
          if (!hasRing) issues.push({ field: describe(el), state, check: "visible focus indicator", ratio: 0, need: 1, colors: "no outline and no box-shadow" });
        }
      };

      for (const el of fields) {
        measure(el, "default");
        const placeholder = el.getAttribute("placeholder");
        if (placeholder) {
          const ph = over(parse(getComputedStyle(el, "::placeholder").color), over(parse(getComputedStyle(el).backgroundColor), backdrop(el.parentElement)));
          const bg = over(parse(getComputedStyle(el).backgroundColor), backdrop(el.parentElement));
          const r = ratio(ph, bg);
          if (r < TEXT_MIN) issues.push({ field: describe(el), state: "default", check: "placeholder", ratio: +r.toFixed(2), need: TEXT_MIN, colors: `${hex(ph)} on ${hex(bg)}` });
        }
        const previous = document.activeElement as HTMLElement | null;
        el.focus({ preventScroll: true });
        // A field behind an open modal dialog is inert and cannot take focus: nothing to measure there.
        if (document.activeElement === el) measure(el, "focus");
        previous?.focus?.({ preventScroll: true });
        if (!el.disabled) {
          el.disabled = true;
          measure(el, "disabled"); // reverted at once, in the same task, so React never sees it
          el.disabled = false;
        }
      }
      return issues;
    },
    { TEXT_MIN, UI_MIN },
  );
}

for (const scheme of SCHEMES) {
  for (const width of WIDTHS) {
    for (const scenario of scenarios) {
      test(`${scenario.name} at ${width}px, ${scheme} colour scheme: axe color-contrast and every field`, async ({ browser, baseURL }) => {
        const { page, close } = await openScenario(browser, scenario, baseURL!, width, scheme);
        try {
          const axe = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
          const axeFailures = axe.violations.flatMap((v) =>
            v.nodes.map((n) => `${n.target.join(" ")} ratio ${(n.any[0]?.data as { contrastRatio?: number } | undefined)?.contrastRatio ?? "?"} (${n.html.slice(0, 80)})`),
          );
          const fieldIssues = await checkFields(page);
          const report = [
            ...axeFailures.map((f) => `axe: ${f}`),
            ...fieldIssues.map((i) => `${i.field} [${i.state}] ${i.check}: ${i.ratio}:1, needs ${i.need}:1 (${i.colors})`),
          ];
          expect(report, `contrast defects on "${scenario.name}" at ${width}px (${scheme})`).toEqual([]);
        } finally {
          await close();
        }
      });
    }
  }
}
