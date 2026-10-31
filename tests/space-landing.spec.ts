import { test, expect } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });

test("定稿空间首页使用透明原图，双入口等宽且不同视口无溢出", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "选择空间", exact: true })).toBeVisible();
  const image = page.locator(".space-mascot img");
  await expect(image).toHaveAttribute("src", /apple-leopard[^/]*\.png(?:\?.*)?$/);
  expect(await image.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(img, 0, 0);
    return img.naturalWidth === 1635 && ctx.getImageData(0, 0, 1, 1).data[3] === 0;
  })).toBe(true);
  await expect(page.locator(".space-world-grid")).toHaveCount(0);
  await expect(page.locator(".space-entry-actions button")).toHaveCount(2);
  for (const [width,height] of [[320,568],[375,667],[390,844],[430,932],[844,390]]) {
    await page.setViewportSize({width,height});
    const layout = await page.evaluate(() => {
      const root = document.documentElement;
      const buttons = [...document.querySelectorAll(".space-entry-actions button")].map(el => el.getBoundingClientRect());
      const art = document.querySelector(".space-mascot img")!.getBoundingClientRect();
      const title = document.querySelector(".space-heading")!.getBoundingClientRect();
      return { fits:root.scrollHeight <= innerHeight+1 && root.scrollWidth <= innerWidth,
        equal:Math.abs(buttons[0].width-buttons[1].width)<1,
        inside:buttons.every(b=>b.left>=0 && b.right<=innerWidth && b.bottom<=innerHeight-16),
        art:art.top>=title.bottom && art.bottom<=buttons[0].top };
    });
    expect(layout).toEqual({fits:true,equal:true,inside:true,art:true});
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:"artifacts/space-landing-final.png"});
  await page.getByRole("button", {name:"剧本",exact:true}).click();
  await expect(page.getByRole("button", {name:"创建 / 管理剧本",exact:true})).toBeVisible();
  await page.getByRole("button", {name:"返回空间首页",exact:true}).click();
  await expect(image).toBeVisible();
  await page.getByRole("button", {name:"进入日常手机",exact:true}).click();
  await expect(page.locator(".desktop")).toBeVisible();
  await page.getByRole("button", {name:"返回空间列表",exact:true}).click();
  await expect(image).toBeVisible();
  await page.reload();
  await expect(image).toBeVisible();
});


test("吉祥物404或错误HTML响应不显示破图和alt，导航仍可用", async ({page}) => {
  for (const status of [404, 200]) {
    await page.route("**/*apple-leopard*.png*", route => {
      if (route.request().resourceType() !== "image") return route.continue();
      return route.fulfill({ status, contentType:"text/html", body:"<!doctype html><title>Not an image</title>" });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", {name:"选择空间",exact:true})).toBeVisible();
    await expect(page.locator(".space-mascot img")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("插画暂时未能加载");
    await expect(page.getByRole("heading", {name:"选择空间",exact:true})).toBeVisible();
    await expect(page.locator(".space-entry-actions button")).toHaveCount(2);
    expect(await page.locator(".space-mascot").evaluate(el=>el.querySelector("img")===null && getComputedStyle(el).borderWidth==="0px")).toBe(true);
    await page.unroute("**/*apple-leopard*.png*");
  }
  await page.getByRole("button", {name:"剧本",exact:true}).click();
  await expect(page.getByRole("button", {name:"创建 / 管理剧本",exact:true})).toBeVisible();
  await page.getByRole("button", {name:"返回空间首页",exact:true}).click();
  await page.getByRole("button", {name:"进入日常手机",exact:true}).click();
  await expect(page.locator(".desktop")).toBeVisible();
});
