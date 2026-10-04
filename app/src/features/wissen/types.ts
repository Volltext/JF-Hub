export interface RuleEntry {
  id: string;
  title: string;
  category: string;
  keywords: string[];
  summary: string;
  details: string[];
}

export interface PositionGuide {
  id: string;
  title: string;
  shortLabel: string;
  section: string;
  duties: string[];
  watchouts: string[];
}

export interface KnotGuide {
  id: string;
  title: string;
  category: string;
  steps: string[];
}
