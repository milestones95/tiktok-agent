import { defineTool } from "eve/tools";
import { z } from "zod";
import { metrics, rankPosts } from "../lib/posts";

// Gets every post, ranks it by the chosen metric, then returns the first
// `limit` in the requested direction: `descending` for the top performers,
// `ascending` for the worst. Confirm the metric with the user before calling
// this for a vague "top posts" request — it defaults to total views.
export default defineTool({
  description:
    "Rank the account's posts by a performance metric and return the first N. " +
    "Use for questions like 'what are my top 5 posts by views/likes'. " +
    "sort='descending' returns the best performers, sort='ascending' the worst. " +
    "Confirm which metric the user wants first; only rely on the default when they " +
    "truly did not specify one.",
  inputSchema: z.object({
    metric: z
      .enum(metrics)
      .default("views")
      .describe(
        "Stat to rank by. Defaults to total views when unspecified. " +
          "'comments' uses comment count. " +
          "engagement_rate = (likes + comments + shares + saves) / views.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(5)
      .describe("How many posts to return — the number the user asked for."),
    sort: z
      .enum(["descending", "ascending"])
      .default("descending")
      .describe("'descending' = highest metric first (best), 'ascending' = lowest first (worst)."),
  }),
  async execute({ metric, limit, sort }) {
    const { ranked } = rankPosts(metric, sort === "ascending" ? "bottom" : "top", limit);
    return { metric, sort, limit, count: ranked.length, results: ranked };
  },
});
