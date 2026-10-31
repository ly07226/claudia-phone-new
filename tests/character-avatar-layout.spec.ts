import { test, expect, type Page } from "@playwright/test";

async function checkAvatarBounds(page: Page) {
  const frame = page.locator(".character-avatar-preview");
  const bounds = (await frame.boundingBox())!;
  expect(Math.abs(bounds.width - 88)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds.height - 88)).toBeLessThanOrEqual(1);
  await expect(frame).toHaveCSS("aspect-ratio", "1 / 1");
  const image = frame.locator("img");
  if (await image.count()) {
    const img = (await image.boundingBox())!;
    expect(img.x).toBeGreaterThanOrEqual(bounds.x);
    expect(img.y).toBeGreaterThanOrEqual(bounds.y);
    expect(img.x + img.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(img.y + img.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    await expect(image).toHaveCSS("object-fit", "cover");
    await expect(image).toHaveCSS("position", "static");
  }
  const control = (await page.locator(".character-avatar-control").boundingBox())!;
  const nameLabel = (await page.getByLabel("角色姓名", { exact: true }).locator("..").boundingBox())!;
  expect(control.y + control.height).toBeLessThan(nameLabel.y);
  expect(bounds.y + bounds.height).toBeLessThan(nameLabel.y);
  const remove = page.getByRole("button", { name: "移除头像", exact: true });
  if (await remove.count()) {
    const button = (await remove.boundingBox())!;
    expect(button.x).toBeGreaterThanOrEqual(bounds.x + bounds.width);
    expect(Math.abs(button.y + button.height / 2 - (control.y + control.height / 2))).toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [375, 390]) {
  test(`头像固定边界：${width}px 纵图、横图与编辑回显均不覆盖表单`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "角色管理", exact: true }).click();
    await page.getByRole("button", { name: "创建角色", exact: true }).click();
    await checkAvatarBounds(page);
    await page.getByLabel("角色姓名", { exact: true }).fill("头像布局验收");
    for (const [shape, w, h] of [["portrait", 80, 800], ["landscape", 800, 80]] as const) {
      const data = await page.evaluate(({ w, h }) => {
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#a7ba9b"; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#fff9ea"; ctx.fillRect(w / 4, h / 4, w / 2, h / 2);
        return canvas.toDataURL("image/png").split(",")[1];
      }, { w, h });
      await page.getByLabel("上传头像", { exact: true }).setInputFiles({ name: `${shape}.png`, mimeType: "image/png", buffer: Buffer.from(data, "base64") });
      await expect(page.getByRole("button", { name: "保存角色", exact: true })).toBeEnabled();
      await expect(page.getByAltText("角色头像预览", { exact: true })).toBeVisible();
      await page.getByAltText("角色头像预览", { exact: true }).evaluate(async (el: HTMLImageElement) => el.decode());
      await checkAvatarBounds(page);
      await page.screenshot({ path: `artifacts/character-avatar-${width}-${shape}.png` });
    }
    await page.getByRole("button", { name: "保存角色", exact: true }).click();
    await expect(page.locator(".character-editor")).toHaveCount(0);
    await page.getByRole("button", { name: "编辑角色", exact: true }).click();
    await expect(page.getByAltText("角色头像预览", { exact: true })).toBeVisible();
    await checkAvatarBounds(page);
    await page.getByRole("button", { name: "移除头像", exact: true }).click();
    await checkAvatarBounds(page);
    await expect(page.locator(".character-avatar-preview > svg")).toBeVisible();
  });
}
