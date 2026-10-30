import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  timeout: 60000,
  use: {
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:5173",
          localStorage: [
            {
              name: "claudia.navigation.v1",
              value: JSON.stringify({
                version: 1,
                route: { screen: "phone", spaceId: "daily" },
              }),
            },
          ],
        },
      ],
    },
    baseURL: "http://127.0.0.1:5173",
    ...devices["iPhone 13"],
    defaultBrowserType: "chromium",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
  reporter: "list",
});
