export type QueryCategory =
  | "spatial"
  | "demographic"
  | "time-series"
  | "ranking"
  | "comparison"
  | "aggregation"
  | "lookup"
  | "other";

const CATEGORY_RULES: { category: QueryCategory; keywords: string[] }[] = [
  {
    category: "spatial",
    keywords: [
      "map",
      "where",
      "near",
      "location",
      "borough",
      "neighborhood",
      "tract",
      "coordinate",
      "radius",
      "distance",
      "cluster",
      "heatmap",
      "h3",
      "hex",
    ],
  },
  {
    category: "demographic",
    keywords: [
      "income",
      "population",
      "race",
      "poverty",
      "unemployment",
      "acs",
      "census",
      "hispanic",
      "white",
      "black",
      "asian",
      "median age",
      "household",
    ],
  },
  {
    category: "time-series",
    keywords: [
      "by month",
      "by year",
      "by week",
      "over time",
      "trend",
      "monthly",
      "yearly",
      "per month",
      "per year",
      "2020",
      "2021",
      "2022",
      "2023",
      "2024",
    ],
  },
  {
    category: "ranking",
    keywords: [
      "top",
      "bottom",
      "most",
      "least",
      "highest",
      "lowest",
      "best",
      "worst",
      "rank",
    ],
  },
  {
    category: "comparison",
    keywords: [
      "vs",
      "versus",
      "compare",
      "difference",
      "between",
      "more than",
      "less than",
    ],
  },
  {
    category: "aggregation",
    keywords: [
      "count",
      "total",
      "sum",
      "average",
      "avg",
      "how many",
      "how much",
    ],
  },
  {
    category: "lookup",
    keywords: ["find", "show me", "list", "what is", "which", "get"],
  },
];

export function classifyQuestion(question: string): QueryCategory {
  const q = question.toLowerCase();
  for (const { category, keywords } of CATEGORY_RULES) {
    if (keywords.some((kw) => q.includes(kw))) return category;
  }
  return "other";
}
