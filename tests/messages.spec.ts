import { test, expect } from "@playwright/test";
async function seed(page: any) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  return page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const { getConversation } = await import("/src/chatService.ts");
    await db.characters.put({
      id: "message-c",
      name: "消息角色",
      persona: "base",
    });
    await db.worlds.bulkPut([
      { id: "ma", name: "测试一", description: "", createdAt: 1 },
      { id: "mb", name: "测试二", description: "", createdAt: 1 },
    ]);
    await db.worldProfiles.bulkPut([
      { id: "pa", characterId: "message-c", worldId: "ma", setting: "" },
      { id: "pb", characterId: "message-c", worldId: "mb", setting: "" },
    ]);
    await db.apiConfigs.put({
      id: "message-api",
      name: "test",
      provider: "openai-compatible",
      baseUrl: "https://messages.example.test/v1",
      model: "test-model",
      temperature: 0.5,
      maxTokens: 100,
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.apiCredentials.put({
      configId: "message-api",
      apiKey: "synthetic-message-key",
    });
    return {
      daily: await getConversation("message-c"),
      a: await getConversation("message-c", "ma"),
      b: await getConversation("message-c", "mb"),
    };
  });
}
async function responses(page: any) {
  const requests: any[] = [];
  await page.route("https://messages.example.test/**", (r) => {
    requests.push(r.request().postDataJSON());
    return r.fulfill({
      json: { choices: [{ message: { content: `REPLY_${requests.length}` } }] },
    });
  });
  return requests;
}
test("真实重新生成追加版本，失败保留，切换和刷新上下文只含选中版本", async ({
  page,
}) => {
  const { daily } = await seed(page);
  const requests = await responses(page);
  const state = await page.evaluate(
    async ({ daily }) => {
      const { db } = await import("/src/store.ts");
      const { sendMessage, regenerateMessage } =
        await import("/src/chatService.ts");
      const { activeMessages, variantsFor } =
        await import("/src/messagePath.ts");
      const { selectVariant } = await import("/src/messageOperations.ts");
      const { buildContext } = await import("/src/chatContext.ts");
      await sendMessage(daily.id, "USER_START");
      let rows = await activeMessages(daily.id);
      const ai = rows[1];
      await regenerateMessage(daily.id, ai.id);
      const variants = await variantsFor(ai);
      const after = await activeMessages(daily.id);
      await selectVariant(daily.id, ai.id, variants[0].id);
      return {
        ai,
        variants,
        selected: after[1],
        context: await buildContext(daily),
      };
    },
    { daily },
  );
  expect(state.variants).toHaveLength(2);
  expect(state.selected.content).toBe("REPLY_2");
  expect(JSON.stringify(requests[1].messages)).not.toContain("REPLY_1");
  expect(JSON.stringify(requests[1].messages)).toContain("USER_START");
  expect(JSON.stringify(state.context)).toContain("REPLY_1");
  expect(JSON.stringify(state.context)).not.toContain("REPLY_2");
  await page.unroute("https://messages.example.test/**");
  await page.route("https://messages.example.test/**", (r) =>
    r.fulfill({
      status: 401,
      json: { error: { message: "synthetic-message-key" } },
    }),
  );
  const failed = await page.evaluate(
    async ({ daily, ai }) => {
      const { regenerateMessage } = await import("/src/chatService.ts");
      const { activeMessages, variantsFor } =
        await import("/src/messagePath.ts");
      let error = "";
      try {
        await regenerateMessage(daily.id, ai.id);
      } catch (e) {
        error = (e as Error).message;
      }
      return {
        error,
        rows: await activeMessages(daily.id),
        variants: await variantsFor(ai),
      };
    },
    { daily, ai: state.ai },
  );
  expect(failed.error).toContain("认证失败");
  expect(failed.error).not.toContain("synthetic-message-key");
  expect(failed.variants).toHaveLength(2);
  expect(failed.rows[1].content).toBe("REPLY_1");
  await page.reload();
  const persisted = await page.evaluate(async (id) => {
    const { activeMessages } = await import("/src/messagePath.ts");
    const { db } = await import("/src/store.ts");
    return {
      rows: await activeMessages(id),
      variants: await db.messageVariants
        .where("conversationId")
        .equals(id)
        .count(),
    };
  }, daily.id);
  expect(persisted.variants).toBe(2);
  expect(persisted.rows[1].activeVariantId).toBe(state.variants[0].id);
});
test("历史版本预览不写库，正式切换归档后续并可完整恢复分支，世界书只扫有效内容", async ({
  page,
}) => {
  const { daily, a, b } = await seed(page);
  await responses(page);
  const result = await page.evaluate(
    async ({ daily, a, b }) => {
      const { db } = await import("/src/store.ts");
      const { sendMessage, regenerateMessage } =
        await import("/src/chatService.ts");
      const { activeMessages, variantsFor } =
        await import("/src/messagePath.ts");
      const { selectVariant, restoreSnapshot } =
        await import("/src/messageOperations.ts");
      const { buildContext } = await import("/src/chatContext.ts");
      const { newBook, newEntry } = await import("/src/loreTypes.ts");
      await sendMessage(daily.id, "DAILY_ORIGINAL");
      const ai = (await activeMessages(daily.id))[1];
      await regenerateMessage(daily.id, ai.id);
      const variants = await variantsFor(ai);
      await sendMessage(daily.id, "TAIL_ONLY_KEYWORD");
      await sendMessage(a.id, "WORLD_A_ONLY");
      await sendMessage(b.id, "WORLD_B_ONLY");
      const book = { ...newBook(), name: "test", global: true };
      await db.lorebooks.put(book);
      await db.loreEntries.put({
        ...newEntry(book.id),
        primaryKeys: ["TAIL_ONLY_KEYWORD"],
        content: "TAIL_LORE",
      });
      const before = await activeMessages(daily.id);
      await selectVariant(daily.id, ai.id, variants[0].id, true);
      const after = await activeMessages(daily.id);
      const context = await buildContext(daily);
      const snap = (
        await db.conversationSnapshots
          .where("conversationId")
          .equals(daily.id)
          .toArray()
      )[0];
      await restoreSnapshot(daily.id, snap.id);
      const restored = await activeMessages(daily.id);
      return {
        before,
        after,
        context,
        snap,
        restored,
        a: await activeMessages(a.id),
        b: await activeMessages(b.id),
      };
    },
    { daily, a, b },
  );
  expect(result.after).toHaveLength(2);
  expect(result.snap.messages).toHaveLength(4);
  expect(
    result.restored.map((m: any) => [m.id, m.content, m.activeVariantId]),
  ).toEqual(
    result.before.map((m: any) => [m.id, m.content, m.activeVariantId]),
  );
  expect(JSON.stringify(result.context)).not.toMatch(
    /TAIL_ONLY_KEYWORD|TAIL_LORE|WORLD_A_ONLY|WORLD_B_ONLY/,
  );
  expect(result.a).toHaveLength(2);
  expect(result.b).toHaveLength(2);
});
test("编辑用户和当前 AI 版本、修订恢复、撤回和整组删除均可恢复且不污染 Prompt", async ({
  page,
}) => {
  const { daily } = await seed(page);
  await responses(page);
  const r = await page.evaluate(
    async ({ daily }) => {
      const { db } = await import("/src/store.ts");
      const { sendMessage, regenerateMessage } =
        await import("/src/chatService.ts");
      const { activeMessages, variantsFor } =
        await import("/src/messagePath.ts");
      const { editMessage, restoreRevision, removeMessage, restoreSnapshot } =
        await import("/src/messageOperations.ts");
      const { buildContext } = await import("/src/chatContext.ts");
      await sendMessage(daily.id, "original-user");
      let rows = await activeMessages(daily.id);
      const ai = rows[1];
      await regenerateMessage(daily.id, ai.id);
      const variants = await variantsFor(ai);
      await editMessage(daily.id, ai.id, "USER_EDITED_AI");
      const afterEdit = await variantsFor(ai);
      const editCtx = await buildContext(daily);
      const revision = (
        await db.messageRevisions.where("messageId").equals(ai.id).toArray()
      )[0];
      await restoreRevision(daily.id, revision.id);
      const restoredAi = (await activeMessages(daily.id))[1];
      await editMessage(daily.id, rows[0].id, "EDITED_USER", true);
      const editedUser = await activeMessages(daily.id);
      const editedCtx = await buildContext(daily);
      await sendMessage(daily.id, "", undefined, true);
      const reply = (await activeMessages(daily.id))[1];
      await removeMessage(daily.id, reply.id, "delete");
      const afterDelete = await buildContext(daily);
      const snap = (
        await db.conversationSnapshots
          .where("conversationId")
          .equals(daily.id)
          .filter((s) => s.reason === "delete")
          .toArray()
      )[0];
      await restoreSnapshot(daily.id, snap.id);
      const withdrawn = await removeMessage(
        daily.id,
        rows[0].id,
        "withdraw",
        true,
      );
      const afterWithdraw = await buildContext(daily);
      return {
        variants,
        afterEdit,
        editCtx,
        restoredAi,
        editedUser,
        editedCtx,
        afterDelete,
        afterWithdraw,
        withdrawn,
        active: await activeMessages(daily.id),
        archived: await db.messages
          .where("conversationId")
          .equals(daily.id)
          .filter((m) => !!m.archived)
          .count(),
        variantCount: await db.messageVariants
          .where("messageId")
          .equals(ai.id)
          .count(),
      };
    },
    { daily },
  );
  expect(r.afterEdit[0].content).toBe(r.variants[0].content);
  expect(r.afterEdit[1]).toMatchObject({
    content: "USER_EDITED_AI",
    userEdited: true,
    source: "generated",
  });
  expect(JSON.stringify(r.editCtx)).toContain("USER_EDITED_AI");
  expect(r.restoredAi.content).toBe(r.variants[1].content);
  expect(r.editedUser).toHaveLength(1);
  expect(JSON.stringify(r.editedCtx)).toContain("EDITED_USER");
  expect(JSON.stringify(r.editedCtx)).not.toContain("original-user");
  expect(r.afterDelete).toHaveLength(2);
  expect(r.afterWithdraw).toHaveLength(1);
  expect(r.withdrawn).toBe("EDITED_USER");
  expect(r.active).toHaveLength(0);
  expect(r.archived).toBeGreaterThan(0);
  expect(r.variantCount).toBe(2);
});
test("并发锁、生成中撤回、版本修改取消和迟到 API 响应不写入有效路径", async ({
  page,
}) => {
  const { daily } = await seed(page);
  await page.route("https://messages.example.test/**", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await r
      .fulfill({ json: { choices: [{ message: { content: "LATE_REPLY" } }] } })
      .catch(() => {});
  });
  const result = await page.evaluate(
    async ({ daily }) => {
      const { db } = await import("/src/store.ts");
      const { sendMessage, regenerateMessage } =
        await import("/src/chatService.ts");
      const { activeMessages, variantsFor } =
        await import("/src/messagePath.ts");
      const { removeMessage, editMessage } =
        await import("/src/messageOperations.ts");
      let saved!: () => void;
      const ready = new Promise<void>((r) => (saved = r));
      const sending = sendMessage(
        daily.id,
        "withdraw-during-send",
        undefined,
        false,
        async () => saved(),
      ).catch((e) => e.message);
      await ready;
      let blocked = false;
      try {
        await sendMessage(daily.id, "concurrent");
      } catch {
        blocked = true;
      }
      let user = (await activeMessages(daily.id))[0];
      await removeMessage(daily.id, user.id, "withdraw", true);
      await sending;
      const empty = await activeMessages(daily.id);
      await sendMessage(daily.id, "next");
      const ai = (await activeMessages(daily.id))[1];
      const regeneration = regenerateMessage(daily.id, ai.id).catch(
        (e) => e.message,
      );
      await new Promise((r) => setTimeout(r, 60));
      await editMessage(daily.id, ai.id, "MANUAL_WIN");
      await regeneration;
      const variants = await variantsFor(ai);
      return {
        blocked,
        empty,
        variants,
        rows: await activeMessages(daily.id),
        snapshots: await db.conversationSnapshots.count(),
      };
    },
    { daily },
  );
  expect(result.blocked).toBe(true);
  expect(result.empty).toHaveLength(0);
  expect(result.rows[1].content).toBe("MANUAL_WIN");
  expect(result.variants).toHaveLength(1);
  expect(result.snapshots).toBeGreaterThan(0);
});
test("v4 消息无损迁移为单版本，其他表逐条保持不变", async ({ page }) => {
  await seed(page);
  const before = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const { newBook, newEntry } = await import("/src/loreTypes.ts");
    const DexieBase = Object.getPrototypeOf(db.constructor);
    db.close();
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase("claudia-phone");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    const old = new DexieBase("claudia-phone");
    old.version(1).stores({
      worlds: "id,createdAt",
      characters: "id,worldId",
      pages: "id,order",
      items: "id,pageId,position",
      themes: "id,worldId",
      assets: "id,type",
    });
    old
      .version(2)
      .stores({ apiConfigs: "id,provider", apiCredentials: "configId" });
    old.version(3).stores({
      conversations: "id,&scopeKey,characterId,worldId,updatedAt",
      messages: "id,conversationId,[conversationId+createdAt]",
      worldProfiles: "id,&[worldId+characterId],worldId,characterId",
    });
    old
      .version(4)
      .stores({ lorebooks: "id,updatedAt", loreEntries: "id,lorebookId" });
    await old.open();
    const data: any = {
      worlds: [{ id: "w", name: "旧世界", description: "old", createdAt: 1 }],
      characters: [
        {
          id: "c",
          worldId: "w",
          name: "旧角色",
          persona: "old",
          apiConfigId: "api",
        },
      ],
      pages: [{ id: "page-1", order: 0 }],
      items: [
        {
          id: "item",
          kind: "app",
          app: "聊天",
          pageId: "page-1",
          position: 0,
          size: 1,
        },
      ],
      themes: [
        {
          id: "global",
          color: "#abcdef",
          font: "sans",
          iconStyle: "rounded",
          opacity: 0.4,
          blur: 18,
        },
      ],
      assets: [{ id: "asset", type: "avatar", data: "sample", createdAt: 1 }],
      apiConfigs: [
        {
          id: "api",
          name: "old",
          provider: "custom",
          baseUrl: "https://example.test",
          model: "m",
          temperature: 0.5,
          maxTokens: 10,
          enabled: true,
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      apiCredentials: [{ configId: "api", apiKey: "synthetic-only" }],
      conversations: [
        {
          id: "conv",
          scopeKey: "old",
          characterId: "c",
          mode: "daily",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      messages: [
        {
          id: "old-user",
          conversationId: "conv",
          role: "user",
          content: "OLD_USER",
          createdAt: 1,
        },
        {
          id: "old-ai",
          conversationId: "conv",
          role: "assistant",
          content: "OLD_AI",
          createdAt: 2,
        },
      ],
      worldProfiles: [
        { id: "p", characterId: "c", worldId: "w", setting: "old" },
      ],
      lorebooks: [{ ...newBook(), id: "book", name: "old", global: true }],
      loreEntries: [{ ...newEntry("book"), content: "old-lore" }],
    };
    const before: any = {};
    for (const [name, rows] of Object.entries(data)) {
      await old.table(name).bulkPut(rows);
      before[name] = await old.table(name).toArray();
    }
    old.close();
    return before;
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const { activeMessages } = await import("/src/messagePath.ts");
    const oldNames = [
      "worlds",
      "characters",
      "pages",
      "items",
      "themes",
      "assets",
      "apiConfigs",
      "apiCredentials",
      "conversations",
      "messages",
      "worldProfiles",
      "lorebooks",
      "loreEntries",
    ];
    const records: any = {};
    for (const name of oldNames) records[name] = await db.table(name).toArray();
    const variants = await db.messageVariants.toArray();
    const messages = await activeMessages("conv");
    return { records, variants, messages, version: db.verno };
  });
  const oldAi = after.records.messages.find((m: any) => m.id === "old-ai");
  expect(oldAi.activeVariantId).toBeTruthy();
  delete oldAi.activeVariantId;
  expect(after.records).toEqual(before);
  expect(after.variants).toHaveLength(1);
  expect(after.variants[0]).toMatchObject({
    messageId: "old-ai",
    conversationId: "conv",
    source: "legacy",
    content: "OLD_AI",
  });
  expect(after.messages.map((m: any) => m.content)).toEqual([
    "OLD_USER",
    "OLD_AI",
  ]);
  expect(after.version).toBe(5);
});
test("iPhone 长按、移动取消、Escape/空白关闭、编辑/复制/删除/快照恢复 UI", async ({
  page,
}) => {
  const { daily } = await seed(page);
  await responses(page);
  await page.evaluate(async (id) => {
    const { sendMessage, regenerateMessage } =
      await import("/src/chatService.ts");
    const { activeMessages } = await import("/src/messagePath.ts");
    await sendMessage(id, "UI_USER");
    await regenerateMessage(id, (await activeMessages(id))[1].id);
  }, daily.id);
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /消息角色.*开始/ }).click();
  await expect(page.locator(".chat-assistant")).toContainText("REPLY_2");
  await page.getByRole("button", { name: "上一个回复版本" }).click();
  await expect(page.locator(".chat-assistant")).toContainText("REPLY_1");
  await expect(page.getByLabel("回复版本", { exact: true })).toContainText(
    "1 / 2",
  );
  const bubble = page.locator(".chat-user");
  await bubble.scrollIntoViewIfNeeded();
  const box = (await bubble.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + 15, y: box.y + 20 }],
  });
  await page.waitForTimeout(550);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    page.getByRole("dialog", { name: "消息操作", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await bubble.dispatchEvent("pointerdown", {
    pointerId: 10,
    pointerType: "touch",
    button: 0,
    clientX: box.x + 15,
    clientY: box.y + 20,
  });
  await bubble.dispatchEvent("pointermove", {
    pointerId: 10,
    pointerType: "touch",
    clientX: box.x + 40,
    clientY: box.y + 60,
  });
  await page.waitForTimeout(550);
  await bubble.dispatchEvent("pointerup", {
    pointerId: 10,
    pointerType: "touch",
    clientX: box.x + 40,
    clientY: box.y + 60,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await bubble.getByRole("button", { name: /消息操作/ }).click();
  await page.locator(".message-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await bubble.getByRole("button", { name: /消息操作/ }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("编辑消息内容")).toHaveValue("UI_USER");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(bubble).toContainText("UI_USER");
  await bubble.getByRole("button", { name: /消息操作/ }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("编辑消息内容").fill("UI_EDITED");
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "仅保存修改" }).click();
  await expect(page.locator(".chat-assistant")).toHaveCount(0);
  await expect(bubble).toContainText("UI_EDITED");
  await page.getByRole("button", { name: "重试最后一条消息" }).click();
  await expect(page.locator(".chat-assistant")).toHaveCount(1);
  await page
    .locator(".chat-assistant")
    .getByRole("button", { name: /消息操作/ })
    .click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("编辑消息内容").fill("");
  await expect(page.getByRole("button", { name: "仅保存修改" })).toBeDisabled();
  await page.getByLabel("编辑消息内容").fill("UI_AI_EDIT");
  await page.getByRole("button", { name: "仅保存修改" }).click();
  await expect(page.locator(".chat-assistant")).toContainText("用户已编辑");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__copiedMessage = text;
        },
      },
    }),
  );
  await page
    .locator(".chat-assistant")
    .getByRole("button", { name: /消息操作/ })
    .click();
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "已复制",
  );
  expect(await page.evaluate(() => (window as any).__copiedMessage)).toBe(
    "UI_AI_EDIT",
  );
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".chat-assistant")).toHaveCount(0);
  await page.getByRole("button", { name: "会话管理", exact: true }).click();
  await page.getByRole("button", { name: "历史快照 / 分支恢复" }).click();
  await page.getByRole("button", { name: "恢复此快照" }).first().click();
  await expect(page.locator(".chat-assistant")).toContainText("UI_AI_EDIT");
});
test("历史版本只预览，确认后才建立快照，整组删除与迟到响应保护", async ({
  page,
}) => {
  const { daily } = await seed(page);
  await responses(page);
  await page.evaluate(async (id) => {
    const { sendMessage, regenerateMessage } =
      await import("/src/chatService.ts");
    const { activeMessages } = await import("/src/messagePath.ts");
    await sendMessage(id, "FIRST");
    await regenerateMessage(id, (await activeMessages(id))[1].id);
    await sendMessage(id, "TAIL");
  }, daily.id);
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /消息角色.*开始/ }).click();
  await page
    .locator(".chat-assistant")
    .first()
    .getByRole("button", { name: "上一个回复版本" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("尚未应用");
  expect(
    await page.evaluate(async (id) => {
      const { activeMessages } = await import("/src/messagePath.ts");
      return (await activeMessages(id)).length;
    }, daily.id),
  ).toBe(4);
  await page.getByRole("button", { name: "关闭消息面板" }).click();
  await page
    .locator(".chat-assistant")
    .first()
    .getByRole("button", { name: "上一个回复版本" })
    .click();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "使用此版本" }).click();
  await expect(page.locator(".chat-bubble")).toHaveCount(2);
  const result = await page.evaluate(async (id) => {
    const { db } = await import("/src/store.ts");
    const { activeMessages, variantsFor } = await import("/src/messagePath.ts");
    const { removeMessage, restoreSnapshot, editMessage } =
      await import("/src/messageOperations.ts");
    const { regenerateMessage } = await import("/src/chatService.ts");
    const { browserTransport } = await import("/src/api.ts");
    const { buildContext } = await import("/src/chatContext.ts");
    const ai = (await activeMessages(id))[1];
    await removeMessage(id, ai.id, "delete");
    const deleted = await buildContext((await db.conversations.get(id))!);
    const count = (await variantsFor(ai)).length;
    const snap = (
      await db.conversationSnapshots
        .where("conversationId")
        .equals(id)
        .filter((s) => s.reason === "delete")
        .toArray()
    )[0];
    await restoreSnapshot(id, snap.id);
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => (reached = r));
    const gate = new Promise<void>((r) => (release = r));
    const original = browserTransport.send;
    browserTransport.send = async () => {
      reached();
      await gate;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "FORBIDDEN_LATE" } }],
        }),
        { status: 200 },
      );
    };
    try {
      const pending = regenerateMessage(id, ai.id).catch((e) => e.message);
      await ready;
      await editMessage(id, ai.id, "LATEST_MANUAL");
      release();
      await pending;
      return {
        deleted,
        count,
        rows: await activeMessages(id),
        variants: await variantsFor(ai),
      };
    } finally {
      browserTransport.send = original;
      release();
    }
  }, daily.id);
  expect(result.deleted).toHaveLength(2);
  expect(result.count).toBe(2);
  expect(result.rows[1].content).toBe("LATEST_MANUAL");
  expect(result.variants).toHaveLength(2);
  expect(result.variants.some((v: any) => v.content === "FORBIDDEN_LATE")).toBe(
    false,
  );
});
test("请求进行中撤回并恢复输入框，编辑最新用户消息后保存并真实重新回复", async ({
  page,
}) => {
  const { daily } = await seed(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("https://messages.example.test/**", async (r) => {
    await gate;
    await r
      .fulfill({
        json: { choices: [{ message: { content: "SHOULD_NOT_APPEAR" } }] },
      })
      .catch(() => {});
  });
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /消息角色.*开始/ }).click();
  await page.getByLabel("聊天消息").fill("WITHDRAW_INFLIGHT");
  const request = page.waitForRequest(
    "https://messages.example.test/v1/chat/completions",
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await request;
  await expect(page.getByRole("status")).toContainText("正在回复");
  await page
    .locator(".chat-user")
    .getByRole("button", { name: /消息操作/ })
    .click();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "撤回", exact: true }).click();
  await expect(page.locator(".chat-bubble")).toHaveCount(0);
  await expect(page.getByLabel("聊天消息")).toHaveValue("WITHDRAW_INFLIGHT");
  release();
  await page.waitForTimeout(100);
  await expect(page.locator(".chat-assistant")).toHaveCount(0);
  await page.unroute("https://messages.example.test/**");
  const requests = await responses(page);
  await page.getByLabel("聊天消息").fill("ORIGINAL_EDIT");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-assistant")).toContainText("REPLY_1");
  await page
    .locator(".chat-user")
    .getByRole("button", { name: /消息操作/ })
    .click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("编辑消息内容").fill("EDIT_AND_GENERATE");
  await page.getByRole("button", { name: "保存并重新回复" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".chat-assistant")).toContainText("REPLY_2");
  await expect(page.locator(".chat-user")).toHaveCount(1);
  expect(JSON.stringify(requests[1].messages)).toContain("EDIT_AND_GENERATE");
  expect(JSON.stringify(requests[1].messages)).not.toMatch(
    /ORIGINAL_EDIT|REPLY_1|WITHDRAW_INFLIGHT/,
  );
  expect(
    await page.evaluate(async (id) => {
      const { db } = await import("/src/store.ts");
      return db.conversationSnapshots
        .where("conversationId")
        .equals(id)
        .count();
    }, daily.id),
  ).toBeGreaterThanOrEqual(2);
});
test("历史重新生成只取目标之前上下文，版本预览不触发世界书，跨标签撤回取消生成", async ({
  page,
  context,
}) => {
  const { daily } = await seed(page);
  const requests = await responses(page);
  const before = await page.evaluate(async (id) => {
    const { db } = await import("/src/store.ts");
    const { sendMessage, regenerateMessage } =
      await import("/src/chatService.ts");
    const { activeMessages } = await import("/src/messagePath.ts");
    await sendMessage(id, "PREFIX_USER");
    const ai = (await activeMessages(id))[1];
    await sendMessage(id, "EXCLUDED_TAIL");
    await regenerateMessage(id, ai.id, undefined, true);
    return {
      rows: await activeMessages(id),
      variants: await db.messageVariants
        .where("messageId")
        .equals(ai.id)
        .count(),
    };
  }, daily.id);
  expect(before.rows).toHaveLength(2);
  expect(before.variants).toBe(2);
  expect(JSON.stringify(requests[2].messages)).toContain("PREFIX_USER");
  expect(JSON.stringify(requests[2].messages)).not.toMatch(
    /EXCLUDED_TAIL|REPLY_1|REPLY_2/,
  );
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.unroute("https://messages.example.test/**");
  await page.route("https://messages.example.test/**", async (r) => {
    await gate;
    await r
      .fulfill({
        json: { choices: [{ message: { content: "CROSS_TAB_LATE" } }] },
      })
      .catch(() => {});
  });
  const started = page.waitForRequest(
    "https://messages.example.test/v1/chat/completions",
  );
  await page.evaluate((id) => {
    (window as any).__running = import("/src/chatService.ts")
      .then(({ sendMessage }) => sendMessage(id, "CROSS_TAB_USER"))
      .then(
        () => ({ ok: true }),
        () => ({ cancelled: true }),
      );
  }, daily.id);
  await started;
  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate(async (id) => {
    const { activeMessages } = await import("/src/messagePath.ts");
    const { removeMessage } = await import("/src/messageOperations.ts");
    const user = (await activeMessages(id))
      .filter((m) => m.role === "user")
      .at(-1)!;
    await removeMessage(id, user.id, "withdraw", true);
  }, daily.id);
  release();
  const status = await page.evaluate(() => (window as any).__running);
  expect(status.cancelled).toBe(true);
  const after = await page.evaluate(async (id) => {
    const { activeMessages } = await import("/src/messagePath.ts");
    return activeMessages(id);
  }, daily.id);
  expect(after).toHaveLength(2);
  expect(JSON.stringify(after)).not.toMatch(/CROSS_TAB_USER|CROSS_TAB_LATE/);
  await other.close();
});
test("版本写入失败事务回滚，不产生空 AI 组或丢失历史后续消息", async ({
  page,
}) => {
  const { daily } = await seed(page);
  await responses(page);
  const result = await page.evaluate(async (id) => {
    const { db } = await import("/src/store.ts");
    const { sendMessage, regenerateMessage } =
      await import("/src/chatService.ts");
    const { activeMessages, variantsFor } = await import("/src/messagePath.ts");
    const original = db.messageVariants.add.bind(db.messageVariants);
    db.messageVariants.add = (async () => {
      throw Error("simulated quota");
    }) as typeof db.messageVariants.add;
    let failed = false;
    try {
      await sendMessage(id, "saved-user");
    } catch {
      failed = true;
    } finally {
      db.messageVariants.add = original;
    }
    const afterFailure = await activeMessages(id);
    await sendMessage(id, "", undefined, true);
    const ai = (await activeMessages(id))[1];
    await sendMessage(id, "preserved-tail");
    const before = await activeMessages(id);
    const snapshots = await db.conversationSnapshots.count();
    db.messageVariants.add = (async () => {
      throw Error("simulated quota");
    }) as typeof db.messageVariants.add;
    let regenFailed = false;
    try {
      await regenerateMessage(id, ai.id, undefined, true);
    } catch {
      regenFailed = true;
    } finally {
      db.messageVariants.add = original;
    }
    return {
      failed,
      afterFailure,
      regenFailed,
      before,
      after: await activeMessages(id),
      snapshotsBefore: snapshots,
      snapshotsAfter: await db.conversationSnapshots.count(),
      variants: await variantsFor(ai),
    };
  }, daily.id);
  expect(result.failed).toBe(true);
  expect(result.afterFailure.map((m: any) => m.role)).toEqual(["user"]);
  expect(result.regenFailed).toBe(true);
  expect(result.after).toEqual(result.before);
  expect(result.snapshotsAfter).toBe(result.snapshotsBefore);
  expect(result.variants).toHaveLength(1);
});
test("编辑器固定打开时版本，生成完成后不能把旧草稿误写到新版本", async ({
  page,
}) => {
  const { daily } = await seed(page);
  await responses(page);
  await page.evaluate(async (id) => {
    const { sendMessage } = await import("/src/chatService.ts");
    await sendMessage(id, "OPEN_EDITOR");
  }, daily.id);
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /消息角色.*开始/ }).click();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.unroute("https://messages.example.test/**");
  await page.route("https://messages.example.test/**", async (r) => {
    await gate;
    await r.fulfill({
      json: { choices: [{ message: { content: "NEW_API_VERSION" } }] },
    });
  });
  await page
    .locator(".chat-assistant")
    .getByRole("button", { name: /消息操作/ })
    .click();
  const request = page.waitForRequest(
    "https://messages.example.test/v1/chat/completions",
  );
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await request;
  await page
    .locator(".chat-assistant")
    .getByRole("button", { name: /消息操作/ })
    .click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("编辑消息内容")).toHaveValue("REPLY_1");
  await page.getByLabel("编辑消息内容").fill("OLD_DRAFT");
  release();
  await expect(page.locator(".chat-assistant")).toContainText(
    "NEW_API_VERSION",
  );
  await page.getByRole("button", { name: "仅保存修改" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "消息已在其他操作中变化",
  );
  const state = await page.evaluate(async (id) => {
    const { activeMessages } = await import("/src/messagePath.ts");
    const { db } = await import("/src/store.ts");
    return {
      rows: await activeMessages(id),
      variants: await db.messageVariants
        .where("conversationId")
        .equals(id)
        .toArray(),
    };
  }, daily.id);
  expect(state.rows[1].content).toBe("NEW_API_VERSION");
  expect(state.variants.some((v) => v.content === "OLD_DRAFT")).toBe(false);
});

