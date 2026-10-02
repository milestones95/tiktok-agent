import { defineTool } from "eve/tools";
import { z } from "zod";
import { accountSummary } from "../lib/posts";

// Answers "how many posts do I have?" plus the headline totals worth stating
// alongside the count.
export default defineTool({
  description:
    "Count how many posts the account has published and return headline totals " +
    "(views, likes, comments, shares, saves), per-post averages, average engagement " +
    "rate, and the date range the posts span. Takes no input.",
  inputSchema: z.object({}),
  async execute() {
    return accountSummary();
  },
});
