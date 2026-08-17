import { defineConfig } from "vitepress";

export default defineConfig({
  title: "basis-auth",
  description: "The authentication and identity boundary for Basis applications.",
  base: "/basis-auth/",
  cleanUrls: true,
  vite: {
    build: {
      target: "es2022",
    },
  },
  themeConfig: {
    socialLinks: [
      { icon: "github", link: "https://github.com/basishacks/basis-auth" },
    ],
  },
});
