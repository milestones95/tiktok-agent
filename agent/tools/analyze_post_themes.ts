import { defineTool } from "eve/tools";
import { z } from "zod";
import { generateText } from "ai";
import {
  getAccount,
  metrics,
  rankPosts,
  summarize,
  topComments,
  type Metric,
  type Post,
} from "../lib/posts";

// Keep in sync with agent/agent.ts. Routes through the Vercel AI Gateway using
// the same credential (VERCEL_OIDC_TOKEN / AI_GATEWAY_API_KEY) as the agent.
const ANALYSIS_MODEL = "openai/gpt-5.4-mini";

// Deterministically ranks the best- or worst-performing posts, then makes one
// LLM call over their captions + top comments to explain the common themes and
// *why* those themes land (or don't) with this audience, with concrete
// suggestions. The aggregates block is computed in code, not by the model.
export default defineTool({
  description:
    "Explain what the best- or worst-performing posts have in common. Ranks the posts " +
    "by the chosen metric, then runs an LLM analysis over their captions and top comments " +
    "to surface recurring topics/themes, why each theme resonates (or falls flat) with this " +
    "audience — citing comment reactions — and concrete content suggestions. Also returns " +
    "deterministic aggregates (hashtag/keyword/timing counts) and the ranked posts.",
  inputSchema: z.object({
    segment: z
      .enum(["best", "worst"])
      .default("best")
      .describe("Analyze the top performers ('best') or the bottom performers ('worst')."),
    metric: z
      .enum(metrics)
      .default("views")
      .describe(
        "Stat that defines performance. Defaults to total views when unspecified; " +
          "confirm with the user which metric they mean for a vague request. " +
          "engagement_rate = (likes + comments + shares + saves) / views.",
      ),
    sample_size: z
      .number()
      .int()
      .min(2)
      .max(20)
      .default(3)
      .describe("How many posts from the chosen end to analyze."),
  }),
  async execute({ segment, metric, sample_size }) {
    const { ranked, posts } = rankPosts(
      metric,
      segment === "best" ? "top" : "bottom",
      sample_size,
    );
    const aggregates = summarize(posts);

    let analysis: string | null = null;
    let analysis_error: string | null = null;
    try {
      const { text } = await generateText({
        model: ANALYSIS_MODEL,
        prompt: buildPrompt(segment, metric, posts),
      });
      analysis = text.trim();
    } catch (err) {
      analysis_error = err instanceof Error ? err.message : String(err);
    }

    return {
      segment,
      metric,
      sample_size,
      model: ANALYSIS_MODEL,
      analysis,
      analysis_error,
      aggregates,
      posts: ranked,
    };
  },
});

function buildPrompt(segment: "best" | "worst", metric: Metric, posts: Post[]): string {
  const account = getAccount();
  const doing = segment === "best" ? "resonated with" : "underperformed with";
  const move =
    segment === "best"
      ? "double down on what is working"
      : "fix or avoid what is not working";

  const postBlocks = posts
    .map((post, i) => {
      const s = post.stats;
      const comments = topComments(post, 5)
        .map((c) => `    - "${c.text}" (${c.likes} likes)`)
        .join("\n");
      return [
        `Post ${i + 1}: ${post.caption}`,
        `  hashtags: ${post.hashtags.join(", ") || "(none)"}`,
        `  posted_at: ${post.posted_at}  duration: ${post.duration_seconds}s`,
        `  views: ${s.views}  likes: ${s.likes}  comments: ${s.comments_count}  shares: ${s.shares}  saves: ${s.saves}`,
        `  top comments:\n${comments || "    (none)"}`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    `You are a short-form video content strategist.`,
    `Account: @${account.username} — ${account.bio} (${account.followers.toLocaleString()} followers).`,
    ``,
    `Below are this account's ${posts.length} ${segment}-performing posts, ranked by ${metric}.`,
    `Analyze them together and answer:`,
    `1. Common themes/topics across these posts (2-4 of them). Name each theme in a few words.`,
    `2. For each theme, why it likely ${doing} this audience. Cite specific comment reactions above as evidence.`,
    `3. Three concrete, specific content ideas to ${move}. Reference the actual posts/comments, not generic advice.`,
    ``,
    `Keep the whole response under ~350 words. Use short headers and bullet points.`,
    ``,
    postBlocks,
  ].join("\n");
}
