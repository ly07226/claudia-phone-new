import { test, expect, type Page } from "@playwright/test";

test("纯函数：自然句、换行、动作与混合语言分段且逐字保真", async ({ page }) => {
  await page.goto("/");
  const cases = [
    "你好。\n今天过得怎么样？\n我在这里。",
    "今天一路上遇到了许多有趣的事情，我想慢慢讲给你听。".repeat(8),
    "这是一个包含许多逗号，但是尚未结束，而且需要保持完整的句子，".repeat(8) +
      "终于结束。",
    "第一段。\n\n第二段。\r\n第三段。",
    "（他抬起头，轻轻笑了笑。）“今天要一起出去吗？”\n*他转身看向窗外。*\n我等你。",
    "（" + "他抬头看向远处，慢慢走过长廊。".repeat(24) + "）",
    "Hello there. 今天好吗？".repeat(12),
    "“你好，世界！”（不是所有括号都是动作。）*强调的内容*\n保留全部标记。",
    "",
    "\n\n\r\n ",
    "\n\n你好。\n\n",
    "未闭合的“引号。不要强行拆分。\n仍保留原文。",
    "**强调内容。**\n```ts\nconst x = '(raw)';\n```",
    "（" + "这是一段说明文字，并不是动作。".repeat(24) + "）",
    "Dr. Smith uses version 1.2. Test the U.S. endpoint. Don't change https://example.test/path.",
  ];
  const results = await page.evaluate(async (cases) => {
    const { splitAssistantBubbles } =
      await import("/src/splitAssistantBubbles.ts");
    return cases.map((text) => ({
      pieces: splitAssistantBubbles(text),
      again: splitAssistantBubbles(text),
    }));
  }, cases);
  results.forEach(({ pieces, again }, i) => {
    expect(pieces).toEqual(again);
    expect(pieces.every((p) => p.trim().length > 0)).toBe(true);
    expect(pieces.join("")).toBe(cases[i].trim() ? cases[i] : "");
  });
  expect(results[0].pieces).toHaveLength(3);
  expect(results[1].pieces.length).toBeGreaterThan(1);
  expect(results[1].pieces.every((p) => p.length <= 100)).toBe(true);
  expect(results[2].pieces).toHaveLength(1); // Never cut a long sentence at commas.
  expect(results[3].pieces).toHaveLength(3);
  expect(results[4].pieces[0]).toContain("“今天要一起出去吗？”");
  expect(results[5].pieces.length).toBeGreaterThan(1);
  expect(results[5].pieces.every((p) => p.length <= 180)).toBe(true);
  expect(results[6].pieces.length).toBeGreaterThan(1);
  expect(results[11].pieces).toEqual([cases[11]]);
  expect(results[12].pieces).toEqual([cases[12]]);
  expect(results[13].pieces).toEqual([cases[13]]);
});

async function openLegacy(page: Page, supplied?: string) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  const original =
    supplied ??
    "（他抬头，轻轻笑了。）“你好。”\n\n今天过得怎么样？\n我会在这里陪你。";
  const ids = await page.evaluate(async (content) => {
    const { db } = await import("/src/store.ts");
    const { getConversation } = await import("/src/chatService.ts");
    await db.characters.put({ id: "bubble-c", name: "气泡角色", persona: "" });
    const c = await getConversation("bubble-c");
    // Existing single-message records; no re-saving or migration for presentation.
    await db.messages.bulkPut([
      {
        id: "bubble-user",
        conversationId: c.id,
        role: "user",
        content,
        createdAt: 1,
      },
      {
        id: "bubble-ai",
        conversationId: c.id,
        role: "assistant",
        content,
        activeVariantId: "bubble-v1",
        createdAt: 2,
      },
    ]);
    await db.messageVariants.put({
      id: "bubble-v1",
      conversationId: c.id,
      messageId: "bubble-ai",
      content,
      source: "legacy",
      createdAt: 2,
    });
    return { conversationId: c.id };
  }, original);
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /气泡角色.*开始/ }).click();
  return { original, ...ids };
}

