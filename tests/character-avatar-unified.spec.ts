import { test, expect, type Locator } from "@playwright/test";

async function boundedAvatar(frame: Locator, size: number, src?: string) {
  await frame.evaluate(async el => {
    const animations = new Set<Animation>();
    for (let node: Element | null = el; node; node = node.parentElement)
      for (const animation of node.getAnimations())
        if (animation.effect?.getTiming().iterations !== Infinity) animations.add(animation);
    await Promise.all([...animations].map(animation => animation.finished.catch(() => {})));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const image = frame.locator(":scope > img");
  if (src) {
    await expect(image).toHaveAttribute("src", src);
    await image.evaluate(async (el: HTMLImageElement) => el.decode());
  }
  // One synchronous layout snapshot: parent/child cannot be sampled across animation frames.
  const { box, img } = await frame.evaluate(el => {
    const rect = (node: Element) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const child = el.querySelector(":scope > img");
    return { box: rect(el), img: child ? rect(child) : null };
  });
  expect(Math.abs(box.width - size)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - size)).toBeLessThanOrEqual(1);
  if (src) {
    expect(img).not.toBeNull();
    if (!img) throw new Error("Avatar image missing");
    expect(img.x).toBeGreaterThanOrEqual(box.x);
    expect(img.y).toBeGreaterThanOrEqual(box.y);
    expect(img.x + img.width).toBeLessThanOrEqual(box.x + box.width);
    expect(img.y + img.height).toBeLessThanOrEqual(box.y + box.height);
    expect(Math.abs(img.width - img.height)).toBeLessThanOrEqual(1);
    await expect(image).toHaveCSS("object-fit", "cover");
    await expect(image).toHaveCSS("object-position", "50% 50%");
  } else {
    await expect(frame.locator(":scope > svg")).toBeVisible();
  }
}

for (const width of [375, 390, 430]) {
  test(`统一头像与角色卡片：${width}px 三种构图、展开、编辑及聊天`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "角色管理", exact: true }).click();
    const fixture = await page.evaluate(async () => {
      const { db, usePhone } = await import("/src/store.ts");
      const { getConversation } = await import("/src/chatService.ts");
      const shapes = [["portrait", 160, 320], ["landscape", 320, 160], ["square", 240, 240]] as const;
      const sources: Record<string, string> = {};
      for (const [shape, w, h] of shapes) {
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#a8bba0"; ctx.fillRect(0, 0, w, h);
        const r = Math.min(w, h) * 0.3;
        ctx.fillStyle = "#fff8e7"; ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = "#425b48";
        for (const x of [-0.3, 0.3]) { ctx.beginPath(); ctx.arc(w / 2 + r * x, h / 2 - r * 0.15, r * 0.07, 0, 2 * Math.PI); ctx.fill(); }
        ctx.strokeStyle = "#425b48"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(w / 2, h / 2 + r * 0.05, r * 0.3, 0, Math.PI); ctx.stroke();
        sources[shape] = canvas.toDataURL("image/png");
        await db.assets.put({ id: `unified-${shape}`, type: "avatar", data: sources[shape], createdAt: 1 });
        await db.characters.put({ id: shape, name: `${shape} 测试角色`, persona: shape === "portrait" ? "长篇基础人设。\n".repeat(400) : "基础人设摘要，保留原始资料。", speakingStyle: "温和\n简洁", avatar: `unified-${shape}` });
        const c = await getConversation(shape);
        await db.messages.put({ id: `msg-${shape}`, conversationId: c.id, role: "assistant", content: "测试回复。", activeVariantId: `v-${shape}`, createdAt: 1 });
        await db.messageVariants.put({ id: `v-${shape}`, messageId: `msg-${shape}`, conversationId: c.id, content: "测试回复。", createdAt: 1 });
      }
      await db.characters.put({ id: "blank", name: "空白人设角色", persona: "" });
      await usePhone.getState().reload();
      return { sources, characters: await db.characters.toArray(), assets: await db.assets.toArray() };
    });
    const cards = page.locator(".character-card");
    await expect(cards).toHaveCount(4);
    await expect(page.locator(".character-details")).toHaveCount(0);
    for (const shape of ["portrait", "landscape", "square", "blank"]) {
      const card = page.locator(`[data-character-id="${shape}"]`);
      await boundedAvatar(card.locator(".character-list-avatar"), 76, fixture.sources[shape]);
      const avatar = (await card.locator(".character-list-avatar").boundingBox())!;
      const info = (await card.locator(".character-card-info").boundingBox())!;
      expect(info.x).toBeGreaterThan(avatar.x + avatar.width);
      expect(Math.abs(info.y - avatar.y)).toBeLessThanOrEqual(1);
      const summary = card.locator(".character-summary");
      expect(await summary.evaluate(el => el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) * 2 + 1)).toBe(true);
      const bar = (await card.locator(".api-actions").boundingBox())!;
      expect(bar.y).toBeGreaterThanOrEqual(Math.max(avatar.y + avatar.height, info.y + info.height));
      for (const name of ["展开", "编辑角色", "删除角色"]) {
        const button = card.getByRole("button", { name, exact: true });
        await expect(button).toBeEnabled();
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await expect(page.locator('[data-character-id="blank"] .character-summary')).toHaveText("尚未填写人设");
    await cards.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/character-unified-${width}-collapsed.png` });
    const first = page.locator('[data-character-id="portrait"]');
    await first.getByRole("button", { name: "展开", exact: true }).click();
    await expect(first.getByRole("region")).toContainText("温和\n简洁");
    await expect(page.locator(".character-details")).toHaveCount(1);
    expect(await first.getByRole("region").evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/character-unified-${width}-expanded.png` });
    await first.getByRole("button", { name: "收起", exact: true }).click();
    // Exercise visible edit and confirmed-cancel delete controls without changing records.
    page.on("dialog", dialog => void dialog.dismiss());
    await first.getByRole("button", { name: "删除角色", exact: true }).click();
    await expect(first).toBeVisible();
    for (const shape of ["portrait", "landscape", "square"]) {
      await page.locator(`[data-character-id="${shape}"]`).getByRole("button", { name: "编辑角色", exact: true }).click();
      await boundedAvatar(page.locator(".character-avatar-preview"), 88, fixture.sources[shape]);
      if (shape === "portrait") await page.screenshot({ path: `artifacts/character-unified-${width}-editor.png` });
      await page.getByRole("button", { name: "取消", exact: true }).click();
    }
    await page.evaluate(async () => (await import("/src/store.ts")).usePhone.getState().set({ activeApp: "聊天" }));
    for (const shape of ["portrait", "landscape", "square"]) {
      await page.getByRole("button", { name: new RegExp(`${shape} 测试角色`) }).click();
      await expect(page.locator(".chat-avatar-character")).toHaveCount(1);
      await boundedAvatar(page.locator(".chat-avatar-character"), 34, fixture.sources[shape]);
      await page.screenshot({ path: `artifacts/character-unified-${width}-chat-${shape}.png` });
      await page.getByRole("button", { name: "返回角色列表", exact: true }).click();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(async () => { const { db } = await import("/src/store.ts"); return { characters: await db.characters.toArray(), assets: await db.assets.toArray() }; })).toEqual({ characters: fixture.characters, assets: fixture.assets });
  });
}
