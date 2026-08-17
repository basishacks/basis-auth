import { defineConfig } from "vitepress";

export default defineConfig({
  title: "basis-auth",
  description: "The authentication and identity boundary for Basis applications.",
  base: "/devconnect/",
  cleanUrls: true,
  vite: {
    build: {
      target: "es2022",
    },
    optimizeDeps: {
      esbuildOptions: {
        target: "es2022",
      },
    },
  },
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "FAQ", link: "/FAQ" },
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/basishacks/basis-auth" },
    ],
  },
});
