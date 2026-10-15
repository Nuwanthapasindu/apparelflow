import { expect, test } from "@playwright/test";
import { apiAs, createOrderViaApi, signInThroughForm, switchRole } from "./helpers";

// The brief's five-minute evaluator checklist, in order, in a real browser against a production build.
test("evaluator path: create, shortage blocks approval, approve, sewing queue, start sewing", async ({ page, baseURL }) => {
  const stamp = `E2E-${Date.now()}`;
  const supervisor = await apiAs("supervisor", baseURL!);
  const pending = await createOrderViaApi(supervisor, `${stamp}-PENDING`); // stays unverified all test long

  // 1. Supervisor creates an order through the form.
  await signInThroughForm(page, "supervisor");
  await page.getByRole("button", { name: "New Cutting Order" }).click();
  await page.getByLabel("Recipe").selectOption({ index: 1 });
  await page.getByLabel("Target batch quantity").fill("50");
  await page.getByLabel("Fabric Roll ID").fill(stamp);
  await page.getByLabel("Actual fabric used (yds)").fill("91.00");
  await page.getByRole("button", { name: "Submit for verification" }).click();
  const heading = await page.getByRole("heading", { name: /submitted for verification/ }).innerText();
  const orderNo = /CUT-\d+/.exec(heading)![0];
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("link", { name: orderNo })).toBeVisible();

  // 2. Switch to Verifier: the order-creation control is not in the DOM at all.
  await switchRole(page, "verifier");
  await expect(page.getByRole("heading", { name: "Verifier Terminal" })).toBeVisible();
  expect(await page.getByRole("button", { name: /New Cutting Order/ }).count()).toBe(0);
  expect(await page.getByText(/New Cutting Order/).count()).toBe(0);

  // 3. Enter a shortage: Approve is disabled; with `disabled` removed the server still says 422.
  await page.getByRole("link", { name: new RegExp(orderNo) }).click();
  await page.waitForURL(/\/verify\/.+/);
  const inputs = page.locator("input[inputmode=numeric]");
  await expect(inputs).toHaveCount(5);
  const expected = [50, 50, 50, 100, 100];
  for (let i = 0; i < 5; i += 1) await inputs.nth(i).fill(String(i === 0 ? expected[0] - 1 : expected[i]));
  await expect(page.getByText("SHORTAGE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save counts" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const approve = page.getByRole("button", { name: "Approve Batch" });
  await expect(approve).toBeDisabled();
  await expect(page.getByText(/Approve blocked: 1 short/)).toBeVisible();

  await approve.evaluate((button: HTMLButtonElement) => { button.removeAttribute("disabled"); button.click(); });
  const orderId = page.url().split("/verify/")[1];
  const tampered = await page.evaluate(async (id) => {
    const response = await fetch(`/api/orders/${id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return { status: response.status, body: await response.json() };
  }, orderId);
  expect(tampered.status).toBe(422);
  expect(tampered.body.error.details.blocking[0].reason).toBe("SHORTAGE");

  // 4. Fix the count and approve a valid order through the dialog.
  await page.reload();
  await page.locator("input[inputmode=numeric]").first().fill("50");
  await page.getByRole("button", { name: "Save counts" }).click();
  await expect(approve).toBeEnabled();
  await approve.click();
  await page.getByRole("button", { name: "Confirm approval" }).click();
  await page.waitForURL(/result=verified/);
  await expect(page.getByText(`${orderNo} verified`)).toBeVisible();

  // 5. Switch to Sewing: unverified batches are invisible, the approved one is in the queue, and it persists.
  await switchRole(page, "sewing");
  await expect(page.getByRole("heading", { name: "Sewing Queue" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(orderNo) })).toBeVisible();
  await expect(page.getByText(pending.orderNo)).toHaveCount(0);
  expect(await page.content()).not.toContain(pending.orderNo);
  await page.reload();
  await expect(page.getByRole("link", { name: new RegExp(orderNo) })).toBeVisible();
  await expect(page.getByText(pending.orderNo)).toHaveCount(0);

  // 6. Release it to the line.
  await page.getByRole("link", { name: new RegExp(orderNo) }).click();
  await page.getByRole("button", { name: "Start Sewing Assembly" }).click();
  await page.getByRole("button", { name: "Confirm start" }).click();
  await expect(page.getByText(/Started by Sewing Supervisor/)).toBeVisible();
  await page.goto("/sewing");
  await page.getByRole("tab", { name: /In sewing/ }).click();
  await expect(page.getByRole("link", { name: new RegExp(orderNo) })).toBeVisible();

  // The unverified batch still cannot be read or started through the sewing API.
  const sewing = await apiAs("sewing", baseURL!);
  expect((await sewing.get(`/api/sewing/${pending.id}`)).status()).toBe(404);
  expect((await sewing.post(`/api/sewing/${pending.id}/start`, { data: {} })).status()).toBe(404);
  const queue = await (await sewing.get("/api/sewing/queue?status=PENDING_VERIFICATION")).json();
  expect(JSON.stringify(queue)).not.toContain(pending.id);
});
