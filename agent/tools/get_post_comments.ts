import { defineTool } from "eve/tools";
import { z } from "zod";
import { findPosts, getComments, getPosts, getPostsByIds, type Post } from "../lib/posts";

// Resolves posts by a caption/hashtag text search and/or explicit post_ids, then
// returns their actual comments. Pure read — no LLM call, no approval.
export default defineTool({
  description:
    "Return the actual comments (text, author, likes, replies, timestamp) for one or " +
    "more posts. Identify posts by a text `query` matched against captions and hashtags " +
    "(e.g. 'leetcode', 'resume roast'), and/or explicit `post_ids` from top_posts / " +
    "analyze_post_themes. Use when the user wants to read what commenters actually said, " +
    "not just the comment count.",
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe(
        "Words from the post's topic/caption, e.g. 'leetcode google', 'resume roast'. " +
          "Matched against caption + hashtags; every word must appear.",
      ),
    post_ids: z
      .array(z.string())
      .max(20)
      .optional()
      .describe("Explicit post_id values (from top_posts / analyze_post_themes)."),
    sort: z
      .enum(["top", "recent", "most_replies"])
      .default("top")
      .describe("Comment ordering within each post. 'top' = most-liked first."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .describe("Max comments to return per post."),
  }),
  async execute({ query, post_ids, sort, limit }) {
    const byQuery = query ? findPosts(query) : [];
    const { found: byId, notFound } = post_ids
      ? getPostsByIds(post_ids)
      : { found: [] as Post[], notFound: [] as string[] };

    const queryIds = new Set(byQuery.map((p) => p.post_id));
    const idIds = new Set(byId.map((p) => p.post_id));

    // De-dupe by post_id, keep dataset order.
    const seen = new Set<string>();
    const resolved = [...byQuery, ...byId].filter((p) => {
      if (seen.has(p.post_id)) return false;
      seen.add(p.post_id);
      return true;
    });

    if (resolved.length === 0) {
      return {
        query: query ?? null,
        sort,
        matched: 0,
        not_found: notFound,
        results: [],
        available_posts: getPosts().map((p) => ({ post_id: p.post_id, caption: p.caption })),
      };
    }

    const results = resolved.map((post) => {
      const inQuery = queryIds.has(post.post_id);
      const inId = idIds.has(post.post_id);
      return {
        post_id: post.post_id,
        caption: post.caption,
        hashtags: post.hashtags,
        posted_at: post.posted_at,
        video_url: post.video_url,
        matched_by: inQuery && inId ? "both" : inQuery ? "query" : "post_id",
        comments_count: post.stats.comments_count,
        returned: Math.min(post.comments.length, limit),
        comments: getComments(post, sort, limit),
      };
    });

    return { query: query ?? null, sort, matched: results.length, not_found: notFound, results };
  },
});
