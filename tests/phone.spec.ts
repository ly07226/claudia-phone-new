import { test, expect } from "@playwright/test";
test("全部入口可点击，主题与壁纸持久化，世界角色隔离", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  for (const app of [
    "聊天",
    "手记",
    "音乐",
    "日历",
    "查手机",
    "购物",
    "阅读",
    "在场",
    "设置",
    "主题编辑器",
    "世界管理",
    "角色管理",
  ]) {
    await page.getByRole("button", { name: app, exact: true }).click();
    await expect(page.locator(".app-panel header")).toContainText(app);
    await page.getByRole("button", { name: "返回桌面" }).click();
  }
  await page.getByRole("button", { name: "主题编辑器", exact: true }).click();
  await page.getByLabel("主题色", { exact: true }).fill("#c4b7ce");
  await page
    .getByLabel("上传桌面壁纸", { exact: true })
    .setInputFiles({
      name: "wall.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(
    page.getByRole("button", { name: "使用默认壁纸" }),
  ).toBeVisible();
  await expect(page.locator(".phone")).toHaveCSS(
    "background-color",
    "rgb(196, 183, 206)",
  );
  await page.reload();
  await expect(page.locator(".phone")).toHaveCSS(
    "background-color",
    "rgb(196, 183, 206)",
  );
  await expect(page.locator(".phone")).toHaveAttribute("style", /data:image/);
  await page.getByRole("button", { name: "世界管理", exact: true }).click();
  await page.getByRole("button", { name: "创建世界", exact: true }).click();
  await page.getByLabel("世界名称").fill("晨雾");
  await page.getByLabel("世界描述").fill("第一个世界");
  await page.getByRole("button", { name: "保存世界" }).click();
  await expect(page.getByRole("heading", { name: "晨雾" })).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("世界名称").fill("晨雾森林");
  await page.getByRole("button", { name: "保存世界" }).click();
  await page.getByRole("button", { name: "查看角色" }).click();
  await page.getByRole("button", { name: "创建角色", exact: true }).click();
  await page.getByLabel("角色姓名").fill("Claudia");
  await page.getByLabel("角色人设").fill("森林守护者");
  await page.getByRole("button", { name: "保存角色" }).click();
  await expect(
    page.getByRole("heading", { name: "Claudia", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回桌面" }).click();
  await page.getByRole("button", { name: "世界管理", exact: true }).click();
  await page.getByRole("button", { name: "创建世界", exact: true }).click();
  await page.getByLabel("世界名称").fill("海边");
  await page.getByRole("button", { name: "保存世界" }).click();
  await page
    .locator(".card")
    .filter({ has: page.getByRole("heading", { name: "海边", exact: true }) })
    .getByRole("button", { name: "查看角色" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Claudia", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("当前世界").selectOption({ label: "晨雾森林" });
  await expect(
    page.getByRole("heading", { name: "Claudia", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回桌面" }).click();
  await page.getByRole("button", { name: "世界管理", exact: true }).click();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除世界晨雾森林" }).click();
  await expect(page.getByRole("heading", { name: "晨雾森林" })).toHaveCount(0);
});
test("长按、拖动、跨页移动及刷新保存", async ({ page }) => {
  await page.goto("/");
  const a = page.getByRole("button", { name: "聊天", exact: true });
  await a.dispatchEvent("pointerdown", {
    pointerId: 1,
    button: 0,
    clientX: 50,
    clientY: 400,
    pointerType: "touch",
  });
  await page.waitForTimeout(650);
  await a.dispatchEvent("pointerup", {
    pointerId: 1,
    clientX: 50,
    clientY: 400,
    pointerType: "touch",
  });
  await expect(
    page.getByRole("button", { name: "完成", exact: true }),
  ).toBeVisible();
  const source = page.locator('[data-item="app-0"]'),
    target = page.locator('[data-item="app-2"]');
  const sb = (await source.boundingBox())!,
    tb = (await target.boundingBox())!;
  await page.mouse.move(sb.x + 25, sb.y + 25);
  await page.mouse.down();
  await page.mouse.move(tb.x + 25, tb.y + 25, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(".grid [data-item]").nth(2)).toHaveAttribute(
    "data-item",
    "app-0",
  );
  await page.reload();
  await expect(page.locator(".grid [data-item]").nth(2)).toHaveAttribute(
    "data-item",
    "app-0",
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "编辑桌面", exact: true }).click();
  await page.getByRole("button", { name: "页面", exact: true }).click();
  await page.getByRole("button", { name: "桌面第1页" }).click();
  const b = (await source.boundingBox())!,
    dot = (await page
      .getByRole("button", { name: "桌面第2页" })
      .boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(dot.x + 10, dot.y + 10, { steps: 10 });
  await page.mouse.up();
  await expect(source).toBeVisible();
  await expect(page.getByRole("button", { name: "桌面第2页" })).toHaveClass(
    "active",
  );
  await page.reload();
  await page.getByRole("button", { name: "桌面第2页" }).click();
  await expect(source).toBeVisible();
});
test("真实触摸事件排序、小组件及存储故障提示", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "编辑桌面", exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  const from = (await page.locator('[data-item="app-0"]').boundingBox())!,
    to = (await page.locator('[data-item="app-2"]').boundingBox())!;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x + 24, y: from.y + 24 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: to.x + 24, y: to.y + 24 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".grid [data-item]").nth(2)).toHaveAttribute(
    "data-item",
    "app-0",
  );
  await page
    .locator(".edit-tools")
    .getByRole("button", { name: "小组件", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "删除小组件" })).toHaveCount(2);
  await page.getByRole("button", { name: "调整小组件尺寸" }).last().click();
  await page.getByRole("button", { name: "删除小组件" }).last().click();
  await expect(page.getByRole("button", { name: "删除小组件" })).toHaveCount(1);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.screenshot({ path: "artifacts/desktop-mobile.png" });
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/store.ts");
    db.close();
  });
  await page.getByRole("button", { name: "主题编辑器", exact: true }).click();
  await page.getByLabel("主题色", { exact: true }).fill("#abcdef");
  await expect(page.getByRole("alert")).toContainText("主题保存失败");
});
