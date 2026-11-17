import type { SourceSeed } from "./types";

/**
 * Phase 1 sources (AI/ML, Data Engineering, Outages). Every URL here is
 * verified by `npm run sources:verify` before seeding (PLAN §5).
 */
export const PHASE1_SOURCES: SourceSeed[] = [
  // AI/ML
  { name: "arXiv cs.AI", url: "https://rss.arxiv.org/rss/cs.AI", stream: "ai-ml", fetch_mode: "feed_only", max_items_per_run: 10 },
  { name: "arXiv cs.LG", url: "https://rss.arxiv.org/rss/cs.LG", stream: "ai-ml", fetch_mode: "feed_only", max_items_per_run: 10 },
  { name: "Hacker News (AI/LLM, 150+ pts)", url: "https://hnrss.org/newest?points=150&q=AI+OR+LLM", stream: "ai-ml", fetch_mode: "page", max_items_per_run: 15 },
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml", stream: "ai-ml", fetch_mode: "page", max_items_per_run: 15 },
  { name: "Google DeepMind Blog", url: "https://deepmind.google/blog/rss.xml", stream: "ai-ml", fetch_mode: "page", max_items_per_run: 15 },
  // Anthropic publishes no official feed; this community-maintained feed mirrors anthropic.com/news.
  { name: "Anthropic News (community feed)", url: "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml", stream: "ai-ml", fetch_mode: "page", max_items_per_run: 15 },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", stream: "ai-ml", fetch_mode: "page", max_items_per_run: 15 },
  // Data Engineering
  { name: "Databricks Blog", url: "https://www.databricks.com/feed", stream: "data-eng", fetch_mode: "page", max_items_per_run: 15 },
  // snowflake.com/feed is disallowed by robots.txt; the Snowflake Builders Blog on Medium is allowed.
  { name: "Snowflake Builders Blog", url: "https://medium.com/feed/snowflake", stream: "data-eng", fetch_mode: "page", max_items_per_run: 15 },
  { name: "dbt Labs Blog", url: "https://www.getdbt.com/blog/rss.xml", stream: "data-eng", fetch_mode: "page", max_items_per_run: 15 },
  { name: "Confluent Blog", url: "https://www.confluent.io/rss.xml", stream: "data-eng", fetch_mode: "page", max_items_per_run: 15 },
  // github.com robots.txt disallows releases.atom for bots, so Spark/Kafka release news comes from ASF.
  { name: "Apache Software Foundation News", url: "https://news.apache.org/feed", stream: "data-eng", fetch_mode: "page", max_items_per_run: 15 },
  { name: "DuckDB Blog", url: "https://duckdb.org/feed.xml", stream: "data-eng", fetch_mode: "page", max_items_per_run: 15 },
  { name: "ClickHouse Blog", url: "https://clickhouse.com/rss.xml", stream: "data-eng", fetch_mode: "page", max_items_per_run: 15 },
  // Outages
  { name: "AWS Health Dashboard", url: "https://status.aws.amazon.com/rss/all.rss", stream: "outages", fetch_mode: "feed_only", max_items_per_run: 15 },
  // Azure's feed lists only active incidents, so it is often valid but empty.
  { name: "Azure Status", url: "https://rssfeed.azure.status.microsoft/en-us/status/feed/", stream: "outages", fetch_mode: "feed_only", max_items_per_run: 15 },
  { name: "Google Cloud Status", url: "https://status.cloud.google.com/en/feed.atom", stream: "outages", fetch_mode: "feed_only", max_items_per_run: 15 },
  { name: "Cloudflare Status", url: "https://www.cloudflarestatus.com/history.rss", stream: "outages", fetch_mode: "feed_only", max_items_per_run: 15 },
];
