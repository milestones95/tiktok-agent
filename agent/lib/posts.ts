// Shared data access + analytics helpers for the sample post dataset.
// The three post-analytics tools (count_posts, top_posts, analyze_post_themes)
// all go through this module so the metric math stays consistent.

import rawPostData from "../test_data/post_data.json" with { type: "json" };

export interface PostStats {
  views: number;
  likes: number;
  comments_count: number;
  shares: number;
  saves: number;
}

export interface PostComment {
  comment_id: string;
  username: string;
  text: string;
  likes: number;
  timestamp: string;
  reply_count: number;
}

export interface Post {
  post_id: string;
  caption: string;
  hashtags: string[];
  video_url: string;
  duration_seconds: number;
  posted_at: string;
  stats: PostStats;
  comments: PostComment[];
}

export interface Account {
  username: string;
  display_name: string;
  bio: string;
  followers: number;
  following: number;
  total_likes: number;
}

export interface PostData {
  account: Account;
  posts: Post[];
}

const data = rawPostData as PostData;

export const metrics = [
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "engagement_rate",
] as const;

export type Metric = (typeof metrics)[number];

export function getAccount(): Account {
  return data.account;
}

export function getPosts(): Post[] {
  return data.posts;
}

/** Total engagement actions on a post (likes + comments + shares + saves). */
export function engagementCount(post: Post): number {
  const s = post.stats;
  return s.likes + s.comments_count + s.shares + s.saves;
}

/** Engagement actions divided by views. Guards against divide-by-zero. */
export function engagementRate(post: Post): number {
  return engagementCount(post) / Math.max(post.stats.views, 1);
}

/** Resolve a metric name to a comparable number for a post. */
export function getMetricValue(post: Post, metric: Metric): number {
  switch (metric) {
    case "views":
      return post.stats.views;
    case "likes":
      return post.stats.likes;
    case "comments":
      return post.stats.comments_count;
    case "shares":
      return post.stats.shares;
    case "saves":
      return post.stats.saves;
    case "engagement_rate":
      return engagementRate(post);
  }
}

export interface RankedPost {
  rank: number;
  post_id: string;
  caption: string;
  hashtags: string[];
  video_url: string;
  posted_at: string;
  duration_seconds: number;
  stats: PostStats;
  engagement_rate: number;
  metric: Metric;
  metric_value: number;
}

function toRanked(post: Post, metric: Metric, rank: number): RankedPost {
  return {
    rank,
    post_id: post.post_id,
    caption: post.caption,
    hashtags: post.hashtags,
    video_url: post.video_url,
    posted_at: post.posted_at,
    duration_seconds: post.duration_seconds,
    stats: post.stats,
    engagement_rate: round(engagementRate(post), 5),
    metric,
    metric_value: round(getMetricValue(post, metric), 5),
  };
}

/**
 * Sort every post by `metric` and return the `limit` best (`order: "top"`) or
 * worst (`order: "bottom"`) as compact, ranked summaries. Also returns the
 * matching full Post objects for callers that need to aggregate over them.
 */
export function rankPosts(
  metric: Metric,
  order: "top" | "bottom",
  limit: number,
): { ranked: RankedPost[]; posts: Post[] } {
  const sorted = [...getPosts()].sort((a, b) => {
    const diff = getMetricValue(b, metric) - getMetricValue(a, metric);
    return order === "top" ? diff : -diff;
  });
  const posts = sorted.slice(0, Math.max(limit, 0));
  const ranked = posts.map((post, i) => toRanked(post, metric, i + 1));
  return { ranked, posts };
}

/**
 * Text-search posts by topic words. A post matches when every whitespace token
 * of `query` is a substring of its lowercased caption + hashtags (token-AND).
 * Returns matches in dataset order.
 */