test("旧消息分组显示、用户不拆、单版本隐藏，多版本整组更新并持久化原文", async ({
  page,
}) => {
  const { original, conversationId } = await openLegacy(page);
  const ai = page.locator(".chat-assistant");
  await expect(ai.locator(".chat-bubble-surface")).toHaveCount(3);
  await expect(page.locator(".chat-user .chat-bubble-surface")).toHaveCount(1);
  await expect(
    page.locator(".chat-message-row-assistant .chat-avatar"),
  ).toHaveCount(1);
  await expect(ai.getByRole("button", { name: "AI 消息操作" })).toHaveCount(1);
  await expect(ai.getByLabel("回复版本", { exact: true })).toHaveCount(0);
  expect((await ai.locator("p").allTextContents()).join("")).toBe(original);
  const next = "新的第一段。\n新的第二段。";
  await page.evaluate(
    async ({ conversationId, content }) => {
      const { db } = await import("/src/store.ts");
      await db.messageVariants.put({
        id: "bubble-v2",
        conversationId,
        messageId: "bubble-ai",
        content,
        source: "generated",
        createdAt: 3,
      });
    },
    { conversationId, content: next },
  );
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /气泡角色.*开始/ }).click();
  await expect(ai.getByLabel("回复版本", { exact: true })).toContainText(
    "1 / 2",
  );
  await ai.getByRole("button", { name: "下一个回复版本" }).click();
  await expect(ai.locator(".chat-bubble-surface")).toHaveCount(2);
  expect((await ai.locator("p").allTextContents()).join("")).toBe(next);
  await expect(ai.getByLabel("回复版本", { exact: true })).toContainText(
    "2 / 2",
  );
  const state = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    return {
      messages: await db.messages.toArray(),
      variants: await db.messageVariants.toArray(),
      version: db.verno,
    };
  });
  expect(state.messages).toHaveLength(2);
  expect(state.messages.find((m) => m.id === "bubble-ai")?.content).toBe(next);
  expect(state.variants.find((v) => v.id === "bubble-v1")?.content).toBe(
    original,
  );
  expect(state.version).toBe(5);
});

test("长按任意片段操作整条消息，复制、编辑、删除保留完整原文", async ({
  page,
}) => {
  const { original } = await openLegacy(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__copiedBubbleText = text;
        },
      },
    });
  });
  const surfaces = page.locator(".chat-assistant .chat-bubble-surface");
  for (let i = 0; i < 3; i++) {
    await surfaces.nth(i).dispatchEvent("pointerdown", {
      pointerId: i + 1,
      pointerType: "touch",
      button: 0,
      clientX: 80,
      clientY: 200,
    });
    await expect(
      page.getByRole("dialog", { name: "消息操作", exact: true }),
    ).toBeVisible();
    await surfaces.nth(i).dispatchEvent("pointerup", { pointerId: i + 1 });
    await expect(
      page.getByRole("button", { name: "重新生成", exact: true }),
    ).toBeVisible();
    if (i < 2) await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "复制", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__copiedBubbleText)).toBe(
    original,
  );
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("编辑消息内容")).toHaveValue(original);
  const edited = original + "\n编辑后的完整第四段。";
  await page.getByLabel("编辑消息内容").fill(edited);
  await page.getByRole("button", { name: "仅保存修改" }).click();
  await expect(surfaces).toHaveCount(4);
  expect((await surfaces.locator("p").allTextContents()).join("")).toBe(edited);
  await page
    .locator(".chat-assistant")
    .getByRole("button", { name: "AI 消息操作" })
    .press("Enter");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("编辑消息内容")).toHaveValue(edited);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .locator(".chat-assistant")
    .getByRole("button", { name: "AI 消息操作" })
    .press("Enter");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".chat-assistant")).toHaveCount(0);
  expect(
    await page.evaluate(async (edited) => {
      const { db } = await import("/src/store.ts");
      const snapshots = await db.conversationSnapshots.toArray();
      return snapshots.some((s) =>
        s.messages.some((m) => m.id === "bubble-ai" && m.content === edited),
      );
    }, edited),
  ).toBe(true);
});