test("单版本无切换器及占位，重新生成成功显示新版本，失败保持原显示", async ({ page }) => {
  const { daily } = await seed(page);
  await responses(page);
  await page.evaluate(async (id) => {
    const { sendMessage } = await import("/src/chatService.ts");
    await sendMessage(id, "UI_SINGLE_VERSION");
  }, daily.id);
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /消息角色.*开始/ }).click();
  const ai = page.locator(".chat-assistant");
  const switcher = ai.getByLabel("回复版本", { exact: true });
  await expect(ai).toContainText("REPLY_1");
  await expect(switcher).toHaveCount(0);
  expect(await ai.evaluate(el => {
    const surface = el.querySelector(".chat-bubble-surface")!;
    return Math.abs(el.getBoundingClientRect().height - surface.getBoundingClientRect().height);
  })).toBeLessThanOrEqual(1);
  let fail = true;
  await page.unroute("https://messages.example.test/**");
  await page.route("https://messages.example.test/**", r => fail
    ? r.fulfill({ status: 401, json: { error: { message: "Unauthorized" } } })
    : r.fulfill({ json: { choices: [{ message: { content: "NEW_VERSION" } }] } }));
  async function regenerate() {
    await ai.getByRole("button", { name: "AI 消息操作" }).click();
    await page.getByRole("button", { name: "重新生成", exact: true }).click();
  }
  await regenerate();
  await expect(page.getByRole("alert")).toContainText("认证失败");
  await expect(ai).toContainText("REPLY_1");
  await expect(switcher).toHaveCount(0);
  fail = false;
  await regenerate();
  await expect(ai).toContainText("NEW_VERSION");
  await expect(switcher).toContainText("2 / 2");
  await expect(switcher.getByRole("button", { name: "上一个回复版本" })).toBeEnabled();
  await expect(switcher.getByRole("button", { name: "下一个回复版本" })).toBeDisabled();
  fail = true;
  await regenerate();
  await expect(page.getByRole("alert")).toContainText("认证失败");
  await expect(ai).toContainText("NEW_VERSION");
  await expect(switcher).toContainText("2 / 2");
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /消息角色.*开始/ }).click();
  await expect(ai).toContainText("NEW_VERSION");
  await expect(switcher).toContainText("2 / 2");
});