export function findPosts(query: string): Post[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  return getPosts().filter((post) => {
    const haystack = `${post.caption} ${post.hashtags.join(" ")}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}

/** Look posts up by exact (case-insensitive, trimmed) post_id, preserving caller order. */
export function getPostsByIds(ids: string[]): { found: Post[]; notFound: string[] } {
  const posts = getPosts();
  const found: Post[] = [];
  const notFound: string[] = [];
  for (const raw of ids) {
    const id = raw.trim().toLowerCase();
    const post = posts.find((p) => p.post_id.toLowerCase() === id);
    if (post) found.push(post);
    else notFound.push(raw);
  }
  return { found, notFound };
}

/** Full comment objects for a post, ordered by `sort` and capped at `limit`. */
export function getComments(
  post: Post,
  sort: "top" | "recent" | "most_replies",
  limit: number,
): PostComment[] {
  const sorted = [...post.comments].sort((a, b) => {
    switch (sort) {
      case "recent":
        return b.timestamp.localeCompare(a.timestamp);
      case "most_replies":
        return b.reply_count - a.reply_count || b.likes - a.likes;
      case "top":
        return b.likes - a.likes || b.reply_count - a.reply_count;
    }
  });
  return sorted.slice(0, Math.max(limit, 0));
}

/** A post's comments, most-liked first, trimmed to what an LLM prompt needs. */
export function topComments(
  post: Post,
  limit = 5,
): { text: string; likes: number; reply_count: number }[] {
  return [...post.comments]
    .sort((a, b) => b.likes - a.likes || b.reply_count - a.reply_count)
    .slice(0, Math.max(limit, 0))
    .map((c) => ({ text: c.text, likes: c.likes, reply_count: c.reply_count }));
}

const STOPWORDS = new Set([
  "the", "a", "an", "to", "i", "my", "how", "you", "your", "that", "of", "for",
  "in", "on", "is", "it", "and", "this", "me", "with", "so", "at", "as", "be",
  "by", "we", "im", "ive", "get", "got", "do", "dont", "not", "no", "if", "or",
  "but", "are", "was", "just", "out", "up", "about", "after", "real", "actually",
  "these", "they", "them", "when", "what", "why", "from", "into", "than", "then",
  "some", "one", "3", "40", "1",
]);

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface Summary {
  count: number;
  post_ids: string[];
  captions: string[];
  averages: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    engagement_rate: number;
    duration_seconds: number;
  };
  hashtag_frequency: { tag: string; count: number }[];
  caption_keyword_frequency: { word: string; count: number }[];
  format_markers: {
    walkthrough: number;
    roast_or_critique: number;
    steal_this: number;
    insider_secret: number;
    negative_or_contrarian_framing: number;
    number_in_caption: number;
  };
  duration_seconds: { avg: number; min: number; max: number };
  timing: {
    day_of_week: { day: string; count: number }[];
    hour_utc: { hour: number; count: number }[];
  };
}

/** Aggregate signal over a set of posts so a model can describe their commonalities. */
export function summarize(posts: Post[]): Summary {
  const count = posts.length;
  const safe = Math.max(count, 1);

  const sum = (fn: (p: Post) => number) => posts.reduce((acc, p) => acc + fn(p), 0);

  const hashtagCounts = new Map<string, number>();
  const wordCounts = new Map<string, number>();
  const dowCounts = new Map<number, number>();
  const hourCounts = new Map<number, number>();
  const format = {
    walkthrough: 0,
    roast_or_critique: 0,
    steal_this: 0,
    insider_secret: 0,
    negative_or_contrarian_framing: 0,
    number_in_caption: 0,
  };

  for (const post of posts) {
    for (const tag of post.hashtags) {
      const key = tag.toLowerCase();
      hashtagCounts.set(key, (hashtagCounts.get(key) ?? 0) + 1);
    }

    const caption = post.caption;
    const words = caption
      .toLowerCase()
      .replace(/#[\p{L}\p{N}_]+/gu, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
    for (const w of words) wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);

    if (/^walking through|breaking down|broken down/i.test(caption)) format.walkthrough++;
    if (/roast|rejected|keeps getting|don'?t do this/i.test(caption)) format.roast_or_critique++;
    if (/steal this|stole this|steal it/i.test(caption)) format.steal_this++;
    if (/nobody tells you|what nobody|what no one|nobody talks about/i.test(caption))
      format.insider_secret++;
    if (/\bvs\b|don'?t do this|please stop|get ignored|burn out|stop sending/i.test(caption))
      format.negative_or_contrarian_framing++;
    if (/\d/.test(caption)) format.number_in_caption++;

    const d = new Date(post.posted_at);
    dowCounts.set(d.getUTCDay(), (dowCounts.get(d.getUTCDay()) ?? 0) + 1);
    hourCounts.set(d.getUTCHours(), (hourCounts.get(d.getUTCHours()) ?? 0) + 1);
  }

  const durations = posts.map((p) => p.duration_seconds);

  return {
    count,
    post_ids: posts.map((p) => p.post_id),
    captions: posts.map((p) => p.caption),
    averages: {
      views: round(sum((p) => p.stats.views) / safe, 1),
      likes: round(sum((p) => p.stats.likes) / safe, 1),
      comments: round(sum((p) => p.stats.comments_count) / safe, 2),
      shares: round(sum((p) => p.stats.shares) / safe, 1),
      saves: round(sum((p) => p.stats.saves) / safe, 1),
      engagement_rate: round(sum(engagementRate) / safe, 5),
      duration_seconds: round(sum((p) => p.duration_seconds) / safe, 1),
    },
    hashtag_frequency: toSortedEntries(hashtagCounts).map(([tag, c]) => ({ tag, count: c })),
    caption_keyword_frequency: toSortedEntries(wordCounts)
      .slice(0, 15)
      .map(([word, c]) => ({ word, count: c })),
    format_markers: format,
    duration_seconds: {
      avg: round(durations.reduce((a, b) => a + b, 0) / safe, 1),
      min: durations.length ? Math.min(...durations) : 0,
      max: durations.length ? Math.max(...durations) : 0,
    },
    timing: {
      day_of_week: [...dowCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([day, c]) => ({ day: DOW[day], count: c })),
      hour_utc: [...hourCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([hour, c]) => ({ hour, count: c })),
    },
  };
}

export interface AccountSummary {
  account: Account;
  posts_count: number;
  first_post_at: string | null;
  last_post_at: string | null;
  totals: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
  };
  averages: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    engagement_rate: number;
    duration_seconds: number;
  };
}

/** Headline totals and counts across every post, plus the raw account block. */
export function accountSummary(): AccountSummary {
  const posts = getPosts();
  const count = posts.length;
  const safe = Math.max(count, 1);
  const sum = (fn: (p: Post) => number) => posts.reduce((acc, p) => acc + fn(p), 0);
  const timestamps = posts.map((p) => p.posted_at).sort();

  return {
    account: getAccount(),
    posts_count: count,
    first_post_at: timestamps[0] ?? null,
    last_post_at: timestamps[timestamps.length - 1] ?? null,
    totals: {
      views: sum((p) => p.stats.views),
      likes: sum((p) => p.stats.likes),
      comments: sum((p) => p.stats.comments_count),
      shares: sum((p) => p.stats.shares),
      saves: sum((p) => p.stats.saves),
    },
    averages: {
      views: round(sum((p) => p.stats.views) / safe, 1),
      likes: round(sum((p) => p.stats.likes) / safe, 1),
      comments: round(sum((p) => p.stats.comments_count) / safe, 2),
      shares: round(sum((p) => p.stats.shares) / safe, 1),
      saves: round(sum((p) => p.stats.saves) / safe, 1),
      engagement_rate: round(sum(engagementRate) / safe, 5),
      duration_seconds: round(sum((p) => p.duration_seconds) / safe, 1),
    },
  };
}

function toSortedEntries(map: Map<string, number>): [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
