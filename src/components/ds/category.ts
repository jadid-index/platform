// Tint (fill) and ink (dark text on that fill) per rubric category code. Each ink passes AA on its fill.
export const CATEGORY_STYLES: Record<string, { fill: string; ink: string; bar: string }> = {
  scientific: {
    fill: "bg-category-scientific",
    ink: "text-category-scientific-foreground",
    bar: "bg-category-scientific-foreground",
  },
  innovation: {
    fill: "bg-category-innovation",
    ink: "text-category-innovation-foreground",
    bar: "bg-category-innovation-foreground",
  },
  social: { fill: "bg-category-social", ink: "text-category-social-foreground", bar: "bg-category-social-foreground" },
  personal_growth: {
    fill: "bg-category-personal",
    ink: "text-category-personal-foreground",
    bar: "bg-category-personal-foreground",
  },
};

// Display order everywhere: scientific, innovation, social, personal growth.
export const CATEGORY_ORDER = ["scientific", "innovation", "social", "personal_growth"];
