import { test, expect, type Page } from "@playwright/test";
import {isolatedApp} from './backupBrowser';
// Follow the current five-step creation UI; no API is configured in this isolated test.
async function createWorld(page:Page,name:string,description:string){
  await page.getByRole('button',{name:'创建新剧本',exact:true}).click();
  const another=page.getByRole('button',{name:'开始另一份草稿',exact:true});
  await expect(page.getByLabel('故事标题',{exact:true}).or(another)).toBeVisible();
  if(await another.isVisible()){page.once('dialog',d=>d.accept());await another.click();}
  await page.getByLabel('故事标题',{exact:true}).fill(name);
  await page.getByLabel('整体剧情梗概',{exact:true}).fill(description);
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  await page.getByLabel('主控姓名',{exact:true}).fill('测试主控');
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  await page.getByRole('button',{name:'＋ 自定义角色',exact:true}).click();
  await page.getByLabel('角色1姓名',{exact:true}).fill(name+'同行者');
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  await page.getByLabel('开场场景',{exact:true}).fill('旅程开始。');
  await page.getByRole('button',{name:'确认开局',exact:true}).click();
  await expect(page.getByRole('button',{name:'返回剧本世界列表',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回剧本世界列表',exact:true}).click();
}
test("全部入口可点击，主题与壁纸持久化，世界角色隔离", async ({ page }) => {
  await isolatedApp(page,"phone-theme-regression-"+crypto.randomUUID());
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
  await page.getByLabel("页面背景 HEX", { exact: true }).fill("#c4b7ce");
  await page.getByRole("button", {name:"保存配色与 CSS",exact:true}).click();
  await expect(page.locator(".theme-editor [role=status]")).toContainText("已保存");
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
  await createWorld(page,'晨雾','第一个世界');
  await expect(page.getByRole("heading", {name:'晨雾',exact:true})).toBeVisible();
  await page.getByLabel('更多 · 晨雾',{exact:true}).click();
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel("世界名称").fill("晨雾森林");
  await page.getByRole("button", { name: "保存世界" }).click();
  await page.getByLabel('更多 · 晨雾森林',{exact:true}).click();
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
  await createWorld(page,'海边','第二个世界');
  await page.getByLabel('更多 · 海边',{exact:true}).click();
  await page.getByRole('button',{name:'查看角色',exact:true}).click();
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
  await page.screenshot({ path: process.env.CLAUDIA_DESKTOP_SCREENSHOT || "artifacts/desktop-mobile.png" });
  await page.getByRole("button", { name: "主题与桌面", exact: true }).click();
  await page.getByLabel("页面背景 HEX", { exact: true }).fill("#abcdef");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/store.ts");
    db.close();
  });
  await page.getByRole("button", {name:"保存配色与 CSS",exact:true}).click();
  await expect(page.getByRole("alert")).toContainText("保存失败");
});
