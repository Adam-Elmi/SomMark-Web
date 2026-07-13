import { defineConfig } from "vite";
import sommarkWeb, { themeScript } from "sommark-web";
import tailwindcss from "@tailwindcss/vite";

const posts = [
  {
    slug: "hello-sommark",
    title: "Hello, SomMark",
    date: "2025-01-15",
    author: "Adam",
    tags: ["intro", "sommark"],
    readTime: "4 min read",
    excerpt: "A first look at SomMark — the template language built for the modern web.",
  },
  {
    slug: "dynamic-routing",
    title: "Dynamic Routing in SomMark-Web",
    date: "2025-02-10",
    author: "Adam",
    tags: ["routing", "sommark-web"],
    readTime: "5 min read",
    excerpt: "How folder-based dynamic routes and _layout.smark turn one template into many pages.",
  },
  {
    slug: "style-blocks",
    title: "Styling with Style Blocks",
    date: "2025-03-01",
    author: "Adam",
    tags: ["css", "sommark-web"],
    readTime: "3 min read",
    excerpt: "SomMark extracts and deduplicates CSS from style blocks at build time.",
  },
];

function buildTagItems() {
  const tagMap = new Map<string, { slug: string; title: string; date: string; excerpt: string }[]>();
  for (const post of posts) {
    for (const tag of post.tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push({ slug: post.slug, title: post.title, date: post.date, excerpt: post.excerpt });
    }
  }
  return Array.from(tagMap.entries()).map(([tag, tagPosts]) => ({
    slug: tag,
    posts: tagPosts,
  }));
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    sommarkWeb({
      themeScript: themeScript("dark-mode"),
      dynamic: {
        posts: async () => posts,
        "tags":  async () => buildTagItems(),
      },
    }),
  ],
  server: { host: true },
});