test("2.3.4.3 短句直接分泡、连续标点闭合引号、动作及空白保真", async ({
  page,
}) => {
  await page.goto("/");
  const examples = [
    [
      "我今天其实也没干什么特别的事，大部分时间都在这里陪你聊天，顺便数着头顶的月亮消磨时间。日子过得挺清闲的。",
      [
        "我今天其实也没干什么特别的事，大部分时间都在这里陪你聊天，顺便数着头顶的月亮消磨时间。",
        "日子过得挺清闲的。",
      ],
    ],
    ["你好。今天好吗？", ["你好。", "今天好吗？"]],
    [
      "这个句子虽然很长，而且有许多逗号，但应该继续保持完整，不能仅仅因为逗号或者字符数量增加就被随意拆成几个小片段。",
      [
        "这个句子虽然很长，而且有许多逗号，但应该继续保持完整，不能仅仅因为逗号或者字符数量增加就被随意拆成几个小片段。",
      ],
    ],
    ["真的？！好的！！再见。。。", ["真的？！", "好的！！", "再见。。。"]],
    [
      "他说：“今天好吗？！”然后问候你。",
      ["他说：“今天好吗？！”", "然后问候你。"],
    ],
    ["“先走吧。”“明天见！”", ["“先走吧。”", "“明天见！”"]],
    [
      "（他抬起头，笑了笑。）“我在这里。”",
      ["（他抬起头，笑了笑。）“我在这里。”"],
    ],
    ["*他轻声笑了笑。*“别担心！”", ["*他轻声笑了笑。*“别担心！”"]],
    [
      "\n\n你好。\n\r\n\n今天好吗？\n\n",
      ["\n\n你好。\n\r\n\n", "今天好吗？\n\n"],
    ],
    ["你好。\n！！！\n我在这里。", ["你好。\n！！！\n", "我在这里。"]],
    ["！？你好。再见！", ["！？你好。", "再见！"]],
    ["```text\n你好。再见。\n```", ["```text\n你好。再见。\n```"]],
    ["未闭合的（动作。然后。", ["未闭合的（动作。然后。"]],
  ] as const;
  const output = await page.evaluate(
    async (texts) => {
      const { splitAssistantBubbles } =
        await import("/src/splitAssistantBubbles.ts");
      return texts.map((t) => splitAssistantBubbles(t));
    },
    examples.map((e) => e[0]),
  );
  examples.forEach(([input, expected], i) => {
    expect(output[i]).toEqual(expected);
    expect(output[i].join("")).toBe(input);
    expect(output[i].every((p) => /[\p{L}\p{N}\p{S}]/u.test(p))).toBe(true);
  });
});

test("2.3.4.3 真机案例在 AI 显示两个气泡，用户仍为单气泡", async ({ page }) => {
  const sample =
    "我今天其实也没干什么特别的事，大部分时间都在这里陪你聊天，顺便数着头顶的月亮消磨时间。日子过得挺清闲的。";
  await openLegacy(page, sample);
  const ai = page.locator(".chat-assistant");
  await expect(ai.locator(".chat-bubble-surface")).toHaveCount(2);
  expect((await ai.locator("p").allTextContents()).join("")).toBe(sample);
  await expect(page.locator(".chat-user .chat-bubble-surface")).toHaveCount(1);
  await expect(ai.getByRole("button", { name: "AI 消息操作" })).toHaveCount(1);
  await expect(ai.getByLabel("回复版本", { exact: true })).toHaveCount(0);
});
