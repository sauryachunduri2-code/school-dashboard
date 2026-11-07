import type { Area, List } from "./types";

/** Muted ink colours; used by seed lists and the list colour picker. */
export const INKS = [
  { name: "Navy ink", value: "#3f5f8f" },
  { name: "Slate blue", value: "#5b7391" },
  { name: "Moss", value: "#5f7f4f" },
  { name: "Sage", value: "#7d9170" },
  { name: "Plum", value: "#86576e" },
  { name: "Umber", value: "#8a6a47" },
  { name: "Teal", value: "#3f7f7a" },
  { name: "Brick", value: "#9a5446" },
  { name: "Graphite", value: "#6b6760" },
] as const;

export const AREA_INK: Record<Area, string> = {
  school: "#3f5f8f",
  ecs: "#5f7f4f",
  other: "#86576e",
};

const seed = (area: Area, name: string, color: string, sort: number, id: string): List => ({ id, area, name, color, sort });

export const SEED_LISTS: List[] = [
  seed("school", "AP Psych", "#3f5f8f", 0, "00000000-0000-4000-8000-000000000001"),
  seed("ecs", "HOSA", "#5f7f4f", 0, "00000000-0000-4000-8000-000000000002"),
  seed("ecs", "Remember Together", "#9a5446", 1, "00000000-0000-4000-8000-000000000003"),
  seed("ecs", "Olympiad", "#3f7f7a", 2, "00000000-0000-4000-8000-000000000004"),
  seed("ecs", "Hackathons", "#8a6a47", 3, "00000000-0000-4000-8000-000000000005"),
  seed("ecs", "Research", "#7d9170", 4, "00000000-0000-4000-8000-000000000006"),
  seed("other", "Personal", "#86576e", 0, "00000000-0000-4000-8000-000000000007"),
];
